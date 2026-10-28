import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
import { normalizarTablero } from '@/lib/tablero/normalizar'

/**
 * Tablero del dueño (Fase D): fn_tablero_gerencial (mig 181) trae todo el
 * tablero en un viaje; fn_metricas_agrupadas (mig 180) alimenta la tabla
 * por dimensión. Costos y márgenes vienen NULL sin el permiso 'costos'.
 * `null` como resultado = migración pendiente (PGRST202).
 *
 * Desde la mig 318 (v3) el margen es NETO: ventas sin IVA y sin
 * devoluciones menos el costo de lo vendido. Las claves nuevas
 * (`ingresos_netos`, `iva`, `devoluciones`, `regimen`, …) vienen `null`
 * cuando la 318 todavía no corrió; `normalizarTablero` lo garantiza.
 */

/** Régimen de IVA del comercio (fn_regimen_iva, mig 311). Solo el RI discrimina IVA. */
export type RegimenIva = 'responsable_inscripto' | 'monotributista' | 'exento'

export type DimensionTablero =
  | 'categoria'
  | 'marca'
  | 'proveedor'
  | 'gondola'
  | 'clase_abc'

export const ETIQUETA_DIMENSION: Record<DimensionTablero, string> = {
  categoria: 'Categoría',
  marca: 'Marca',
  proveedor: 'Proveedor',
  gondola: 'Góndola',
  clase_abc: 'Clase ABC',
}

/**
 * Texto que fn_metricas_agrupadas usa cuando el SKU no tiene valor en la
 * dimensión. El drill-down al tab Análisis lo necesita para matchear.
 */
export const SIN_VALOR_DIMENSION: Record<DimensionTablero, string> = {
  categoria: 'Sin categoría',
  marca: 'Sin marca',
  proveedor: 'Sin proveedor',
  gondola: 'Sin ubicar',
  clase_abc: 'Sin ventas',
}

export interface CategoriaCantidad {
  categoria: string
  cantidad: number
}

export interface PuntoSerieTablero {
  fecha: string
  ventas: number
  tickets: number
  ingresos: number
  /** Neto de IVA y devoluciones desde la mig 318. */
  margen: number | null
  /** Mig 318. `null` = migración pendiente. */
  ingresos_netos: number | null
  devoluciones: number | null
}

export interface SkuTopTablero {
  producto_id: number
  nombre: string
  /** Margen $ si hay permiso de costos; si no, ingresos. */
  valor: number
  ingresos: number
  margen_pesos: number | null
  margen_pct: number | null
  participacion: number | null
  /** Mig 318. `null` = migración pendiente. */
  ingresos_netos: number | null
}

export interface GondolaTablero {
  nombre: string
  skus: number
  ingresos: number
  margen: number | null
  /** Sobre ingresos netos desde la mig 318. */
  margen_pct: number | null
  stock_valorizado: number | null
  quiebres: number
  sin_movimiento: number
  /** Mig 318. `null` = migración pendiente. */
  ingresos_netos: number | null
}

export interface TableroGerencial {
  generado_at: string
  hoy: string
  periodo: {
    desde: string
    hasta: string
    dias: number
    anterior_desde: string
    anterior_hasta: string
  }
  puede_ver_costos: boolean
  ventas: {
    hoy: number
    hoy_tickets: number
    ayer: number
    ayer_semana_anterior: number
    semana: number
    semana_anterior: number
    mes: number
    mes_anterior_mismo_tramo: number
    periodo: number
    periodo_tickets: number
    ticket_promedio: number
    periodo_anterior: number
  }
  margen: {
    /** Bruto: lo cobrado, IVA incluido y sin restar devoluciones. */
    ingresos: number
    costo: number | null
    /** Netos de IVA y devoluciones desde la mig 318 (margen_pct = margen / ingresos_netos). */
    margen: number | null
    margen_pct: number | null
    anterior_margen: number | null
    anterior_margen_pct: number | null
    estimado: boolean
    /** Mig 318. `null` = la 318 todavía no corrió (margen con IVA incluido). */
    ingresos_netos: number | null
    iva: number | null
    /** Bruto devuelto en el período. */
    devoluciones: number | null
    anterior_ingresos_netos: number | null
    /** Sin la 318 se asume responsable inscripto. */
    regimen: RegimenIva
  }
  serie: PuntoSerieTablero[]
  inventario: {
    valorizado: number | null
    inmovilizado: number | null
    skus_inmovilizados: number
    dias_inventario: number | null
  }
  quiebres: {
    activos: number
    criticos_activos: number
    eventos_periodo: number
    horas_periodo: number
    perdida_periodo: number
  }
  top_skus: SkuTopTablero[]
  concentracion: {
    skus_80: number
    skus_total: number
    criterio: 'margen' | 'ingresos'
  }
  gondolas: GondolaTablero[]
  mapeo: { productos_activos: number; ubicados: number }
  lotes_por_vencer: number
  situaciones: {
    criticos_sin_stock: { cantidad: number; por_categoria: CategoriaCantidad[] }
    a_por_quebrar: { cantidad: number; por_categoria: CategoriaCantidad[] }
    margen_negativo: { cantidad: number | null }
  }
  ultimo_snapshot: string | null
}

export interface MetricaAgrupada {
  clave: string
  skus: number
  skus_con_venta: number
  skus_sin_movimiento: number
  ingresos: number
  participacion_ingresos: number | null
  /** Netos de IVA y devoluciones desde la mig 315 (margen_pct sobre ingresos_netos). */
  costo_ventas: number | null
  margen_pesos: number | null
  margen_pct: number | null
  participacion_margen: number | null
  stock_valorizado: number | null
  dias_inventario: number | null
  quiebres: number
  venta_perdida_pesos: number
  costo_estimado: boolean
  /** Mig 315. `null` = migración pendiente (sin gate de costos). */
  ingresos_netos: number | null
  iva_ventas: number | null
  devoluciones: number | null
}

export async function getTableroGerencial(
  desde: string,
  hasta: string
): Promise<TableroGerencial | null> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_tablero_gerencial', {
    p_desde: desde,
    p_hasta: hasta,
  })
  if (error) {
    if (error.code === 'PGRST202') return null
    throw new Error(error.message)
  }
  return normalizarTablero(data)
}

export async function getMetricasAgrupadas(
  dimension: DimensionTablero,
  desde: string,
  hasta: string
): Promise<MetricaAgrupada[] | null> {
  const supabase = createClient()
  try {
    return await traerTodo<MetricaAgrupada>(() =>
      supabase.rpc('fn_metricas_agrupadas', {
        p_dimension: dimension,
        p_desde: desde,
        p_hasta: hasta,
      })
    )
  } catch (e) {
    if ((e as Error & { code?: string }).code === 'PGRST202') return null
    throw e
  }
}
