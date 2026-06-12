'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  anularFichaje,
  cerrarDia,
  confirmarImportReloj,
  copiarSemana,
  corregirFichaje,
  eliminarHorario,
  getAsistenciaEmpleado,
  getAsistenciaRango,
  getFichajesDia,
  getHorariosRango,
  getTurnos,
  setPin,
  tienePin,
  upsertHorario,
  vincularReloj,
  type PreviewReloj,
} from '@/lib/queries/asistencia'
import type { HorarioAsignadoInsert, TipoFichaje } from '@/types/database'

export const TURNOS_KEY = ['turnos'] as const
export const HORARIOS_KEY = ['horarios'] as const
export const ASISTENCIA_KEY = ['asistencia'] as const
export const FICHAJES_KEY = ['fichajes'] as const

function invalidarAsistencia(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: HORARIOS_KEY })
  qc.invalidateQueries({ queryKey: ASISTENCIA_KEY })
  qc.invalidateQueries({ queryKey: FICHAJES_KEY })
}

// ─── Turnos ───────────────────────────────────────────────────────────────────

export function useTurnos() {
  return useQuery({
    queryKey: TURNOS_KEY,
    queryFn: getTurnos,
    staleTime: 5 * 60 * 1000,
  })
}

// ─── Horarios + asistencia (grilla) ───────────────────────────────────────────

export function useHorariosRango(desde: string, hasta: string) {
  return useQuery({
    queryKey: [...HORARIOS_KEY, desde, hasta],
    queryFn: () => getHorariosRango(desde, hasta),
    enabled: !!desde && !!hasta,
  })
}

export function useAsistenciaRango(desde: string, hasta: string) {
  return useQuery({
    queryKey: [...ASISTENCIA_KEY, desde, hasta],
    queryFn: () => getAsistenciaRango(desde, hasta),
    enabled: !!desde && !!hasta,
  })
}

export function useAsistenciaEmpleado(
  empleadoId: number | undefined,
  desde: string,
  hasta: string
) {
  return useQuery({
    queryKey: [...ASISTENCIA_KEY, 'empleado', empleadoId, desde, hasta],
    queryFn: () => getAsistenciaEmpleado(empleadoId as number, desde, hasta),
    enabled: !!empleadoId && !!desde && !!hasta,
  })
}

export function useUpsertHorario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (datos: HorarioAsignadoInsert) => upsertHorario(datos),
    onSuccess: () => invalidarAsistencia(qc),
    onError: (e: Error) => toast.error(`No se pudo guardar el horario: ${e.message}`),
  })
}

export function useEliminarHorario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => eliminarHorario(id),
    onSuccess: () => invalidarAsistencia(qc),
    onError: (e: Error) => toast.error(`No se pudo borrar: ${e.message}`),
  })
}

export function useCopiarSemana() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ desde, hacia }: { desde: string; hacia: string }) =>
      copiarSemana(desde, hacia),
    onSuccess: (n) => {
      invalidarAsistencia(qc)
      toast.success(`${n} horario${n === 1 ? '' : 's'} copiado${n === 1 ? '' : 's'}`)
    },
    onError: (e: Error) => toast.error(`No se pudo copiar: ${e.message}`),
  })
}

export function useCerrarDia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (fecha: string) => cerrarDia(fecha),
    onSuccess: () => invalidarAsistencia(qc),
  })
}

// ─── Corrección de fichajes ───────────────────────────────────────────────────

export function useFichajesDia(empleadoId: number | undefined, fecha: string) {
  return useQuery({
    queryKey: [...FICHAJES_KEY, empleadoId, fecha],
    queryFn: () => getFichajesDia(empleadoId as number, fecha),
    enabled: !!empleadoId && !!fecha,
  })
}

export function useCorregirFichaje() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: {
      empleadoId: number
      momento: string
      tipo: TipoFichaje
      motivo: string
    }) => corregirFichaje(args),
    onSuccess: () => {
      invalidarAsistencia(qc)
      toast.success('Marcación agregada')
    },
    onError: (e: Error) => toast.error(`No se pudo corregir: ${e.message}`),
  })
}

export function useAnularFichaje() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      anularFichaje(id, motivo),
    onSuccess: () => {
      invalidarAsistencia(qc)
      toast.success('Marcación anulada')
    },
    onError: (e: Error) => toast.error(`No se pudo anular: ${e.message}`),
  })
}

// ─── Importación del reloj ────────────────────────────────────────────────────

export function useConfirmarImportReloj() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (preview: PreviewReloj) => confirmarImportReloj(preview),
    onSuccess: (r) => {
      invalidarAsistencia(qc)
      qc.invalidateQueries({ queryKey: ['importaciones'] })
      toast.success(
        `Importado: ${r.nuevas} nuevas, ${r.duplicadas} duplicadas` +
          (r.sin_match > 0 ? `, ${r.sin_match} sin vincular` : '')
      )
    },
    onError: (e: Error) => toast.error(`No se pudo importar: ${e.message}`),
  })
}

export function useVincularReloj() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ empleadoId, relojId }: { empleadoId: number; relojId: number }) =>
      vincularReloj(empleadoId, relojId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['empleados'] })
      toast.success('Empleado vinculado al reloj')
    },
    onError: (e: Error) => toast.error(`No se pudo vincular: ${e.message}`),
  })
}

// ─── PIN ──────────────────────────────────────────────────────────────────────

export function useTienePin(empleadoId: number | undefined) {
  return useQuery({
    queryKey: ['tiene-pin', empleadoId],
    queryFn: () => tienePin(empleadoId as number),
    enabled: !!empleadoId,
  })
}

export function useSetPin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ empleadoId, pin }: { empleadoId: number; pin: string }) =>
      setPin(empleadoId, pin),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['tiene-pin', vars.empleadoId] })
      toast.success('PIN actualizado')
    },
    onError: (e: Error) => toast.error(`No se pudo definir el PIN: ${e.message}`),
  })
}
