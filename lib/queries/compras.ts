import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
import { costoDesdeEmbed, type CostoEmbed } from '@/lib/queries/productos'

export interface ProductoAReponer {
  id: number
  nombre: string
  codigo_barras: string | null
  precio_costo: number
  stock_actual: number
  stock_minimo: number
  proveedor_id: number | null
  proveedor_nombre: string | null
  /** Cantidad sugerida para reponer: lleva al doble del mínimo (mín. 1). */
  cantidad_sugerida: number
}

/**
 * Productos activos con stock por debajo del mínimo (faltan reponer).
 * Si se pasa `proveedorId`, filtra solo los de ese proveedor.
 */
export async function getProductosAReponer(
  proveedorId?: number | null
): Promise<ProductoAReponer[]> {
  const supabase = createClient()

  type Fila = {
    id: number
    nombre: string
    codigo_barras: string | null
    costos_producto: CostoEmbed
    stock_actual: number
    stock_minimo: number
    proveedor_id: number | null
    proveedores: { nombre: string } | null
  }

  const data = await traerTodo<Fila>(() => {
    let q = supabase
      .from('productos')
      .select(
        'id, nombre, codigo_barras, stock_actual, stock_minimo, proveedor_id, proveedores(nombre), costos_producto(precio_costo)'
      )
      .eq('activo', true)
    if (proveedorId != null) q = q.eq('proveedor_id', proveedorId)
    return q
  })

  return data
    .filter((p) => p.stock_actual < p.stock_minimo)
    .map((p) => ({
      id: p.id,
      nombre: p.nombre,
      codigo_barras: p.codigo_barras,
      precio_costo: costoDesdeEmbed(p.costos_producto),
      stock_actual: p.stock_actual,
      stock_minimo: p.stock_minimo,
      proveedor_id: p.proveedor_id,
      proveedor_nombre: p.proveedores?.nombre ?? null,
      cantidad_sugerida: Math.max(p.stock_minimo * 2 - p.stock_actual, 1),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-AR'))
}
