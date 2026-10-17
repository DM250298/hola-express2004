'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  cancelarTarea,
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
import type { AplicaDesde } from '@/types/database'

export const PLANTILLAS_KEY = ['tareas-plantillas'] as const
export const TAREAS_KEY = ['tareas-turno'] as const
export const CUMPLIMIENTO_KEY = ['tareas-cumplimiento'] as const

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
