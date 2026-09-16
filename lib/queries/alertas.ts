import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
import type {
  AlertaListadoRow,
  EstadoAlerta,
  Json,
  ReglaAlertaRow,
  SeveridadAlerta,
} from '@/types/database'

/**
 * Alertas (Fase F, migs 183-189). HEX sugiere, no ordena: la alerta se
 * detecta y se resuelve SOLA (fn_evaluar_alertas); la persona decide si
 * crea una tarea o la pospone. Sin permiso 'costos' el detalle viene sin
 * valores a costo y las de margen no aparecen.
 *
 * `null` como resultado = migraciones pendientes (función o tabla que
 * PostgREST no conoce), para que la UI muestre el aviso en vez de romper.
 */

export type { EstadoAlerta, SeveridadAlerta }

export const SEVERIDADES: SeveridadAlerta[] = ['critico', 'atencion', 'oportunidad', 'informativo']

export const ETIQUETA_SEVERIDAD: Record<SeveridadAlerta, string> = {
  critico: 'Crítico',
  atencion: 'Atención',
  oportunidad: 'Oportunidad',
  informativo: 'Informativo',
}

/** Claves posibles del detalle; cada regla usa un subconjunto (migs 184/185). */
export interface DetalleAlerta {
  stock?: number
  sin_stock_desde?: string | null
  ultima_venta?: string | null
  venta_diaria?: number
  clase_abc?: string | null
  es_critico?: boolean
  proveedor?: string | null
  venta_por_peso?: boolean
  dias_cobertura?: number
  dias_sin_venta?: number | null
  ultima_compra?: string | null
  valor?: number
  exceso_valor?: number
  ingresos?: number
  unidades_30d?: number
  lote_id?: number
  fecha_vencimiento?: string
  dias_para_vencer?: number
  cantidad?: number
  precio_venta?: number
  costo_actual?: number
  margen_pct?: number
}

export type Alerta = Omit<AlertaListadoRow, 'detalle'> & { detalle: DetalleAlerta }

export interface ParametrosRegla {
  clases?: string[]
  incluir_criticos?: boolean
  dias_cobertura?: number
  dias?: number
  margen_minimo_pct?: number
  dias_sin_venta?: number
  valor_minimo?: number
  dias_venta_reciente?: number
  solo_con_ventas?: boolean
}

export type ReglaAlerta = Omit<ReglaAlertaRow, 'parametros'> & { parametros: ParametrosRegla }

export interface ResumenReglaAlertas {
  regla_codigo: string
  regla: string
  severidad: SeveridadAlerta
  abiertas: number
  en_curso: number
  grupos: { grupo: string; cantidad: number }[]
}

export interface ResumenAlertas {
  ultima_evaluacion: string | null
  abiertas: Record<SeveridadAlerta, number>
  en_curso: number
  pospuestas: number
  reglas: ResumenReglaAlertas[]
}

export interface ResultadoEvaluacion {
  evaluada: boolean
  motivo?: 'reciente' | 'en_curso' | 'error'
  error?: string
  ultima?: string | null
  nuevas?: number
  resueltas?: number
  reaparecidas?: number
  vivas?: number
  duracion_ms?: number
}

export type PrioridadTarea = 'baja' | 'media' | 'alta'

function faltaMigracion(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST202' || error?.code === 'PGRST205' || error?.code === '42P01'
}

/**
 * Corre el evaluador. Con `siAntiguedadMin` no hace nada si hubo una
 * evaluación hace menos de esos minutos (las pantallas la llaman al abrir).
 */
export async function evaluarAlertas(opciones: {
  origen: 'auto' | 'manual'
  siAntiguedadMin?: number
}): Promise<ResultadoEvaluacion | null> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_evaluar_alertas', {
    p_origen: opciones.origen,
    p_si_antiguedad_min: opciones.siAntiguedadMin ?? null,
  })
  if (error) {
    if (faltaMigracion(error)) return null
    throw new Error(error.message)
  }
  return data as unknown as ResultadoEvaluacion
}

/** Vivas + resueltas de los últimos `diasResueltas` días. */
export async function getAlertas(diasResueltas = 30): Promise<Alerta[] | null> {
  const supabase = createClient()
  try {
    return await traerTodo<Alerta>(() =>
      supabase.rpc('fn_alertas', { p_dias_resueltas: diasResueltas })
    )
  } catch (e) {
    if (faltaMigracion(e as Error & { code?: string })) return null
    throw e
  }
}

export async function getResumenAlertas(): Promise<ResumenAlertas | null> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_resumen_alertas')
  if (error) {
    if (faltaMigracion(error)) return null
    throw new Error(error.message)
  }
  return data as unknown as ResumenAlertas
}

export async function getReglasAlerta(): Promise<ReglaAlerta[] | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('reglas_alerta')
    .select('*')
    .order('orden', { ascending: true })
  if (error) {
    if (faltaMigracion(error)) return null
    throw new Error(error.message)
  }
  return (data ?? []) as unknown as ReglaAlerta[]
}

export interface DatosTareaAlertas {
  alertaIds: number[]
  titulo: string
  descripcion: string
  responsableId: string
  fechaLimite: string | null
  prioridad: PrioridadTarea
}

/** Crea UNA tarea para N alertas; devuelve el id de la tarea. */
export async function crearTareaAlertas(datos: DatosTareaAlertas): Promise<number> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_crear_tarea_alertas', {
    p_alerta_ids: datos.alertaIds,
    p_titulo: datos.titulo,
    p_descripcion: datos.descripcion,
    p_responsable_id: datos.responsableId,
    p_fecha_limite: datos.fechaLimite,
    p_prioridad: datos.prioridad,
  })
  if (error) throw new Error(error.message)
  return data as number
}

export async function posponerAlertas(
  alertaIds: number[],
  dias: number,
  motivo: string
): Promise<number> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_posponer_alertas', {
    p_alerta_ids: alertaIds,
    p_dias: dias,
    p_motivo: motivo,
  })
  if (error) throw new Error(error.message)
  return (data as number) ?? 0
}

export async function reabrirAlertas(alertaIds: number[]): Promise<number> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_reabrir_alertas', {
    p_alerta_ids: alertaIds,
  })
  if (error) throw new Error(error.message)
  return (data as number) ?? 0
}

export async function actualizarReglaAlerta(
  codigo: string,
  cambios: { activa: boolean; severidad: SeveridadAlerta; parametros: ParametrosRegla }
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_actualizar_regla_alerta', {
    p_codigo: codigo,
    p_activa: cambios.activa,
    p_severidad: cambios.severidad,
    p_parametros: cambios.parametros as unknown as Json,
  })
  if (error) throw new Error(error.message)
}
