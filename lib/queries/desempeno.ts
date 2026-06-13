import { createClient } from '@/lib/supabase/client'
import type {
  EvaluacionCalculadaRow,
  EvaluacionDesempenoRow,
} from '@/types/database'

// ─── Desempeño (Sprint 5) ─────────────────────────────────────────────────────
//
// El score se calcula EN VIVO desde asistencia_diaria + tareas_turno vía la RPC
// `fn_calcular_evaluacion` (security definer, gateada a 'rrhh'; el propio
// empleado puede pedir SU score). La nota manual se fija con
// `fn_guardar_evaluacion`. Todo operativo: sin montos salariales.

/** Score de todos los empleados activos para un período (tablero/admin). */
export async function getEvaluacionesPeriodo(
  periodo: string
): Promise<EvaluacionCalculadaRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_calcular_evaluacion', {
    p_periodo: periodo,
  })
  if (error) throw error
  return (data ?? []) as EvaluacionCalculadaRow[]
}

/** Score de un solo empleado (mi-panel / ficha). */
export async function getEvaluacionEmpleado(
  periodo: string,
  empleadoId: number
): Promise<EvaluacionCalculadaRow | null> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_calcular_evaluacion', {
    p_periodo: periodo,
    p_empleado_id: empleadoId,
  })
  if (error) throw error
  const filas = (data ?? []) as EvaluacionCalculadaRow[]
  return filas[0] ?? null
}

export interface GuardarEvaluacionArgs {
  empleadoId: number
  periodo: string
  puntajeManual: number | null
  comentario?: string | null
  usuarioId?: string | null
}

/** Fija la nota manual y congela el snapshot de la evaluación del mes. */
export async function guardarEvaluacion(
  args: GuardarEvaluacionArgs
): Promise<EvaluacionDesempenoRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_guardar_evaluacion', {
    p_empleado_id: args.empleadoId,
    p_periodo: args.periodo,
    p_puntaje_manual: args.puntajeManual,
    p_comentario: args.comentario ?? null,
    p_usuario_id: args.usuarioId ?? null,
  })
  if (error) throw error
  return data as EvaluacionDesempenoRow
}

// ─── Tablero RRHH (un round-trip; refetch en vivo) ───────────────────────────

export interface PersonaTrabajando {
  empleado_id: number
  nombre: string
  apellido: string | null
  desde: string
}
export interface PersonaAusente {
  empleado_id: number
  nombre: string
  apellido: string | null
  turno: string
  hora_inicio: string
}
export interface TareasHoy {
  total: number
  completadas: number
  pendientes: number
}
export interface TareasVencidasEmpleado {
  empleado_id: number
  nombre: string
  apellido: string | null
  cantidad: number
}
export interface DocPorVencer {
  empleado_id: number
  nombre: string
  apellido: string | null
  tipo: string
  fecha_vencimiento: string
  dias: number
}
export interface RachaTardanzas {
  empleado_id: number
  nombre: string
  apellido: string | null
  tardanzas: number
}

export interface DashboardRrhh {
  fecha: string
  generado_at: string
  trabajando_ahora: PersonaTrabajando[]
  ausentes_hoy: PersonaAusente[]
  tareas_hoy: TareasHoy
  tareas_vencidas: TareasVencidasEmpleado[]
  docs_por_vencer: DocPorVencer[]
  rachas_tardanzas: RachaTardanzas[]
}

export async function getDashboardRrhh(): Promise<DashboardRrhh> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_dashboard_rrhh', {})
  if (error) throw error
  return data as unknown as DashboardRrhh
}
