import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
import { costoDesdeEmbed, type CostoEmbed } from '@/lib/queries/productos'

// ─── Centro de Compras (mig 151): sugerencias por cobertura ─────────────────

/** Fila completa de fn_sugerencias_compra. Costos gateados por permiso. */
export interface SugerenciaCompra {
  producto_id: number
  nombre: string
  codigo_barras: string | null
  proveedor_id: number | null
  proveedor_nombre: string | null
  venta_por_peso: boolean
  es_critico: boolean
  producto_nuevo: boolean
  stock_actual: number
  stock_minimo: number
  venta_30d: number
  venta_diaria: number
  /** null = sin ventas recientes. */
  dias_stock: number | null
  stock_en_transito: number
  borrador_pendiente: number
  dias_cobertura_objetivo: number
  dias_seguridad: number
  frecuencia_reposicion_dias: number
  punto_reposicion: number
  stock_objetivo: number
  requiere_compra: boolean
  cantidad_sugerida: number
  multiplo_compra: number | null
  cantidad_sugerida_redondeada: number
  clase_abc: string | null
  precio_costo: number
  ultimo_costo: number | null
  variacion_costo_pct: number | null
  precio_venta: number
  margen_pct: number | null
}

/**
 * Todas las sugerencias de compra (todos los proveedores) en una sola pasada.
 * El agrupado por proveedor se hace en el cliente: ~4000 filas en memoria es
 * trivial y evita un segundo RPC de resumen. Paginada con traerTodo (el Max
 * Rows de PostgREST corta también a las funciones set-returning).
 *
 * Si la migración 151 no corrió, PostgREST devuelve PGRST202: acá NO hay
 * fallback (el Centro de Compras existe recién a partir de la 151) — la UI
 * muestra el aviso de migración pendiente.
 */
export async function getSugerenciasCompra(): Promise<SugerenciaCompra[]> {
  const supabase = createClient()
  return traerTodo<SugerenciaCompra>(() =>
    supabase.rpc('fn_sugerencias_compra', { p_proveedor_id: null })
  )
}

export interface ProductoAReponer {
  id: number
  nombre: string
  codigo_barras: string | null
  precio_costo: number
  stock_actual: number
  stock_minimo: number
  proveedor_id: number | null
  proveedor_nombre: string | null
  /** true = se repone/pide por peso (kg): la cantidad es un peso decimal. */
  venta_por_peso: boolean
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
    venta_por_peso: boolean
  }

  const filas = await traerTodo<Fila>(() => {
    let q = supabase
      .from('productos')
      .select(
        'id, nombre, codigo_barras, stock_actual, stock_minimo, proveedor_id, venta_por_peso, proveedores(nombre), costos_producto(precio_costo)'
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
        venta_por_peso: p.venta_por_peso,
      })
    )
    .sort((a, b) => collator.compare(a.nombre, b.nombre))
}
