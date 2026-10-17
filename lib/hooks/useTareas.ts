'use client'

import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import {
  cancelarTarea,
  checklistPaso,
  getAQuienLeToca,
  getCambiosSemana,
  getPedidosPendientes,
  getPersonasTurno,
  guardarNotaTarea,
  noSePudoTarea,
  resolverPedido,
  completarTarea,
  crearTareaPuntual,
  editarTarea,
  getCumplimiento,
  getHistorialTarea,
  getPlantillas,
  getTareasAgenda,
  getTareasFecha,
  getTareasRango,
  guardarPlantilla,
  iniciarTarea,
  materializarFecha,
  omitirTarea,
  quitarPlantilla,
  reabrirTarea,
  reactivarPlantilla,
  reasignarTarea,
  rechazarTarea,
  trasladarTarea,
  type CambiosTarea,
  type DatosRutina,
  type NuevaTareaPuntual,
} from '@/lib/queries/tareas'
import type { AplicaDesde, MotivoNoSePudo } from '@/types/database'

export const PLANTILLAS_KEY = ['tareas-plantillas'] as const
export const TAREAS_KEY = ['tareas-turno'] as const
export const CUMPLIMIENTO_KEY = ['tareas-cumplimiento'] as const
export const PEDIDOS_KEY = ['tareas-pedidos'] as const

// ─── Plantillas ────────────────────────────────────────────────────────────────

export function usePlantillas() {
  return useQuery({
    queryKey: PLANTILLAS_KEY,
    queryFn: getPlantillas,
    staleTime: 60 * 1000,
  })
}

/**
 * Crea o edita una tarea de la rutina por fn_rutina_guardar (mig 279).
 * Los cambios rigen desde mañana salvo que se elija "hoy".
 */
export function useGuardarPlantilla() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      datos,
      asignados,
      aplicar,
    }: {
      id: string | null
      datos: DatosRutina
      asignados: number[] | null
      aplicar: AplicaDesde
    }) => guardarPlantilla(id, datos, asignados, aplicar),
    onSuccess: (_id, vars) => {
      qc.invalidateQueries({ queryKey: PLANTILLAS_KEY })
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      const desde = vars.aplicar === 'hoy' ? 'desde hoy' : 'desde mañana'
      toast.success(vars.id ? `Rutina actualizada (rige ${desde})` : `Tarea agregada a la rutina (rige ${desde})`)
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/**
 * Quita una tarea de la rutina. Un administrador la desactiva; la encargada
 * deja un pedido para que lo apruebe un administrador.
 */
export function useQuitarPlantilla() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, motivo, aplicar }: { id: string; motivo: string | null; aplicar?: AplicaDesde }) =>
      quitarPlantilla(id, motivo, aplicar),
    onSuccess: (pedido, vars) => {
      qc.invalidateQueries({ queryKey: PLANTILLAS_KEY })
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      toast.success(
        pedido
          ? 'Pedido enviado: un administrador tiene que aprobarlo'
          : vars.aplicar === 'hoy'
            ? 'Tarea quitada de la rutina desde hoy'
            : 'Tarea quitada de la rutina desde mañana'
      )
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Vuelve a poner una tarea en la rutina (solo administrador). */
export function useReactivarPlantilla() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, aplicar }: { id: string; aplicar?: AplicaDesde }) => reactivarPlantilla(id, aplicar),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PLANTILLAS_KEY })
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      toast.success('La tarea vuelve a la rutina')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// ─── Instancias (tareas del día) ─────────────────────────────────────────────

export function useTareasFecha(fecha: string) {
  return useQuery({
    queryKey: [...TAREAS_KEY, fecha],
    queryFn: () => getTareasFecha(fecha),
    enabled: !!fecha,
    staleTime: 15 * 1000,
  })
}

/** Instancias de un rango (drill-down del cumplimiento; solo gestión). */
export function useTareasRango(
  desde: string,
  hasta: string,
  filtros?: { plantillaId?: string | null; titulo?: string },
  habilitado = true
) {
  return useQuery({
    queryKey: [...TAREAS_KEY, 'rango', desde, hasta, filtros ?? null],
    queryFn: () => getTareasRango(desde, hasta, filtros),
    enabled: habilitado && !!desde && !!hasta,
    staleTime: 30 * 1000,
  })
}

/** Crea una tarea puntual: N individuales ("cada uno") o 1 grupal (mig 276). */
export function useCrearTareaPuntual() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (datos: NuevaTareaPuntual) => crearTareaPuntual(datos),
    onSuccess: (ids, vars) => {
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      toast.success(
        vars.modo === 'grupal' || ids.length === 1
          ? 'Tarea creada'
          : `Tarea creada para ${ids.length} personas`
      )
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/**
 * Guarda los cambios de una tarea abierta: contenido por fn_tarea_editar y,
 * si cambió la persona, fn_agenda_mover (queda como asignación manual).
 */
export function useEditarTarea() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      cambios,
      asignados,
    }: {
      id: string
      cambios: CambiosTarea
      asignados?: number[] | null
    }) => {
      await editarTarea(id, cambios)
      if (asignados) await reasignarTarea(id, asignados)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      toast.success('Tarea actualizada')
    },
    onError: (e: Error) => {
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      toast.error(e.message)
    },
  })
}

/** Cancela una tarea (reemplaza a "Eliminar": queda en el registro). */
export function useCancelarTarea() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo?: string | null }) => cancelarTarea(id, motivo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      qc.invalidateQueries({ queryKey: CUMPLIMIENTO_KEY })
      toast.success('Tarea cancelada')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Historial de cambios de una tarea (quién, cuándo, en nombre de quién). */
export function useHistorialTarea(id: string | null) {
  return useQuery({
    queryKey: [...TAREAS_KEY, 'historial', id],
    queryFn: () => getHistorialTarea(id as string),
    enabled: !!id,
    staleTime: 15 * 1000,
  })
}

export function useCompletarTarea() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      evidenciaUrl,
      nota,
    }: {
      id: string
      evidenciaUrl?: string | null
      nota?: string | null
    }) => completarTarea(id, evidenciaUrl, nota),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      toast.success('¡Tarea completada!')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Agenda del día (mig 251): tareas de la fecha + las de ayer (noche viva). */
export function useTareasAgenda(fecha: string) {
  return useQuery({
    queryKey: [...TAREAS_KEY, 'agenda', fecha],
    queryFn: () => getTareasAgenda(fecha),
    enabled: !!fecha,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  })
}

export function useIniciarTarea() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => iniciarTarea(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      toast.success('Tarea en curso')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Solo gestión: vuelve a pendiente una completada, omitida o vencida. */
export function useReabrirTarea() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => reabrirTarea(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      qc.invalidateQueries({ queryKey: CUMPLIMIENTO_KEY })
      toast.success('Tarea reabierta: vuelve a pendiente')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Omite con motivo (impedimento): queda cancelada y no cuenta en cumplimiento. */
export function useOmitirTarea() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) => omitirTarea(id, motivo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      qc.invalidateQueries({ queryKey: CUMPLIMIENTO_KEY })
      toast.success('Tarea omitida con motivo')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Traslada al turno siguiente con trazabilidad (mig 253). */
export function useTrasladarTarea() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => trasladarTarea(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      qc.invalidateQueries({ queryKey: CUMPLIMIENTO_KEY })
      toast.success('Tarea trasladada al turno siguiente')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Rechaza una completada: vuelve a pendiente con el motivo registrado. */
export function useRechazarTarea() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      rechazarTarea(id, motivo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      qc.invalidateQueries({ queryKey: CUMPLIMIENTO_KEY })
      toast.success('Tarea rechazada: vuelve a pendiente')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Agregados de cumplimiento por rango (pantalla de control; solo gestión). */
export function useCumplimiento(desde: string, hasta: string) {
  return useQuery({
    queryKey: [...CUMPLIMIENTO_KEY, desde, hasta],
    queryFn: () => getCumplimiento(desde, hasta),
    enabled: !!desde && !!hasta,
    staleTime: 30 * 1000,
  })
}

/**
 * Botón "Actualizar según cronograma": misma RPC que la materialización
 * (mig 250, sincroniza con francos/licencias/coberturas) pero siempre avisa
 * y refresca el tablero.
 */
export function useSincronizarTareas() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (fecha: string) => materializarFecha(fecha),
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      toast.success(
        n > 0
          ? `Se aplicaron ${n} ${n === 1 ? 'cambio' : 'cambios'} según el cronograma`
          : 'Las tareas ya estaban al día con el cronograma'
      )
    },
    onError: (e: Error) => toast.error(`No se pudo actualizar: ${e.message}`),
  })
}

/** Genera y sincroniza las tareas recurrentes del día al entrar (fallback del cron). */
export function useMaterializar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (fecha: string) => materializarFecha(fecha),
    onSuccess: (n) => {
      if (n > 0) qc.invalidateQueries({ queryKey: TAREAS_KEY })
    },
  })
}

// ─── Etapa 2: agenda en calendario ────────────────────────────────────────────

/**
 * Agenda en vivo (mig 289): cualquier cambio en tareas_turno o sus
 * participantes refresca la agenda. Realtime respeta las reglas de acceso,
 * así que a cada uno le llegan solo los cambios de lo que puede ver.
 */
export function useRealtimeTareas() {
  const qc = useQueryClient()
  useEffect(() => {
    const supabase = createClient()
    const refrescar = () => qc.invalidateQueries({ queryKey: TAREAS_KEY })
    let canal: ReturnType<typeof supabase.channel> | null = null
    let cancelado = false
    // El canal tiene que salir con la sesión del usuario: si se suscribe
    // antes, Realtime lo trata como anónimo y las reglas de acceso no le
    // dejan ver ninguna tarea (no llega ningún cambio).
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelado) return
      if (data.session) await supabase.realtime.setAuth(data.session.access_token)
      canal = supabase
        .channel('tareas-agenda')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tareas_turno' }, refrescar)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tareas_turno_participantes' }, refrescar)
        .subscribe((estado, err) => {
          // Sin conexión en vivo la agenda igual se refresca cada 60 s: avisar
          // en la consola para poder diagnosticarlo.
          if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT') {
            console.warn('[tareas en vivo]', estado, err?.message ?? '')
          } else if (estado === 'SUBSCRIBED') {
            console.info('[tareas en vivo] conectado')
          }
        })
    })
    return () => {
      cancelado = true
      if (canal) supabase.removeChannel(canal)
    }
  }, [qc])
}

/** Cierra como "No se pudo" con motivo y detalle. */
export function useNoSePudo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, motivo, detalle }: { id: string; motivo: MotivoNoSePudo; detalle?: string | null }) =>
      noSePudoTarea(id, motivo, detalle),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      qc.invalidateQueries({ queryKey: CUMPLIMIENTO_KEY })
      toast.success('Quedó como "No se pudo"')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Tilda un paso del checklist. */
export function useChecklistPaso() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, paso, hecho }: { id: string; paso: number; hecho: boolean }) => checklistPaso(id, paso, hecho),
    onSuccess: () => qc.invalidateQueries({ queryKey: TAREAS_KEY }),
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Guarda la nota para el próximo turno. */
export function useNotaTarea() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, nota }: { id: string; nota: string | null }) => guardarNotaTarea(id, nota),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      toast.success('Nota guardada')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Quién trabaja un turno ese día (vista por persona). */
export function usePersonasTurno(fecha: string, turnoId: number | null, habilitado = true) {
  return useQuery({
    queryKey: [...TAREAS_KEY, 'personas', fecha, turnoId],
    queryFn: () => getPersonasTurno(fecha, turnoId as number),
    enabled: habilitado && !!fecha && turnoId !== null,
    staleTime: 60 * 1000,
  })
}

/** A quién le toca una tarea por puesto ese día (Nueva tarea). */
export function useAQuienLeToca(fecha: string, turnoId: number | null, puestos: string[]) {
  return useQuery({
    queryKey: [...TAREAS_KEY, 'le-toca', fecha, turnoId, [...puestos].sort().join(',')],
    queryFn: () => getAQuienLeToca(fecha, turnoId as number, puestos),
    enabled: !!fecha && turnoId !== null && puestos.length > 0,
    staleTime: 60 * 1000,
  })
}

/** Pedidos de quitar pendientes (para "Para revisar"). */
export function usePedidosPendientes(habilitado = true) {
  return useQuery({
    queryKey: PEDIDOS_KEY,
    queryFn: getPedidosPendientes,
    enabled: habilitado,
    staleTime: 30 * 1000,
  })
}

/** Cambios de la semana hechos por personas (solo administrador). */
export function useCambiosSemana(habilitado = true) {
  return useQuery({
    queryKey: [...PEDIDOS_KEY, 'cambios-semana'],
    queryFn: getCambiosSemana,
    enabled: habilitado,
    staleTime: 60 * 1000,
  })
}

/** El administrador aprueba o rechaza un pedido de quitar. */
export function useResolverPedido() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, aprobar, nota }: { id: number; aprobar: boolean; nota?: string | null }) =>
      resolverPedido(id, aprobar, nota),
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: PEDIDOS_KEY })
      qc.invalidateQueries({ queryKey: PLANTILLAS_KEY })
      qc.invalidateQueries({ queryKey: TAREAS_KEY })
      toast.success(vars.aprobar ? 'Aprobado: la tarea sale de la rutina desde mañana' : 'Pedido rechazado')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
