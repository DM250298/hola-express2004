import { createClient } from '@/lib/supabase/client'
import type { Json, PaseTurnoRow, PendientePase } from '@/types/database'

export type EntregarPaseArgs = {
  fecha: string
  turnoSalienteId: number
  turnoEntranteId: number | null
  reposicion: string
  ordenLimpieza: string
  novedades: string
  pendientes: PendientePase[]
  /** false = guardar borrador sin validar bloques. */
  entregar: boolean
  /** Solo con 'rrhh': entregar a nombre de otro empleado. */
  salienteEmpleadoId?: number | null
}

export type RecibirPaseArgs = {
  paseId: number
  conformeReposicion: boolean
  conformeOrden: boolean
  conformeNovedades: boolean
  conformePendientes: boolean
  observaciones?: string | null
  /** Solo con 'rrhh': recibir a nombre de otro empleado. */
  entranteEmpleadoId?: number | null
}

/** Pases de un rango de fechas (historial del hub). */
export async function getPasesTurno(desde: string, hasta: string): Promise<PaseTurnoRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('pases_turno')
    .select('*')
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: false })
    .order('turno_saliente_id', { ascending: false })
  if (error) throw error
  return (data ?? []) as PaseTurnoRow[]
}

/** Entregados y todavía no recibidos (últimas 48 h). */
export async function getPasesPendientesRecibir(): Promise<PaseTurnoRow[]> {
  const supabase = createClient()
  const desde = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
  const { data, error } = await supabase
    .from('pases_turno')
    .select('*')
    .eq('estado', 'entregado')
    .gte('entregado_at', desde)
    .order('entregado_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as PaseTurnoRow[]
}

/** Último pase recibido: sus pendientes no hechos se arrastran al próximo. */
export async function getUltimoPaseRecibido(): Promise<PaseTurnoRow | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('pases_turno')
    .select('*')
    .eq('estado', 'recibido')
    .order('recibido_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as PaseTurnoRow | null) ?? null
}

/** Borrador propio de una fecha + turno (si existe). */
export async function getBorradorPase(
  fecha: string,
  turnoSalienteId: number
): Promise<PaseTurnoRow | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('pases_turno')
    .select('*')
    .eq('fecha', fecha)
    .eq('turno_saliente_id', turnoSalienteId)
    .maybeSingle()
  if (error) throw error
  return (data as PaseTurnoRow | null) ?? null
}

export async function entregarPaseTurno(a: EntregarPaseArgs): Promise<PaseTurnoRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_entregar_pase_turno', {
    p_fecha: a.fecha,
    p_turno_saliente_id: a.turnoSalienteId,
    p_turno_entrante_id: a.turnoEntranteId,
    p_reposicion: a.reposicion || null,
    p_orden_limpieza: a.ordenLimpieza || null,
    p_novedades: a.novedades || null,
    p_pendientes: a.pendientes as unknown as Json,
    p_entregar: a.entregar,
    p_saliente_empleado_id: a.salienteEmpleadoId ?? null,
  })
  if (error) throw error
  return data as unknown as PaseTurnoRow
}

export async function recibirPaseTurno(a: RecibirPaseArgs): Promise<PaseTurnoRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_recibir_pase_turno', {
    p_pase_id: a.paseId,
    p_conforme_reposicion: a.conformeReposicion,
    p_conforme_orden: a.conformeOrden,
    p_conforme_novedades: a.conformeNovedades,
    p_conforme_pendientes: a.conformePendientes,
    p_observaciones: a.observaciones ?? null,
    p_entrante_empleado_id: a.entranteEmpleadoId ?? null,
  })
  if (error) throw error
  return data as unknown as PaseTurnoRow
}
