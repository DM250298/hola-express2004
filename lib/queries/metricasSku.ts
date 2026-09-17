import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'

/**
 * Inteligencia por SKU (Fase C): fn_resumen_skus / fn_metricas_sku
 * (mig 178). Las columnas de costo/margen vienen NULL para usuarios sin
 * permiso 'costos' — el gate vive en la RPC, nunca en el cliente.
 * `null` como resultado = la migración todavía no corrió (PGRST202) y la
 * UI muestra el aviso de migración pendiente.
 */

export interface ResumenSku {
  producto_id: number
  nombre: string
  codigo_barras: string | null
  venta_por_peso: boolean
  activo: boolean
  es_critico: boolean
  marca: string | null
  categoria: string | null
  proveedor: string | null
  gondola: string | null
  stock_actual: number
  stock_minimo: number
  unidades_vendidas: number
  unidades_via_combo: number
  ingresos: number
  venta_diaria: number
  dias_cobertura: number | null
  ultima_venta: string | null
  ultima_compra: string | null
  dias_sin_venta: number | null
  clase_abc: string | null
  quiebres_periodo: number
  venta_perdida_pesos: number
  precio_venta: number
  /** NULL sin permiso 'costos'. */
  costo_actual: number | null
  costo_ventas: number | null
  margen_pesos: number | null
  margen_pct: number | null
  stock_valorizado: number | null
  costo_estimado: boolean
}

export async function getResumenSkus(
  desde: string,
  hasta: string
): Promise<ResumenSku[] | null> {
  const supabase = createClient()
  try {
    return await traerTodo<ResumenSku>(() =>
      supabase.rpc('fn_resumen_skus', { p_desde: desde, p_hasta: hasta })
    )
  } catch (e) {
    if ((e as Error & { code?: string }).code === 'PGRST202') return null
    throw e
  }
}

export interface PuntoSerieSku {
  fecha: string
  unidades: number
  unidades_via_combo: number
  ingresos: number
  costo_ventas: number | null
  margen: number | null
  stock: number
  valor_stock: number | null
  precio_venta: number
  clase_abc: string | null
  estimado: boolean
}

export interface QuiebreSku {
  inicio_at: string
  fin_at: string | null
  duracion_horas: number
  perdida_unid: number | null
  perdida_pesos: number | null
}

export interface MetricasSku {
  serie: PuntoSerieSku[]
  quiebres: QuiebreSku[]
  ultima_venta: string | null
  ultima_compra: string | null
}

export async function getMetricasSku(
  productoId: number,
  desde: string,
  hasta: string
): Promise<MetricasSku | null> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_metricas_sku', {
    p_producto_id: productoId,
    p_desde: desde,
    p_hasta: hasta,
  })
  if (error) {
    if (error.code === 'PGRST202') return null
    throw new Error(error.message)
  }
  return data as unknown as MetricasSku
}
