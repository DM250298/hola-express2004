import { createClient } from '@/lib/supabase/client'
import type {
  IncidenciaRow,
  SancionRow,
  TipologiaIncidenciaRow,
} from '@/types/database'

// ─── Tipos ───────────────────────────────────────────────────────────

export type IncidenciaConTipologia = IncidenciaRow & {
  tipologias_incidencia: Pick<TipologiaIncidenciaRow, 'codigo' | 'nombre'> | null
}

export type SancionConVinculos = SancionRow & {
  sancion_incidencias: { incidencia_id: number }[]
}

/** Lo que devuelve fn_resumen_reincidencias (preview del modal). */
export type ResumenReincidencias = {
  previas: number
  instancia_sugerida: number
  gravedad_default: 'leve' | 'grave'
}

export type FiltrosIncidencias = {
  desde: string
  hasta: string
  empleadoId?: number | null
  tipologiaId?: number | null
  estado?: 'abierta' | 'cerrada' | null
}

export type RegistrarIncidenciaArgs = {
  empleadoId: number
  tipologiaId: number
  descripcion: string
  fecha?: string | null
  turnoId?: number | null
  tareaTurnoId?: string | null
  gravedad?: 'leve' | 'grave' | null
  accionCorrectiva?: string | null
}

export type AplicarSancionArgs = {
  empleadoId: number
  tipo: SancionRow['tipo']
  fecha: string
  motivo: string
  dias?: number | null
  incidenciaIds?: number[]
  referenciaActa?: string | null
  resolucion?: string | null
}

const SELECT_INCIDENCIA = '*, tipologias_incidencia(codigo, nombre)'

// ─── Tipologías ──────────────────────────────────────────────────────

export async function getTipologias(): Promise<TipologiaIncidenciaRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tipologias_incidencia')
    .select('*')
    .eq('activa', true)
    .order('orden', { ascending: true })
  if (error) throw error
  return data ?? []
}

// ─── Incidencias ─────────────────────────────────────────────────────

export async function getIncidencias(
  f: FiltrosIncidencias
): Promise<IncidenciaConTipologia[]> {
  const supabase = createClient()
  let q = supabase
    .from('incidencias')
    .select(SELECT_INCIDENCIA)
    .gte('fecha', f.desde)
    .lte('fecha', f.hasta)
    .order('fecha', { ascending: false })
    .order('id', { ascending: false })
  if (f.empleadoId) q = q.eq('empleado_id', f.empleadoId)
  if (f.tipologiaId) q = q.eq('tipologia_id', f.tipologiaId)
  if (f.estado) q = q.eq('estado', f.estado)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as unknown as IncidenciaConTipologia[]
}

/** Historial de un empleado (legajo disciplinario / mi panel). */
export async function getIncidenciasEmpleado(
  empleadoId: number,
  limite = 100
): Promise<IncidenciaConTipologia[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('incidencias')
    .select(SELECT_INCIDENCIA)
    .eq('empleado_id', empleadoId)
    .order('fecha', { ascending: false })
    .order('id', { ascending: false })
    .limit(limite)
  if (error) throw error
  return (data ?? []) as unknown as IncidenciaConTipologia[]
}

export async function getResumenReincidencias(
  empleadoId: number,
  tipologiaId: number,
  fecha?: string | null
): Promise<ResumenReincidencias> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_resumen_reincidencias', {
    p_empleado_id: empleadoId,
    p_tipologia_id: tipologiaId,
    p_fecha: fecha ?? null,
  })
  if (error) throw error
  return data as unknown as ResumenReincidencias
}

export async function registrarIncidencia(
  a: RegistrarIncidenciaArgs
): Promise<IncidenciaRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_registrar_incidencia', {
    p_empleado_id: a.empleadoId,
    p_tipologia_id: a.tipologiaId,
    p_descripcion: a.descripcion,
    p_fecha: a.fecha ?? null,
    p_turno_id: a.turnoId ?? null,
    p_tarea_turno_id: a.tareaTurnoId ?? null,
    p_gravedad: a.gravedad ?? null,
    p_accion_correctiva: a.accionCorrectiva ?? null,
  })
  if (error) throw error
  return data as unknown as IncidenciaRow
}

export async function cerrarIncidencia(
  id: number,
  accionCorrectiva?: string | null
): Promise<IncidenciaRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_cerrar_incidencia', {
    p_id: id,
    p_accion_correctiva: accionCorrectiva ?? null,
  })
  if (error) throw error
  return data as unknown as IncidenciaRow
}

// ─── Sanciones ───────────────────────────────────────────────────────

export async function getSanciones(
  empleadoId?: number | null
): Promise<SancionConVinculos[]> {
  const supabase = createClient()
  let q = supabase
    .from('sanciones')
    .select('*, sancion_incidencias(incidencia_id)')
    .order('fecha', { ascending: false })
    .order('id', { ascending: false })
  if (empleadoId) q = q.eq('empleado_id', empleadoId)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as unknown as SancionConVinculos[]
}

export async function aplicarSancion(a: AplicarSancionArgs): Promise<SancionRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_aplicar_sancion', {
    p_empleado_id: a.empleadoId,
    p_tipo: a.tipo,
    p_fecha: a.fecha,
    p_motivo: a.motivo,
    p_dias: a.dias ?? null,
    p_incidencia_ids: a.incidenciaIds ?? [],
    p_referencia_acta: a.referenciaActa ?? null,
    p_resolucion: a.resolucion ?? null,
  })
  if (error) throw error
  return data as unknown as SancionRow
}

export async function anularSancion(id: number, motivo: string): Promise<SancionRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_anular_sancion', {
    p_id: id,
    p_motivo: motivo,
  })
  if (error) throw error
  return data as unknown as SancionRow
}
