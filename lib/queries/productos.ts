import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
import {
  buscarPorBarcodeLocal,
  filtrarProductosLocal,
  guardarCatalogo,
  leerCatalogo,
} from '@/lib/offline/catalogo'
import { esErrorDeRed } from '@/lib/offline/sync'
import type {
  ProductoRow,
  ProductoInsert,
  ProductoUpdate,
} from '@/types/database'

export interface ProductoConRelaciones extends ProductoRow {
  categorias: { id: number; nombre: string } | null
  proveedores: { id: number; nombre: string } | null
}

export interface FiltrosProducto {
  busqueda?: string
  categoria_id?: number | null
  proveedor_id?: number | null
  tipo?: string | null
  unidad?: string | null
  activo?: boolean
}

/** Trae productos del servidor (sin fallback offline). Lanza si no hay red. */
async function fetchProductosRemoto(
  filtros: FiltrosProducto = {}
): Promise<ProductoConRelaciones[]> {
  const supabase = createClient()
  const busqueda = filtros.busqueda?.trim()
  const patron = busqueda
    ? `%${busqueda.replace(/[%_]/g, '\\$&')}%`
    : null

  // Paginamos para soportar catálogos > 1000 productos (límite default de Supabase REST)
  return traerTodo<ProductoConRelaciones>(() => {
    let q = supabase
      .from('productos')
      .select('*, categorias(id, nombre), proveedores(id, nombre)')
      .order('nombre', { ascending: true })
    if (patron) {
      q = q.or(`nombre.ilike.${patron},codigo_barras.ilike.${patron}`)
    }
    if (filtros.categoria_id != null) {
      q = q.eq('categoria_id', filtros.categoria_id)
    }
    if (filtros.proveedor_id != null) {
      q = q.eq('proveedor_id', filtros.proveedor_id)
    }
    if (filtros.tipo) {
      q = q.eq('tipo', filtros.tipo)
    }
    if (filtros.unidad) {
      q = q.eq('unidad', filtros.unidad)
    }
    if (filtros.activo !== undefined) {
      q = q.eq('activo', filtros.activo)
    }
    return q
  })
}

/**
 * Lista de productos. Si no hay conexión (POS offline), cae al snapshot
 * guardado en IndexedDB y aplica los filtros en memoria.
 */
export async function getProductos(
  filtros: FiltrosProducto = {}
): Promise<ProductoConRelaciones[]> {
  try {
    return await fetchProductosRemoto(filtros)
  } catch (error) {
    if (esErrorDeRed(error)) {
      const catalogo = await leerCatalogo()
      if (catalogo.length > 0) {
        return filtrarProductosLocal(catalogo, filtros)
      }
    }
    throw error
  }
}

/**
 * Descarga el catálogo activo completo y lo guarda en IndexedDB para que el
 * POS pueda seguir vendiendo sin conexión. Devuelve la cantidad guardada.
 * Lanza si no hay red (el llamador decide si ignorar el error).
 */
export async function snapshotCatalogoOffline(): Promise<number> {
  const productos = await fetchProductosRemoto({ activo: true })
  await guardarCatalogo(productos)
  return productos.length
}

/** Devuelve los valores únicos de `tipo` y `unidad` presentes en el catálogo. */
export async function getOpcionesTipoUnidad(): Promise<{
  tipos: string[]
  unidades: string[]
}> {
  const supabase = createClient()
  const data = await traerTodo<{ tipo: string; unidad: string }>(() =>
    supabase.from('productos').select('tipo, unidad')
  )
  const tipos = [...new Set(data.map((d) => d.tipo).filter(Boolean))].sort()
  const unidades = [...new Set(data.map((d) => d.unidad).filter(Boolean))].sort()
  return { tipos, unidades }
}

export async function getProductoByBarcode(
  codigo: string
): Promise<ProductoConRelaciones | null> {
  const supabase = createClient()
  try {
    const { data, error } = await supabase
      .from('productos')
      .select('*, categorias(id, nombre), proveedores(id, nombre)')
      .eq('codigo_barras', codigo.trim())
      .maybeSingle()

    if (error) throw error
    return data as ProductoConRelaciones | null
  } catch (error) {
    if (esErrorDeRed(error)) {
      return buscarPorBarcodeLocal(codigo)
    }
    throw error
  }
}

export async function createProducto(
  datos: ProductoInsert
): Promise<ProductoRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('productos')
    .insert(datos)
    .select()
    .single<ProductoRow>()

  if (error) throw error
  return data
}

export async function updateProducto(
  id: number,
  datos: ProductoUpdate
): Promise<ProductoRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('productos')
    .update({ ...datos, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single<ProductoRow>()

  if (error) throw error
  return data
}

export async function toggleProductoActivo(
  id: number,
  activo: boolean
): Promise<ProductoRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('productos')
    .update({ activo, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single<ProductoRow>()

  if (error) throw error
  return data
}
