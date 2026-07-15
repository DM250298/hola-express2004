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

function conSugerida(p: Omit<ProductoAReponer, 'cantidad_sugerida'>): ProductoAReponer {
  return {
    ...p,
    cantidad_sugerida: Math.max(p.stock_minimo * 2 - p.stock_actual, 1),
  }
}

/** Fila que devuelve la RPC fn_productos_a_reponer (migración 110). */
type FilaRPC = Omit<ProductoAReponer, 'cantidad_sugerida'>

/**
 * Productos activos con stock por debajo del mínimo (faltan reponer).
 * Si se pasa `proveedorId`, filtra solo los de ese proveedor.
 *
 * El filtro corre en el servidor (RPC fn_productos_a_reponer, migración 110):
 * comparar stock_actual < stock_minimo no se puede expresar en PostgREST y
 * traer el catálogo entero para filtrar acá era carísimo. La RPC también va
 * paginada: el Max Rows de PostgREST (1000) corta igual a las funciones que
 * devuelven set. Si la RPC todavía no existe en la base (PGRST202), se cae
 * al camino viejo client-side.
 */
export async function getProductosAReponer(
  proveedorId?: number | null
): Promise<ProductoAReponer[]> {
  const supabase = createClient()

  try {
    const filas = await traerTodo<FilaRPC>(() =>
      supabase.rpc('fn_productos_a_reponer', {
        p_proveedor_id: proveedorId ?? null,
      })
    )
    return filas.map(conSugerida)
  } catch (e) {
    // PGRST202: la función no está en el schema cache (migración sin correr).
    if ((e as { code?: string })?.code !== 'PGRST202') throw e
  }

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

  const filas = await traerTodo<Fila>(() => {
    let q = supabase
      .from('productos')
      .select(
        'id, nombre, codigo_barras, stock_actual, stock_minimo, proveedor_id, proveedores(nombre), costos_producto(precio_costo)'
      )
      .eq('activo', true)
    if (proveedorId != null) q = q.eq('proveedor_id', proveedorId)
    return q
  })

  const collator = new Intl.Collator('es-AR')
  return filas
    .filter((p) => p.stock_actual < p.stock_minimo)
    .map((p) =>
      conSugerida({
        id: p.id,
        nombre: p.nombre,
        codigo_barras: p.codigo_barras,
        precio_costo: costoDesdeEmbed(p.costos_producto),
        stock_actual: p.stock_actual,
        stock_minimo: p.stock_minimo,
        proveedor_id: p.proveedor_id,
        proveedor_nombre: p.proveedores?.nombre ?? null,
      })
    )
    .sort((a, b) => collator.compare(a.nombre, b.nombre))
}
