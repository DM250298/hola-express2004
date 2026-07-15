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
  /** Solo combos: componentes que descuentan stock al vender (migración 112). */
  componentes?: ComponenteCombo[]
}

/** Componente de un producto combo, con los datos del producto hijo. */
export interface ComponenteCombo {
  componente_id: number
  cantidad: number
  nombre: string
  unidad: string
  stock_actual: number
  controlar_stock: boolean | null
  /** 0 si el usuario no tiene permiso de costos (RLS). */
  precio_costo: number
}

/**
 * Stock "virtual" de un combo: cuántas unidades se pueden armar con el stock
 * de los componentes (el mínimo de stock/cantidad, redondeado para abajo).
 * Los componentes sin control de stock no limitan; si ninguno controla,
 * el combo no tiene límite físico (se devuelve un tope alto para que el POS
 * no lo bloquee por "sin stock").
 */
export function stockVirtualCombo(componentes: ComponenteCombo[]): number {
  const limitantes = componentes.filter((c) => c.controlar_stock !== false)
  if (limitantes.length === 0) return 9999
  const posibles = limitantes.map((c) =>
    c.cantidad > 0 ? c.stock_actual / c.cantidad : 0
  )
  return Math.max(0, Math.floor(Math.min(...posibles)))
}

export type CostoEmbed =
  | { precio_costo: number }
  | { precio_costo: number }[]
  | null

/** Fila cruda con el costo embebido desde costos_producto (gateado por RLS). */
type ProductoRaw = ProductoConRelaciones & {
  costos_producto: CostoEmbed
}

/** Normaliza el embed (objeto o array) y devuelve el costo, o 0. */
export function costoDesdeEmbed(embed: CostoEmbed): number {
  if (!embed) return 0
  const fila = Array.isArray(embed) ? embed[0] : embed
  return Number(fila?.precio_costo ?? 0)
}

/**
 * Mapea el costo embebido (costos_producto) a `precio_costo`. Para un cajero,
 * RLS deniega costos_producto → queda en 0 (no ve el costo). Para admin/
 * encargado, trae el valor real.
 */
function mapearCosto(r: ProductoRaw): ProductoConRelaciones {
  const { costos_producto, ...resto } = r
  return { ...resto, precio_costo: costoDesdeEmbed(costos_producto) }
}

const SELECT_PRODUCTO =
  '*, categorias(id, nombre), proveedores(id, nombre), costos_producto(precio_costo)'

// Embed del componente vía la FK componente_id (la tabla tiene dos FKs a
// productos, hay que desambiguar por nombre de constraint).
const SELECT_COMPONENTES =
  'producto_id, componente_id, cantidad, componente:productos!producto_componentes_componente_id_fkey(id, nombre, unidad, stock_actual, controlar_stock, costos_producto(precio_costo))'

type ComponenteRaw = {
  producto_id: number
  componente_id: number
  cantidad: number
  componente: {
    id: number
    nombre: string
    unidad: string
    stock_actual: number
    controlar_stock: boolean | null
    costos_producto: CostoEmbed
  } | null
}

function mapearComponente(fila: ComponenteRaw): ComponenteCombo {
  return {
    componente_id: fila.componente_id,
    cantidad: Number(fila.cantidad),
    nombre: fila.componente?.nombre ?? `#${fila.componente_id}`,
    unidad: fila.componente?.unidad ?? 'unidad',
    stock_actual: Number(fila.componente?.stock_actual ?? 0),
    controlar_stock: fila.componente?.controlar_stock ?? true,
    precio_costo: costoDesdeEmbed(fila.componente?.costos_producto ?? null),
  }
}

/**
 * Adjunta los componentes a los productos tipo 'combo' y reemplaza su
 * stock_actual por el stock virtual (cuántos combos se pueden armar).
 * Soft-fail: si la tabla todavía no existe (migración 112 sin correr),
 * los combos quedan sin componentes y se comportan como productos comunes.
 */
async function adjuntarComponentesCombos(
  supabase: ReturnType<typeof createClient>,
  productos: ProductoConRelaciones[]
): Promise<void> {
  const combos = productos.filter((p) => p.tipo === 'combo')
  if (combos.length === 0) return
  try {
    const { data, error } = await supabase
      .from('producto_componentes')
      .select(SELECT_COMPONENTES)
      .in(
        'producto_id',
        combos.map((c) => c.id)
      )
    if (error) throw error
    const porProducto = new Map<number, ComponenteCombo[]>()
    for (const fila of (data ?? []) as unknown as ComponenteRaw[]) {
      const lista = porProducto.get(fila.producto_id) ?? []
      lista.push(mapearComponente(fila))
      porProducto.set(fila.producto_id, lista)
    }
    for (const combo of combos) {
      const comps = porProducto.get(combo.id) ?? []
      combo.componentes = comps
      if (comps.length > 0) combo.stock_actual = stockVirtualCombo(comps)
    }
  } catch {
    // Tabla aún no migrada u offline: combos sin expansión, no romper la lista.
  }
}

export interface FiltrosProducto {
  busqueda?: string
  categoria_id?: number | null
  proveedor_id?: number | null
  tipo?: string | null
  unidad?: string | null
  activo?: boolean
  /** Solo para el POS: excluye los productos marcados "no ofrecer en ventas". */
  solo_vendibles?: boolean
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
  const filas = await traerTodo<ProductoRaw>(() => {
    let q = supabase
      .from('productos')
      .select(SELECT_PRODUCTO)
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
    if (filtros.solo_vendibles) {
      q = q.eq('no_ofrecer_ventas', false)
    }
    return q
  })
  const productos = filas.map(mapearCosto)
  // Combos: adjunta componentes y calcula el stock virtual (min. armable).
  await adjuntarComponentesCombos(supabase, productos)
  return productos
}

/** ¿Los filtros representan el catálogo activo completo (sin acotar)? */
function esCatalogoCompleto(f: FiltrosProducto): boolean {
  return (
    f.activo === true &&
    !f.busqueda &&
    f.categoria_id == null &&
    f.proveedor_id == null &&
    !f.tipo &&
    !f.unidad
  )
}

/**
 * Lista de productos. Si no hay conexión (POS offline), cae al snapshot
 * guardado en IndexedDB y aplica los filtros en memoria.
 *
 * Cada vez que se trae el catálogo activo completo con conexión, se refresca
 * el snapshot offline en segundo plano — así el POS siempre tiene una copia
 * fresca para vender sin internet.
 */
export async function getProductos(
  filtros: FiltrosProducto = {}
): Promise<ProductoConRelaciones[]> {
  try {
    const data = await fetchProductosRemoto(filtros)
    if (esCatalogoCompleto(filtros)) {
      guardarCatalogo(data).catch(() => {
        // Si IndexedDB no está disponible, se ignora.
      })
    }
    return data
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
  codigo: string,
  soloVendible = false
): Promise<ProductoConRelaciones | null> {
  const supabase = createClient()
  const cod = codigo.trim()
  try {
    // Busca tanto en el código principal como en el secundario (codigo_barras_2),
    // así un EAN de fábrica cargado como secundario también se escanea en el POS.
    let q = supabase
      .from('productos')
      .select(SELECT_PRODUCTO)
      .or(`codigo_barras.eq.${cod},codigo_barras_2.eq.${cod}`)
    if (soloVendible) q = q.eq('no_ofrecer_ventas', false)
    const { data, error } = await q.limit(1).maybeSingle()

    if (error) throw error
    if (!data) return null
    const producto = mapearCosto(data as unknown as ProductoRaw)
    // Si es combo, calcula el stock virtual también en el escaneo directo.
    await adjuntarComponentesCombos(supabase, [producto])
    return producto
  } catch (error) {
    if (esErrorDeRed(error)) {
      return buscarPorBarcodeLocal(codigo, soloVendible)
    }
    throw error
  }
}

/** Componentes de un combo, con nombre/stock/costo del producto hijo. */
export async function getComponentesCombo(
  productoId: number
): Promise<ComponenteCombo[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('producto_componentes')
    .select(SELECT_COMPONENTES)
    .eq('producto_id', productoId)
    .order('id', { ascending: true })
  // Tabla aún no migrada → tratamos el combo como si no tuviera componentes.
  if (error) return []
  return ((data ?? []) as unknown as ComponenteRaw[]).map(mapearComponente)
}

/**
 * Reemplaza la composición de un combo (borra y vuelve a insertar).
 * Con lista vacía, deja de ser combo operativamente (vende su propio stock).
 */
export async function guardarComponentesCombo(
  productoId: number,
  componentes: { componente_id: number; cantidad: number }[]
): Promise<void> {
  const supabase = createClient()
  const { error: errorBorrar } = await supabase
    .from('producto_componentes')
    .delete()
    .eq('producto_id', productoId)
  if (errorBorrar) throw errorBorrar
  if (componentes.length === 0) return
  const { error } = await supabase.from('producto_componentes').insert(
    componentes.map((c) => ({
      producto_id: productoId,
      componente_id: c.componente_id,
      cantidad: c.cantidad,
    }))
  )
  if (error) throw error
}

/** Guarda el costo en la tabla gateada costos_producto. */
async function guardarCosto(
  supabase: ReturnType<typeof createClient>,
  productoId: number,
  precioCosto: number
): Promise<void> {
  const { error } = await supabase
    .from('costos_producto')
    .upsert(
      {
        producto_id: productoId,
        precio_costo: precioCosto,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'producto_id' }
    )
  if (error) throw error
}

export async function createProducto(
  datos: ProductoInsert
): Promise<ProductoRow> {
  const supabase = createClient()
  // El costo va a costos_producto (tabla gateada), no a productos.
  const { precio_costo, ...resto } = datos
  // Sin código de barras → omitir la key para que la DB autogenere (HEX-…).
  if (!resto.codigo_barras || resto.codigo_barras.trim() === '') {
    delete resto.codigo_barras
  }
  const { data, error } = await supabase
    .from('productos')
    .insert(resto)
    .select()
    .single<ProductoRow>()

  if (error) throw error
  if (precio_costo != null) await guardarCosto(supabase, data.id, precio_costo)
  return { ...data, precio_costo: precio_costo ?? 0 }
}

export async function updateProducto(
  id: number,
  datos: ProductoUpdate
): Promise<ProductoRow> {
  const supabase = createClient()
  const { precio_costo, ...resto } = datos
  const { data, error } = await supabase
    .from('productos')
    .update({ ...resto, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single<ProductoRow>()

  if (error) throw error
  if (precio_costo != null) await guardarCosto(supabase, id, precio_costo)
  return { ...data, precio_costo: precio_costo ?? 0 }
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
