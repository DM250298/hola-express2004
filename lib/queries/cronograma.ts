import { createClient } from '@/lib/supabase/client'
import type {
  EstadoHorario,
  PatronCronogramaInsert,
  PatronCronogramaRow,
  PatronMiembroRow,
} from '@/types/database'

export type PatronConMiembros = PatronCronogramaRow & {
  patron_cronograma_miembros: PatronMiembroRow[]
}

/** Miembro tal como lo edita el formulario (sin patron_id). */
export type MiembroPatronInput = {
  empleado_id: number
  turno_id: number | null
}

export type GuardarPatronArgs = {
  id?: number
  datos: PatronCronogramaInsert
  /** En el orden de la rotación. */
  miembros: MiembroPatronInput[]
}

export type FilaGenerada = {
  empleado_id: number
  fecha: string
  turno_id: number | null
  estado: EstadoHorario
  notas: string | null
  accion: 'crear' | 'reemplazar' | 'omitir'
}

export type ResultadoGeneracion = {
  creados: number
  reemplazados: number
  omitidos: number
  filas: FilaGenerada[]
}

export type GenerarCronogramaArgs = {
  patronId: number
  desde: string
  hasta: string
  sobrescribir: boolean
  aplicar: boolean
}

const SELECT_PATRON = '*, patron_cronograma_miembros(*)'

export async function getPatrones(): Promise<PatronConMiembros[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('patrones_cronograma')
    .select(SELECT_PATRON)
    .order('activo', { ascending: false })
    .order('nombre', { ascending: true })
  if (error) throw error
  const lista = (data ?? []) as unknown as PatronConMiembros[]
  for (const p of lista) p.patron_cronograma_miembros.sort((a, b) => a.orden - b.orden)
  return lista
}

/**
 * Alta/edición del patrón y sus miembros. No hay RPC: son tablas de
 * configuración (sin dinero ni stock) y el reemplazo de miembros es
 * idempotente (borrar + insertar por patrón).
 */
export async function guardarPatron(a: GuardarPatronArgs): Promise<PatronCronogramaRow> {
  const supabase = createClient()
  let patron: PatronCronogramaRow
  if (a.id) {
    const { data, error } = await supabase
      .from('patrones_cronograma')
      .update({ ...a.datos, updated_at: new Date().toISOString() })
      .eq('id', a.id)
      .select()
      .single<PatronCronogramaRow>()
    if (error) throw error
    patron = data
    const { error: eDel } = await supabase
      .from('patron_cronograma_miembros')
      .delete()
      .eq('patron_id', a.id)
    if (eDel) throw eDel
  } else {
    const { data, error } = await supabase
      .from('patrones_cronograma')
      .insert(a.datos)
      .select()
      .single<PatronCronogramaRow>()
    if (error) throw error
    patron = data
  }
  if (a.miembros.length > 0) {
    const filas: PatronMiembroRow[] = a.miembros.map((m, i) => ({
      patron_id: patron.id,
      empleado_id: m.empleado_id,
      orden: i + 1,
      turno_id: m.turno_id,
    }))
    const { error } = await supabase.from('patron_cronograma_miembros').insert(filas)
    if (error) throw error
  }
  return patron
}

export async function togglePatronActivo(id: number, activo: boolean): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('patrones_cronograma')
    .update({ activo, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function eliminarPatron(id: number): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('patrones_cronograma').delete().eq('id', id)
  if (error) throw error
}

export async function generarCronograma(a: GenerarCronogramaArgs): Promise<ResultadoGeneracion> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_generar_cronograma', {
    p_patron_id: a.patronId,
    p_desde: a.desde,
    p_hasta: a.hasta,
    p_sobrescribir: a.sobrescribir,
    p_aplicar: a.aplicar,
  })
  if (error) throw error
  return data as unknown as ResultadoGeneracion
}
