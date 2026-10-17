/**
 * Lógica pura del Registro de cambios (Tareas v2, Etapa 5).
 * Sin React y solo con imports de tipos (los tests corren con `node --test`):
 *  · qué pasó en cada evento, en palabras ("Corrigió la hora");
 *  · quién lo hizo y en nombre de quién;
 *  · antes → después campo por campo ("Hora: 08:15 → 09:00");
 *  · eventos agrupados por día de La Rioja;
 *  · cuentas del resumen semanal.
 */
import type { Json, TareaEventoRow, TipoEventoTarea } from '@/types/database'

export type ContextoRegistro = {
  empleados: Map<number, string>
  turnos: Map<number, { nombre: string; hora_inicio: string }>
}

export type CambioLegible = { campo: string; antes: string | null; despues: string | null }

export const QUE_PASO: Record<TipoEventoTarea, string> = {
  creada: 'Creó',
  editada: 'Editó',
  iniciada: 'Inició',
  completada: 'Completó',
  no_se_pudo: 'Marcó "No se pudo"',
  reabierta: 'Volvió a abrir',
  hora_corregida: 'Corrigió la hora',
  cancelada: 'Canceló',
  pedido_quitar: 'Pidió quitar de la rutina',
  pedido_aprobado: 'Aprobó el pedido de quitar',
  pedido_rechazado: 'Rechazó el pedido de quitar',
  pedido_deshecho: 'Deshizo el pedido',
  aviso_atraso: 'Avisó un atraso',
  trasladada: 'Pasó al turno siguiente',
  rechazada: 'Rechazó lo hecho',
  quitada: 'Quitó de la rutina',
  reactivada: 'Volvió a poner en la rutina',
  agenda_actualizada: 'Actualizó la agenda de hoy',
  turno_editado: 'Cambió el horario del turno',
  reasignada: 'Reasignó según el cronograma',
  nota_editada: 'Editó la nota para el próximo turno',
  checklist_paso: 'Marcó un paso',
  registro_completo: 'Empezó el registro completo',
}

/** Rutina = la plantilla; Agenda = la tarea de un día. */
export function dondeFue(ev: Pick<TareaEventoRow, 'entidad'>): string {
  if (ev.entidad === 'rutina' || ev.entidad === 'pedido') return 'Rutina'
  if (ev.entidad === 'agenda') return 'Agenda del día'
  if (ev.entidad === 'turno') return 'Horarios de turno'
  return 'Sistema'
}

const AREAS: Record<string, string> = {
  atencion_caja: 'Atención y caja',
  produccion_fiambreria: 'Producción y fiambrería',
  reposicion_limpieza: 'Reposición, depósito y limpieza',
  control_seguridad: 'Control y seguridad',
}
const PUESTOS: Record<string, string> = {
  responsable_general: 'Encargada de sucursal',
  encargado: 'Encargado/a de turno',
  fiambreria: 'Fiambrería y producción',
  cajero: 'Caja',
  pivote: 'Pivot',
  compras: 'Compras',
}
const ESTADOS: Record<string, string> = {
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  completada: 'Hecha',
  no_se_pudo: 'No se pudo',
  vencida: 'Quedó sin hacer',
  cancelada: 'Cancelada',
  aprobado: 'Aprobado',
  rechazado: 'Rechazado',
}
const MOTIVOS: Record<string, string> = {
  falto_insumo: 'Faltó insumo o mercadería',
  no_alcanzo_tiempo: 'No alcanzó el tiempo',
  se_rompio: 'Se rompió algo',
  otro: 'Otro',
}
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

const CAMPOS: Record<string, string> = {
  titulo: 'Título', descripcion: 'Detalle', hora: 'Hora', minutos_desde_inicio: 'Empieza',
  duracion_min: 'Duración', area: 'Área', dias_semana: 'Días', prioridad: 'Prioridad', modo: 'Modo',
  alcance: 'Quién la hace', roles_puesto: 'Puestos', empleado_id: 'Asignada a', asignados: 'Personas fijas',
  participantes: 'Participantes', activa: 'Rutina', privada: 'Privada', requiere_evidencia: 'Foto',
  avisar_atraso_min: 'Aviso de atraso', tipo_actividad: 'Tipo', checklist: 'Pasos', estado: 'Estado',
  motivo: 'Motivo', detalle: 'Detalle del motivo', motivo_omision: 'Motivo', iniciada_at: 'Inicio',
  completada_at: 'Hecha a las', nota_proximo_turno: 'Nota para el próximo turno', evidencia_url: 'Foto',
  turno_id: 'Turno', fecha: 'Día', notas: 'Notas', tipo_recurrencia: 'Se repite', dia_mes: 'Día del mes',
  cada_n_dias: 'Cada', fecha_base: 'Desde', vigencia_desde: 'Vigente desde', vigencia_hasta: 'Vigente hasta',
  hora_inicio: 'Empieza', hora_fin: 'Termina',
}
const IGNORAR = new Set(['disparado_por', 'pedido_id', 'plantillas', 'trasladada_a', 'trasladada_de',
  'ventana_min', 'usuario_id', 'cambios', 'paso', 'texto', 'hecho', 'para', 'avisado_a', 'minutos'])

const AR_MS = 3 * 60 * 60 * 1000

/** Día de La Rioja (UTC−3, sin horario de verano) de un timestamp. */
export function fechaAr(iso: string): string {
  return new Date(Date.parse(iso) - AR_MS).toISOString().slice(0, 10)
}

export function horaAr(iso: string): string {
  return new Date(Date.parse(iso) - AR_MS).toISOString().slice(11, 16)
}

function hhmm(min: number): string {
  const m = ((min % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function minutosDeHora(hora: string): number {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + (m || 0)
}

export function duracionTexto(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`
}

export function diasTexto(dias: number[]): string {
  const d = [...new Set(dias)].sort((a, b) => a - b)
  if (d.length === 7) return 'Todos los días'
  if (d.length === 0) return 'Ningún día'
  if (d.join() === '1,2,3,4,5') return 'Lunes a viernes'
  if (d.join() === '0,6') return 'Fines de semana'
  // Lunes primero.
  return [...d.filter((x) => x !== 0), ...d.filter((x) => x === 0)].map((x) => DIAS[x]).join(', ')
}

function nombres(ids: unknown, ctx: ContextoRegistro): string {
  const lista = Array.isArray(ids) ? ids : ids === null || ids === undefined ? [] : [ids]
  if (lista.length === 0) return 'Nadie'
  return lista.map((id) => ctx.empleados.get(Number(id)) ?? `Legajo ${id}`).join(', ')
}

/** Un valor guardado, en palabras. */
export function valorTexto(campo: string, valor: Json | undefined, ctx: ContextoRegistro, turnoId: number | null): string {
  if (campo === 'empleado_id' || campo === 'asignados' || campo === 'participantes') return nombres(valor, ctx)
  if (valor === null || valor === undefined) {
    if (campo === 'minutos_desde_inicio' || campo === 'hora') return 'Todo el turno'
    if (campo === 'area') return 'Sin área'
    if (campo === 'avisar_atraso_min') return 'No avisa'
    return '—'
  }
  switch (campo) {
    case 'minutos_desde_inicio': {
      const t = turnoId !== null ? ctx.turnos.get(turnoId) : undefined
      return t ? hhmm(minutosDeHora(t.hora_inicio) + Number(valor)) : `${valor} min desde el inicio`
    }
    case 'hora': case 'hora_inicio': case 'hora_fin': return String(valor).slice(0, 5)
    case 'duracion_min': return duracionTexto(Number(valor))
    case 'area': return AREAS[String(valor)] ?? String(valor)
    case 'dias_semana': return Array.isArray(valor) ? diasTexto(valor.map(Number)) : String(valor)
    case 'prioridad': return { alta: 'Alta', media: 'Media', baja: 'Baja' }[String(valor)] ?? String(valor)
    case 'modo': return valor === 'grupal' ? 'Grupal (alcanza con uno)' : 'Cada uno'
    case 'alcance': return { puesto: 'Según el cronograma', empleados: 'Personas fijas', todos: 'Todos' }[String(valor)] ?? String(valor)
    case 'roles_puesto': return Array.isArray(valor) && valor.length ? valor.map((p) => PUESTOS[String(p)] ?? String(p)).join(', ') : 'Ninguno'
    case 'activa': return valor ? 'En la rutina' : 'Fuera de la rutina'
    case 'privada': return valor ? 'Sí' : 'No'
    case 'requiere_evidencia': return valor ? 'Pide foto' : 'Sin foto'
    case 'avisar_atraso_min': return `A los ${valor} min`
    case 'tipo_actividad': return { puntual: 'Tarea', continua: 'Recordatorio todo el turno', bloque: 'Bloque' }[String(valor)] ?? String(valor)
    case 'checklist': return Array.isArray(valor) ? (valor.length ? `${valor.length} pasos` : 'Sin pasos') : String(valor)
    case 'estado': return ESTADOS[String(valor)] ?? String(valor)
    case 'motivo': return MOTIVOS[String(valor)] ?? String(valor)
    case 'iniciada_at': case 'completada_at': return horaAr(String(valor))
    case 'evidencia_url': return 'Con foto'
    case 'turno_id': return ctx.turnos.get(Number(valor))?.nombre ?? `Turno ${valor}`
    case 'fecha': case 'fecha_base': case 'vigencia_desde': case 'vigencia_hasta':
      return String(valor).slice(0, 10).split('-').reverse().slice(0, 2).join('/')
    case 'cada_n_dias': return `${valor} días`
    case 'tipo_recurrencia': return { dias_semana: 'Días de la semana', dia_mes: 'Un día del mes', cada_n_dias: 'Cada N días' }[String(valor)] ?? String(valor)
    default:
      if (typeof valor === 'string') return valor === '' ? '—' : valor
      if (typeof valor === 'boolean') return valor ? 'Sí' : 'No'
      return JSON.stringify(valor)
  }
}

function comoObjeto(j: Json | null): Record<string, Json | undefined> {
  return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, Json | undefined>) : {}
}

/** Antes → después de un evento, campo por campo. */
export function cambiosLegibles(ev: TareaEventoRow, ctx: ContextoRegistro): CambioLegible[] {
  const antes = comoObjeto(ev.antes)
  const despues = comoObjeto(ev.despues)
  if (ev.tipo === 'aviso_atraso') {
    const a = despues.para === 'admin' ? 'a los administradores' : 'a la encargada'
    return [{ campo: 'Aviso', antes: null, despues: `${despues.minutos ?? '?'} min de atraso, ${a}: ${despues.avisado_a ?? '—'}` }]
  }
  if (ev.tipo === 'checklist_paso') {
    return [{ campo: 'Paso', antes: null, despues: `${despues.texto ?? `#${Number(despues.paso) + 1}`}: ${despues.hecho ? 'hecho' : 'sin hacer'}` }]
  }
  if (ev.tipo === 'agenda_actualizada') {
    return [{ campo: 'Agenda de hoy', antes: null, despues: `${despues.cambios ?? 0} tareas actualizadas` }]
  }
  const claves = [...new Set([...Object.keys(antes), ...Object.keys(despues)])].filter((k) => !IGNORAR.has(k))
  // En la rutina, "hora" siempre va vacía: el horario está en minutos_desde_inicio.
  let visibles = ev.entidad === 'rutina' ? claves.filter((k) => k !== 'hora') : claves
  // Al crear, el título ya va en la línea del evento y "Privada: No" no aporta.
  if (ev.tipo === 'creada') visibles = visibles.filter((k) => k !== 'titulo' && !(k === 'privada' && !despues.privada))
  return visibles.map((k) => ({
    campo: CAMPOS[k] ?? k,
    antes: k in antes ? valorTexto(k, antes[k], ctx, ev.turno_id) : null,
    despues: k in despues ? valorTexto(k, despues[k], ctx, ev.turno_id) : null,
  }))
}

/** "Sonia", "Sonia en nombre de Camila" o "HEX" (el sistema). */
export function quienFue(ev: Pick<TareaEventoRow, 'actor_nombre' | 'en_nombre_de'>, ctx: ContextoRegistro): string {
  const quien = ev.actor_nombre ?? 'HEX'
  if (!ev.en_nombre_de?.length) return quien
  return `${quien} en nombre de ${nombres(ev.en_nombre_de, ctx)}`
}

export type DiaRegistro<T> = { dia: string; eventos: T[] }

/** Agrupa por día de La Rioja, respetando el orden recibido. */
export function agruparPorDia<T extends { created_at: string }>(eventos: T[]): DiaRegistro<T>[] {
  const grupos: DiaRegistro<T>[] = []
  for (const ev of eventos) {
    const dia = fechaAr(ev.created_at)
    const ultimo = grupos[grupos.length - 1]
    if (ultimo && ultimo.dia === dia) ultimo.eventos.push(ev)
    else grupos.push({ dia, eventos: [ev] })
  }
  return grupos
}

/** Lunes de la semana de una fecha (yyyy-MM-dd). */
export function lunesDe(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** % de cumplimiento como en Cumplimiento: hechas sobre (hechas + sin hacer). */
export function pctCumplimiento(t: { hechas?: number; sin_hacer?: number } | null | undefined): number | null {
  const hechas = t?.hechas ?? 0
  const base = hechas + (t?.sin_hacer ?? 0)
  return base === 0 ? null : Math.round((hechas / base) * 100)
}
