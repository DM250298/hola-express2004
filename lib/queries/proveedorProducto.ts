import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
import type {
  ProveedorProductoInsert,
  ProveedorProductoUpdate,
} from '@/types/database'

export interface CatalogoItem {
  id: number
  proveedor_id: number
  producto_id: number
  costo: number
  codigo_proveedor: string | null
  es_principal: boolean
  producto_nombre: string
  codigo_barras: string | null
  stock_actual: number
  stock_minimo: number
}

/** Productos del catálogo de un proveedor (relación N:M). */
export async function getCatalogoProveedor(
  proveedor_id: number
): Promise<CatalogoItem[]> {
  const supabase = createClient()

  type Fila = {
    id: number
    proveedor_id: number
    producto_id: number
    costo: number
    codigo_proveedor: string | null
    es_principal: boolean
    productos: {
      nombre: string
      codigo_barras: string | null
      stock_actual: number
      stock_minimo: number
    } | null
  }

  const data = await traerTodo<Fila>(() =>
    supabase
      .from('proveedor_producto')
      .select(
        'id, proveedor_id, producto_id, costo, codigo_proveedor, es_principal, productos(nombre, codigo_barras, stock_actual, stock_minimo)'
      )
      .eq('proveedor_id', proveedor_id)
  )

  return data
    .map((f) => ({
      id: f.id,
      proveedor_id: f.proveedor_id,
      producto_id: f.producto_id,
      costo: Number(f.costo),
      codigo_proveedor: f.codigo_proveedor,
      es_principal: f.es_principal,
      producto_nombre: f.productos?.nombre ?? 'Producto eliminado',
      codigo_barras: f.productos?.codigo_barras ?? null,
      stock_actual: f.productos?.stock_actual ?? 0,
      stock_minimo: f.productos?.stock_minimo ?? 0,
    }))
    .sort((a, b) => a.producto_nombre.localeCompare(b.producto_nombre, 'es-AR'))
}

/** IDs de productos que ya están en el catálogo del proveedor. */
export async function getProductoIdsEnCatalogo(
  proveedor_id: number
): Promise<Set<number>> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('proveedor_producto')
    .select('producto_id')
    .eq('proveedor_id', proveedor_id)
  if (error) throw error
  return new Set((data ?? []).map((d) => d.producto_id))
}

export async function agregarAlCatalogo(
  datos: ProveedorProductoInsert
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('proveedor_producto').insert(datos)
  if (error) throw error
}

export async function actualizarItemCatalogo(
  id: number,
  datos: ProveedorProductoUpdate
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('proveedor_producto')
    .update({ ...datos, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function quitarDelCatalogo(id: number): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('proveedor_producto')
    .delete()
    .eq('id', id)
  if (error) throw error
}
