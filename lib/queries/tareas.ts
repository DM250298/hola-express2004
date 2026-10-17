import { createClient } from '@/lib/supabase/client'
import { isoMasDias } from '@/lib/utils/periodos'
import type {
  AplicaDesde,
  AreaTarea,
  Json,
  MotivoNoSePudo,
  TareaPedidoRow,
  ModoTarea,
  PrioridadTarea,
  RolOperativo,
  TareaHistorialRow,
  TareaRecurrenteRow,
  TareaTurnoRow,
  TipoActividadTarea,
  TipoRecurrenciaTarea,
} from '@/types/database'

const BUCKET_EVIDENCIA = 'tareas-evidencia'

/** Plantilla con sus asignados (embed de la tabla puente, mig 158). */
export type PlantillaConAsignados = TareaRecurrenteRow & {
  tareas_recurrentes_asignados: { empleado_id: number }[]
}

/** Instancia con los participantes de una tarea grupal (vacío si individual). */
export type TareaConParticipantes = TareaTurnoRow & {
  tareas_turno_participantes: { empleado_id: number }[]
}

/** Fila agregada de cumplimiento por empleado (fn_cumplimiento_tareas). */
export type CumplimientoEmpleado = {
  empleado_id: number
  nombre: string
  apellido: string
  asignadas: number
  completadas: number
  vencidas: number
  pendientes: number
  rechazos: number
  /** mig 283: cerradas como "no se pudo" (no cuentan en contra). */
  no_se_pudo?: number
  /** mig 283: completadas por alguien que no era el dueño. */
  hechas_por_otro?: number
  pct: number | null
}

/** Fila agregada de cumplimiento por tarea/plantilla (fn_cumplimiento_tareas). */
export type CumplimientoTarea = {
  plantilla_id: string | null
  titulo: string
  modo: ModoTarea
  total: number
  completadas: number
  vencidas: number
  pendientes: number
  rechazos: number
  pct: number | null
}

export type CumplimientoTareas = {
  por_empleado: CumplimientoEmpleado[]
  por_tarea: CumplimientoTarea[]
}

// ─── Plantillas (recurrentes) ─────────────────────────────────────────────────

export async function getPlantillas(): Promise<PlantillaConAsignados[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tareas_recurrentes')
    .select('*, tareas_recurrentes_asignados(empleado_id)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as PlantillaConAsignados[]
}

/**
 * Campos de la rutina que guarda fn_rutina_guardar (mig 279). La hora se
 * manda como `hora` (HH:mm) y la base la guarda como minutos desde el inicio
 * del turno. Recurrencia, vigencia y privada solo las cambia un administrador.
 */
export type DatosRutina = {
  titulo?: string
  descripcion?: string | null
  turno_id?: number
  dias_semana?: number[]
  prioridad?: PrioridadTarea
  requiere_evidencia?: boolean
  modo?: ModoTarea
  alcance?: TareaRecurrenteRow['alcance']
  roles_puesto?: RolOperativo[]
  hora?: string | null
  minutos_desde_inicio?: number | null
  duracion_min?: number | null
  tipo_actividad?: TipoActividadTarea
  checklist?: string[]
  area?: AreaTarea | null
  avisar_atraso_min?: number | null
  tipo_recurrencia?: TipoRecurrenciaTarea
  dia_mes?: number | null
  cada_n_dias?: number | null
  fecha_base?: string | null
  vigencia_desde?: string | null
  vigencia_hasta?: string | null
  privada?: boolean
}

/**
 * Crea (id null) o edita una tarea de la rutina. `aplicar` = desde cuándo
 * rige ('manana' por defecto: hoy sigue la versión de antes). `asignados`
 * null = no tocar los asignados fijos. Devuelve el id.
 */
export async function guardarPlantilla(
  id: string | null,
  datos: DatosRutina,
  asignados: number[] | null,
  aplicar: AplicaDesde
): Promise<string> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_rutina_guardar', {
    p_id: id,
    p_datos: datos as Json,
    p_aplicar: aplicar,
    p_asignados: asignados,
  })
  if (error) throw error
  return data as string
}

/**
 * Quita una tarea de la rutina (nunca se borra). Un administrador la
 * desactiva; si lo hace la encargada, la base lo convierte en un pedido y
 * devuelve su número.
 */
export async function quitarPlantilla(
  id: string,
  motivo: string | null,
  aplicar: AplicaDesde = 'manana'
): Promise<number | null> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_rutina_quitar', {
    p_id: id,
    p_motivo: motivo,
    p_aplicar: aplicar,
  })
  if (error) throw error
  return (data as number | null) ?? null
}

/** La encargada pide que se quite una tarea de la rutina (un pedido pendiente por tarea). */
export async function pedirQuitarPlantilla(id: string, motivo: string): Promise<number> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_rutina_pedir_quitar', {
    p_id: id,
    p_motivo: motivo,
  })
  if (error) throw error
  return data as number
}

/** Vuelve a poner en la rutina una tarea quitada (solo administrador). */
export async function reactivarPlantilla(id: string, aplicar: AplicaDesde = 'manana'): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_rutina_reactivar', { p_id: id, p_aplicar: aplicar })
  if (error) throw error
}

// ─── Instancias (tareas del día) ───────────────────────────────────────────────

/**
 * Tareas de una fecha, con participantes de las grupales. RLS: gestión/rrhh
 * ven todas; el empleado, las suyas y las grupales donde participa.
 */
export async function getTareasFecha(
  fecha: string
): Promise<TareaConParticipantes[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tareas_turno')
    .select('*, tareas_turno_participantes(empleado_id)')
    .eq('fecha', fecha)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as TareaConParticipantes[]
}

/**
 * Tareas para la agenda del día (mig 251): las de la fecha y las del día
 * anterior, porque la noche que arrancó ayer sigue viva hasta su hora_fin
 * de hoy. `fecha` es siempre el día en que EMPIEZA el turno; la UI decide
 * en qué franja mostrarlas (agendaTurnos.ts).
 */
export async function getTareasAgenda(
  fecha: string
): Promise<TareaConParticipantes[]> {
  const supabase = createClient()
  const ayer = isoMasDias(fecha, -1)
  const { data, error } = await supabase
    .from('tareas_turno')
    .select('*, tareas_turno_participantes(empleado_id)')
    .in('fecha', [ayer, fecha])
    .order('hora', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as TareaConParticipantes[]
}

/**
 * Tareas de un rango (drill-down de cumplimiento; solo gestión por RLS).
 * El filtro por empleado (incl. participante de grupales) se hace en cliente.
 */
export async function getTareasRango(
  desde: string,
  hasta: string,
  filtros?: { plantillaId?: string | null; titulo?: string }
): Promise<TareaConParticipantes[]> {
  const supabase = createClient()
  let query = supabase
    .from('tareas_turno')
    .select('*, tareas_turno_participantes(empleado_id)')
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: false })
  if (filtros?.plantillaId) query = query.eq('plantilla_id', filtros.plantillaId)
  if (filtros?.plantillaId === null && filtros.titulo) {
    query = query.is('plantilla_id', null).eq('titulo', filtros.titulo)
  }
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as TareaConParticipantes[]
}

/** Datos de una tarea puntual nueva (fn_tarea_crear_puntual, mig 276). */
export type NuevaTareaPuntual = {
  fecha: string
  turnoId: number
  titulo: string
  descripcion?: string | null
  hora?: string | null
  duracionMin?: number | null
  /** Personas elegidas; si viene vacío se usa `rolesPuesto`. */
  empleadoIds?: number[]
  rolesPuesto?: RolOperativo[]
  modo?: ModoTarea
  prioridad?: PrioridadTarea
  area?: AreaTarea | null
  privada?: boolean
  requiereEvidencia?: boolean
  checklist?: string[]
  tipoActividad?: TipoActividadTarea
  /** Avisar si se atrasa más de N minutos (null = sin aviso). */
  avisarAtrasoMin?: number | null
}

/**
 * Crea una tarea puntual: "cada uno" = una por persona; "grupal" = una con
 * participantes. Devuelve los ids creados.
 */
export async function crearTareaPuntual(t: NuevaTareaPuntual): Promise<string[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_tarea_crear_puntual', {
    p_fecha: t.fecha,
    p_turno_id: t.turnoId,
    p_titulo: t.titulo,
    p_descripcion: t.descripcion ?? null,
    p_hora: t.hora ?? null,
    p_duracion_min: t.duracionMin ?? null,
    p_empleado_ids: t.empleadoIds && t.empleadoIds.length > 0 ? t.empleadoIds : null,
    p_roles_puesto: t.rolesPuesto && t.rolesPuesto.length > 0 ? t.rolesPuesto : null,
    p_modo: t.modo ?? 'individual',
    p_prioridad: t.prioridad ?? 'media',
    p_area: t.area ?? null,
    p_privada: t.privada ?? false,
    p_requiere_evidencia: t.requiereEvidencia ?? false,
    p_checklist: t.checklist ?? [],
    p_tipo_actividad: t.tipoActividad ?? 'puntual',
    p_avisar_atraso_min: t.avisarAtrasoMin ?? null,
  })
  if (error) throw error
  return (data as string[]) ?? []
}

/** Campos editables de una tarea abierta (fn_tarea_editar, mig 276). */
export type CambiosTarea = Partial<
  Pick<
    TareaTurnoRow,
    | 'titulo'
    | 'descripcion'
    | 'hora'
    | 'duracion_min'
    | 'prioridad'
    | 'area'
    | 'requiere_evidencia'
    | 'checklist'
    | 'avisar_atraso_min'
    | 'tipo_actividad'
    | 'notas'
  >
>

/** Edita el contenido de una tarea abierta; queda "editada a mano" y en el registro. */
export async function editarTarea(id: string, cambios: CambiosTarea): Promise<void> {
  if (Object.keys(cambios).length === 0) return
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_tarea_editar', {
    p_tarea_id: id,
    p_cambios: cambios as Json,
  })
  if (error) throw error
}

/** Cambia a quién le toca una tarea que nadie empezó (fn_agenda_mover, mig 277). */
export async function reasignarTarea(id: string, asignados: number[]): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_agenda_mover', {
    p_tarea_id: id,
    p_asignados: asignados,
  })
  if (error) throw error
}

/** Cancela una tarea (reemplaza a "Eliminar": nada se borra). */
export async function cancelarTarea(id: string, motivo?: string | null): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_tarea_cancelar', {
    p_tarea_id: id,
    p_motivo: motivo ?? null,
  })
  if (error) throw error
}

/** Historial de cambios de una tarea (fn_tarea_historial, mig 278). */
export async function getHistorialTarea(id: string): Promise<TareaHistorialRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_tarea_historial', { p_tarea_id: id })
  if (error) throw error
  return (data ?? []) as TareaHistorialRow[]
}

/** Completa una tarea (valida evidencia y permiso server-side). */
export async function completarTarea(
  id: string,
  evidenciaUrl?: string | null,
  nota?: string | null
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_completar_tarea', {
    p_tarea_id: id,
    p_evidencia_url: evidenciaUrl ?? null,
    p_nota: nota ?? null,
  })
  if (error) throw error
}

/** Pendiente/vencida → en curso; registra quién y cuándo (mig 253). */
export async function iniciarTarea(id: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_iniciar_tarea', { p_tarea_id: id })
  if (error) throw error
}

/** Completada/cancelada/vencida → pendiente (solo gestión, mig 253). */
export async function reabrirTarea(id: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_reabrir_tarea', { p_tarea_id: id })
  if (error) throw error
}

/** Omite con motivo obligatorio (→ cancelada); gestión o el responsable. */
export async function omitirTarea(id: string, motivo: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_omitir_tarea', {
    p_tarea_id: id,
    p_motivo: motivo,
  })
  if (error) throw error
}

/**
 * Traslada al turno siguiente (mig 253): crea la instancia nueva (con
 * trasladada_de) y cancela la original (trasladada_a). Devuelve el id nuevo.
 */
export async function trasladarTarea(id: string): Promise<string> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_trasladar_tarea', { p_tarea_id: id })
  if (error) throw error
  return data as string
}

/** Rechaza una completada (solo gestión): vuelve a pendiente con motivo. */
export async function rechazarTarea(id: string, motivo: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_rechazar_tarea', {
    p_tarea_id: id,
    p_motivo: motivo,
  })
  if (error) throw error
}

/** Agregados de cumplimiento por empleado y por tarea (solo gestión). */
export async function getCumplimiento(
  desde: string,
  hasta: string,
  empleadoId?: number | null
): Promise<CumplimientoTareas> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_cumplimiento_tareas', {
    p_desde: desde,
    p_hasta: hasta,
    p_empleado_id: empleadoId ?? null,
  })
  if (error) throw error
  return (data ?? { por_empleado: [], por_tarea: [] }) as CumplimientoTareas
}

/** Cierra una tarea como "No se pudo" con su motivo (habilitado en la mig 288). */
export async function noSePudoTarea(
  id: string,
  motivo: MotivoNoSePudo,
  detalle?: string | null
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_tarea_no_se_pudo', {
    p_tarea_id: id,
    p_motivo: motivo,
    p_detalle: detalle ?? null,
  })
  if (error) throw error
}

/** Tilda o destilda un paso del checklist (paso = índice desde 0). */
export async function checklistPaso(id: string, paso: number, hecho: boolean): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_tarea_checklist_paso', {
    p_tarea_id: id,
    p_paso: paso,
    p_hecho: hecho,
  })
  if (error) throw error
}

/** Guarda la nota para el próximo turno (vacía = borrarla). */
export async function guardarNotaTarea(id: string, nota: string | null): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_tarea_nota', { p_tarea_id: id, p_nota: nota })
  if (error) throw error
}

/** Quién trabaja en un turno ese día (para la vista por persona; gestión). */
export async function getPersonasTurno(
  fecha: string,
  turnoId: number
): Promise<{ empleado_id: number; nombre: string; rol_operativo: string }[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_personas_turno', {
    p_fecha: fecha,
    p_turno_id: turnoId,
  })
  if (error) throw error
  return (data ?? []) as { empleado_id: number; nombre: string; rol_operativo: string }[]
}

/**
 * "Actualizar también la agenda de hoy": adelanta a hoy los cambios "desde
 * mañana" de una tarea de la rutina (solo en lo que nadie tocó). Devuelve
 * cuántas tareas de hoy cambiaron.
 */
export async function actualizarAgendaHoy(turnoId: number, plantillaId: string | null): Promise<number> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_agenda_actualizar_hoy', {
    p_turno_id: turnoId,
    p_plantilla_id: plantillaId,
  })
  if (error) throw error
  return (data as number) ?? 0
}

/** A quién le tocaría una tarea por puesto ese día (fn_a_quien_le_toca). */
export async function getAQuienLeToca(
  fecha: string,
  turnoId: number,
  puestos: string[]
): Promise<{ empleado_id: number; nombre: string; notas: string | null }[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_a_quien_le_toca', {
    p_fecha: fecha,
    p_turno_id: turnoId,
    p_puestos: puestos,
  })
  if (error) throw error
  return (data ?? []) as { empleado_id: number; nombre: string; notas: string | null }[]
}

/** Pedido de quitar con el título de la tarea de la rutina. */
export type PedidoConTarea = TareaPedidoRow & {
  tareas_recurrentes: { titulo: string; turno_id: number | null } | null
  pedido_por_nombre: string | null
}

/** Pedidos pendientes (el administrador ve todos; la encargada, los suyos). */
export async function getPedidosPendientes(): Promise<PedidoConTarea[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tareas_pedidos')
    .select('*, tareas_recurrentes(titulo, turno_id)')
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: true })
  if (error) throw error
  const pedidos = (data ?? []) as unknown as Omit<PedidoConTarea, 'pedido_por_nombre'>[]
  const ids = [...new Set(pedidos.map((p) => p.pedido_por).filter((x): x is string => !!x))]
  let nombres = new Map<string, string>()
  if (ids.length) {
    const { data: us } = await supabase.from('usuarios').select('id, nombre').in('id', ids)
    nombres = new Map((us ?? []).map((u: { id: string; nombre: string }) => [u.id, u.nombre]))
  }
  return pedidos.map((p) => ({ ...p, pedido_por_nombre: p.pedido_por ? nombres.get(p.pedido_por) ?? null : null }))
}

/** El administrador aprueba (= quitar desde mañana) o rechaza un pedido. */
export async function resolverPedido(id: number, aprobar: boolean, nota?: string | null): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_pedido_resolver', {
    p_pedido_id: id,
    p_aprobar: aprobar,
    p_nota: nota ?? null,
  })
  if (error) throw error
}

/**
 * Cambios hechos por la encargada (o cualquiera que no sea el sistema) en los
 * últimos 7 días, sin contar marcar tareas. Solo lo lee un administrador (RLS).
 */
export async function getCambiosSemana(): Promise<number> {
  const supabase = createClient()
  const desde = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await supabase
    .from('tareas_eventos')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', desde)
    .not('actor_usuario_id', 'is', null)
    .in('tipo', ['creada', 'editada', 'cancelada', 'hora_corregida', 'reabierta', 'quitada', 'reactivada', 'agenda_actualizada'])
  if (error) throw error
  return count ?? 0
}

/** Materializa las tareas recurrentes de una fecha (fallback on-demand del cron). */
export async function materializarFecha(fecha: string): Promise<number> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_materializar_tareas_turno', {
    p_fecha: fecha,
  })
  if (error) throw error
  return (data as number) ?? 0
}

/** Sube una foto de evidencia al bucket público y devuelve la URL. */
export async function subirEvidencia(file: File): Promise<string> {
  const supabase = createClient()
  const ext = file.name.split('.').pop() || 'jpg'
  const path = `${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from(BUCKET_EVIDENCIA)
    .upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (error) throw error
  const { data } = supabase.storage.from(BUCKET_EVIDENCIA).getPublicUrl(path)
  return data.publicUrl
}
