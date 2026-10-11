'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  anularSancion,
  aplicarSancion,
  cerrarIncidencia,
  getIncidencias,
  getIncidenciasEmpleado,
  getResumenReincidencias,
  getSanciones,
  getTipologias,
  registrarIncidencia,
  type AplicarSancionArgs,
  type FiltrosIncidencias,
  type RegistrarIncidenciaArgs,
} from '@/lib/queries/incidencias'
import { DASHBOARD_RRHH_KEY } from './useDesempeno'

export const TIPOLOGIAS_KEY = ['tipologias-incidencia'] as const
export const INCIDENCIAS_KEY = ['incidencias'] as const
export const SANCIONES_KEY = ['sanciones'] as const

/** Mensaje del toast según la instancia que calculó el server (Manual §8). */
export function mensajeInstancia(instancia: number, escalada: boolean): string {
  if (escalada && instancia < 3) return 'Incidencia GRAVE registrada: escalar a Dirección ahora.'
  if (instancia >= 3) return '3ª en 30 días: escalar a Resp. General y Dirección.'
  if (instancia === 2) return '2ª en 30 días: corresponde observación formal interna.'
  return 'Incidencia registrada (1ª en 30 días): corrección inmediata.'
}

// ─── Tipologías ──────────────────────────────────────────────────────

export function useTipologias() {
  return useQuery({
    queryKey: TIPOLOGIAS_KEY,
    queryFn: getTipologias,
    staleTime: 10 * 60 * 1000,
  })
}

// ─── Incidencias ─────────────────────────────────────────────────────

export function useIncidencias(f: FiltrosIncidencias, habilitado = true) {
  return useQuery({
    queryKey: [...INCIDENCIAS_KEY, 'lista', f],
    queryFn: () => getIncidencias(f),
    enabled: habilitado && !!f.desde && !!f.hasta,
    staleTime: 30 * 1000,
  })
}

export function useIncidenciasEmpleado(empleadoId: number | null | undefined) {
  return useQuery({
    queryKey: [...INCIDENCIAS_KEY, 'empleado', empleadoId],
    queryFn: () => getIncidenciasEmpleado(empleadoId as number),
    enabled: !!empleadoId,
    staleTime: 30 * 1000,
  })
}

export function useResumenReincidencias(
  empleadoId: number | null,
  tipologiaId: number | null,
  fecha?: string | null
) {
  return useQuery({
    queryKey: [...INCIDENCIAS_KEY, 'resumen', empleadoId, tipologiaId, fecha ?? null],
    queryFn: () => getResumenReincidencias(empleadoId as number, tipologiaId as number, fecha),
    enabled: !!empleadoId && !!tipologiaId,
    staleTime: 10 * 1000,
  })
}

export function useRegistrarIncidencia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (a: RegistrarIncidenciaArgs) => registrarIncidencia(a),
    onSuccess: (inc) => {
      qc.invalidateQueries({ queryKey: INCIDENCIAS_KEY })
      qc.invalidateQueries({ queryKey: DASHBOARD_RRHH_KEY })
      const msg = mensajeInstancia(inc.instancia, inc.escalada)
      if (inc.escalada) toast.warning(msg, { duration: 8000 })
      else toast.success(msg)
    },
    onError: (e: Error) => toast.error(`No se pudo registrar: ${e.message}`),
  })
}

export function useCerrarIncidencia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, accion }: { id: number; accion?: string | null }) =>
      cerrarIncidencia(id, accion),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INCIDENCIAS_KEY })
      qc.invalidateQueries({ queryKey: DASHBOARD_RRHH_KEY })
      toast.success('Incidencia cerrada')
    },
    onError: (e: Error) => toast.error(`No se pudo cerrar: ${e.message}`),
  })
}

// ─── Sanciones ───────────────────────────────────────────────────────

export function useSanciones(empleadoId?: number | null, habilitado = true) {
  return useQuery({
    queryKey: [...SANCIONES_KEY, empleadoId ?? 'todas'],
    queryFn: () => getSanciones(empleadoId),
    enabled: habilitado,
    staleTime: 30 * 1000,
  })
}

export function useAplicarSancion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (a: AplicarSancionArgs) => aplicarSancion(a),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: SANCIONES_KEY })
      qc.invalidateQueries({ queryKey: INCIDENCIAS_KEY })
      qc.invalidateQueries({ queryKey: DASHBOARD_RRHH_KEY })
      toast.success(
        s.va_al_legajo
          ? 'Sanción aplicada y asentada en el legajo'
          : 'Llamado de atención registrado (no va al legajo)'
      )
    },
    onError: (e: Error) => toast.error(`No se pudo aplicar: ${e.message}`),
  })
}

export function useAnularSancion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, motivo }: { id: number; motivo: string }) => anularSancion(id, motivo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SANCIONES_KEY })
      toast.success('Sanción anulada')
    },
    onError: (e: Error) => toast.error(`No se pudo anular: ${e.message}`),
  })
}
