import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { nuevoUuid } from '@/lib/offline/cola'
import { esErrorDeRed } from '@/lib/offline/sync'
import { encolarFichaje } from '@/lib/offline/colaFichajes'
import {
  guardarEmpleadosKiosco,
  type EmpleadoKiosco,
} from '@/lib/offline/empleadosKiosco'
import { updateEmpleado } from '@/lib/queries/rrhh'
import type {
  AsistenciaDiariaRow,
  FichajeRow,
  HorarioAsignadoInsert,
  HorarioAsignadoRow,
  Json,
  TipoFichaje,
  TurnoPlantillaRow,
} from '@/types/database'

const TZ_OFFSET = '-03:00' // Argentina (sin DST)

// ─── Turnos ───────────────────────────────────────────────────────────────────

export async function getTurnos(): Promise<TurnoPlantillaRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('turnos_plantilla')
    .select('*')
    .order('hora_inicio', { ascending: true })
  if (error) throw error
  return (data ?? []) as TurnoPlantillaRow[]
}

// ─── Horarios asignados ───────────────────────────────────────────────────────

export async function getHorariosRango(
  desde: string,
  hasta: string
): Promise<HorarioAsignadoRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('horarios_asignados')
    .select('*')
    .gte('fecha', desde)
    .lte('fecha', hasta)
  if (error) throw error
  return (data ?? []) as HorarioAsignadoRow[]
}

export async function upsertHorario(
  datos: HorarioAsignadoInsert
): Promise<HorarioAsignadoRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('horarios_asignados')
    .upsert(datos, { onConflict: 'empleado_id,fecha' })
    .select()
    .single<HorarioAsignadoRow>()
  if (error) throw error
  return data
}

export async function eliminarHorario(id: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('horarios_asignados').delete().eq('id', id)
  if (error) throw error
}

/** Copia una semana de horarios a otra (clave para la rotación de 14 días). */
export async function copiarSemana(
  semanaDesde: string,
  semanaHacia: string
): Promise<number> {
  const supabase = createClient()
  const finDesde = format(addDays(parseISO(semanaDesde), 6), 'yyyy-MM-dd')
  const origen = await getHorariosRango(semanaDesde, finDesde)
  // differenceInCalendarDays da un entero exacto (inmune a DST), a diferencia de
  // dividir milisegundos, que da fraccional si la ventana cruza un cambio de hora.
  const corrimiento = differenceInCalendarDays(
    parseISO(semanaHacia),
    parseISO(semanaDesde)
  )
  if (origen.length === 0) return 0
  const nuevos: HorarioAsignadoInsert[] = origen.map((h) => ({
    empleado_id: h.empleado_id,
    turno_id: h.turno_id,
    fecha: format(addDays(parseISO(h.fecha), corrimiento), 'yyyy-MM-dd'),
    estado: h.estado,
  }))
  const { error } = await supabase
    .from('horarios_asignados')
    .upsert(nuevos, { onConflict: 'empleado_id,fecha' })
  if (error) throw error
  return nuevos.length
}

// ─── Asistencia diaria ────────────────────────────────────────────────────────

export async function getAsistenciaRango(
  desde: string,
  hasta: string
): Promise<AsistenciaDiariaRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('asistencia_diaria')
    .select('*')
    .gte('fecha', desde)
    .lte('fecha', hasta)
  if (error) throw error
  return (data ?? []) as AsistenciaDiariaRow[]
}

/** Asistencia de un empleado en un mes (calendario de su ficha / panel). */
export async function getAsistenciaEmpleado(
  empleadoId: number,
  desde: string,
  hasta: string
): Promise<AsistenciaDiariaRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('asistencia_diaria')
    .select('*')
    .eq('empleado_id', empleadoId)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: true })
  if (error) throw error
  return (data ?? []) as AsistenciaDiariaRow[]
}

/** Cierra (recalcula y marca ausentes) un día. Disparado on-demand. */
export async function cerrarDia(fecha: string): Promise<number> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_cerrar_dia_asistencia', {
    p_fecha: fecha,
  })
  if (error) throw error
  return (data as number) ?? 0
}

// ─── Fichajes (corrección manual) ─────────────────────────────────────────────

export async function getFichajesDia(
  empleadoId: number,
  fecha: string
): Promise<FichajeRow[]> {
  const supabase = createClient()
  const ini = `${fecha}T00:00:00${TZ_OFFSET}`
  const fin = `${format(addDays(parseISO(fecha), 1), 'yyyy-MM-dd')}T00:00:00${TZ_OFFSET}`
  const { data, error } = await supabase
    .from('fichajes')
    .select('*')
    .eq('empleado_id', empleadoId)
    .gte('momento', ini)
    .lt('momento', fin)
    .order('momento', { ascending: true })
  if (error) throw error
  return (data ?? []) as FichajeRow[]
}

export async function corregirFichaje(args: {
  empleadoId: number
  momento: string
  tipo: TipoFichaje
  motivo: string
}): Promise<string> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_corregir_fichaje', {
    p_empleado_id: args.empleadoId,
    p_momento: args.momento,
    p_tipo: args.tipo,
    p_motivo: args.motivo,
  })
  if (error) throw error
  return data as string
}

export async function anularFichaje(
  fichajeId: string,
  motivo: string
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_anular_fichaje', {
    p_fichaje_id: fichajeId,
    p_motivo: motivo,
  })
  if (error) throw error
}

// ─── Importación del reloj biométrico ─────────────────────────────────────────

export interface FilaPreviewReloj {
  reloj_id: number
  nombre_reloj: string
  empleado_id: number | null
  nombre_empleado: string | null
  total: number
  dias_impares: number
  por_dia: Record<string, string[]>
}

export interface PreviewReloj {
  archivo_nombre: string
  periodo_desde: string
  periodo_hasta: string
  dias: string[]
  filas: FilaPreviewReloj[]
  marcaciones: { reloj_id: number; momento: string }[]
  resumen: { total_marcaciones: number; empleados: number; sin_match: number }
}

export interface ResumenImportReloj {
  nuevas: number
  duplicadas: number
  sin_match: number
  relojes_sin_match: number[]
  dias_recalculados: number
}

/** Sube el .xls al parser server-side y devuelve la previsualización. */
export async function previsualizarReloj(file: File): Promise<PreviewReloj> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/rrhh/importar-reloj', {
    method: 'POST',
    body: fd,
  })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(json.error ?? 'No se pudo leer el archivo del reloj.')
  }
  return json as PreviewReloj
}

/** Vincula un reloj_id sin matchear a un empleado (lo guarda en su ficha). */
export async function vincularReloj(
  empleadoId: number,
  relojId: number
): Promise<void> {
  await updateEmpleado(empleadoId, { reloj_id: relojId })
}

/** Crea la importación y ejecuta fn_importar_fichajes (transaccional). */
export async function confirmarImportReloj(
  preview: PreviewReloj
): Promise<ResumenImportReloj> {
  const supabase = createClient()
  const { data: imp, error: e1 } = await supabase
    .from('importaciones_fichajes')
    .insert({
      archivo_nombre: preview.archivo_nombre,
      periodo_desde: preview.periodo_desde,
      periodo_hasta: preview.periodo_hasta,
      total_marcaciones: preview.marcaciones.length,
    })
    .select('id')
    .single<{ id: string }>()
  if (e1) throw e1

  const { data, error } = await supabase.rpc('fn_importar_fichajes', {
    p_import_id: imp.id,
    p_marcaciones: preview.marcaciones as unknown as Json,
  })
  if (error) throw error
  return data as unknown as ResumenImportReloj
}

// ─── Kiosco (PIN + fichaje con fallback offline) ──────────────────────────────

export interface ResultadoFichaje {
  ya_registrado: boolean
  empleado_id: number
  nombre: string
  apellido: string | null
  foto_url: string | null
  tipo?: TipoFichaje
  momento?: string
  pendiente?: boolean
}

/** Lista de empleados activos para el kiosco; cachea para uso offline. */
export async function getEmpleadosParaKiosco(): Promise<EmpleadoKiosco[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('empleados')
    .select('id, nombre, apellido, foto_url, legajo')
    .eq('activo', true)
    .order('nombre', { ascending: true })
  if (error) throw error
  const lista = (data ?? []) as EmpleadoKiosco[]
  await guardarEmpleadosKiosco(lista)
  return lista
}

/** Registra un fichaje del kiosco; si no hay red, lo encola (valida al sync). */
export async function registrarFichajeKiosco(
  empleado: { id: number; nombre: string },
  pin: string
): Promise<ResultadoFichaje> {
  const id = nuevoUuid()
  const momento = new Date().toISOString()

  const offline = (): Promise<ResultadoFichaje> =>
    encolarFichaje(
      { empleado_id: empleado.id, nombre: empleado.nombre, pin, momento },
      id
    ).then(() => ({
      ya_registrado: false,
      empleado_id: empleado.id,
      nombre: empleado.nombre,
      apellido: null,
      foto_url: null,
      pendiente: true,
    }))

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return offline()
  }

  const supabase = createClient()
  try {
    const { data, error } = await supabase.rpc('fn_registrar_fichaje', {
      p_id: id,
      p_empleado_id: empleado.id,
      p_pin: pin,
      p_origen: 'kiosco',
      p_momento: momento,
    })
    if (error) throw error
    return { ...(data as unknown as ResultadoFichaje), pendiente: false }
  } catch (e) {
    // Se cayó la red → encolar. PIN incorrecto u otro error → relanzar.
    if (esErrorDeRed(e)) return offline()
    throw e
  }
}

// ─── PIN ──────────────────────────────────────────────────────────────────────

export async function setPin(empleadoId: number, pin: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_set_pin', {
    p_empleado_id: empleadoId,
    p_pin: pin,
  })
  if (error) throw error
}

export async function tienePin(empleadoId: number): Promise<boolean> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_tiene_pin', {
    p_empleado_id: empleadoId,
  })
  if (error) throw error
  return (data as boolean) ?? false
}
