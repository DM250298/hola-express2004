'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  entregarPaseTurno,
  getBorradorPase,
  getPasesPendientesRecibir,
  getPasesTurno,
  getUltimoPaseRecibido,
  recibirPaseTurno,
  type EntregarPaseArgs,
  type RecibirPaseArgs,
} from '@/lib/queries/paseTurno'
import { DASHBOARD_RRHH_KEY } from './useDesempeno'

export const PASES_KEY = ['pases-turno'] as const

export function usePasesTurno(desde: string, hasta: string) {
  return useQuery({
    queryKey: [...PASES_KEY, 'rango', desde, hasta],
    queryFn: () => getPasesTurno(desde, hasta),
    enabled: !!desde && !!hasta && desde <= hasta,
    staleTime: 30 * 1000,
  })
}

export function usePasesPendientesRecibir() {
  return useQuery({
    queryKey: [...PASES_KEY, 'pendientes'],
    queryFn: getPasesPendientesRecibir,
    refetchInterval: 60 * 1000,
    staleTime: 20 * 1000,
  })
}

export function useUltimoPaseRecibido() {
  return useQuery({
    queryKey: [...PASES_KEY, 'ultimo-recibido'],
    queryFn: getUltimoPaseRecibido,
    staleTime: 30 * 1000,
  })
}

export function useBorradorPase(fecha: string, turnoSalienteId: number | null) {
  return useQuery({
    queryKey: [...PASES_KEY, 'borrador', fecha, turnoSalienteId],
    queryFn: () => getBorradorPase(fecha, turnoSalienteId as number),
    enabled: !!fecha && turnoSalienteId != null,
    staleTime: 10 * 1000,
  })
}

export function useEntregarPaseTurno() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (a: EntregarPaseArgs) => entregarPaseTurno(a),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: PASES_KEY })
      qc.invalidateQueries({ queryKey: DASHBOARD_RRHH_KEY })
      toast.success(
        p.estado === 'entregado'
          ? 'Pase de turno entregado. El turno entrante debe recibirlo.'
          : 'Borrador guardado'
      )
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useRecibirPaseTurno() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (a: RecibirPaseArgs) => recibirPaseTurno(a),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: PASES_KEY })
      qc.invalidateQueries({ queryKey: DASHBOARD_RRHH_KEY })
      const noConf = [
        p.conforme_reposicion,
        p.conforme_orden,
        p.conforme_novedades,
        p.conforme_pendientes,
      ].filter((c) => c === false).length
      if (noConf > 0) toast.warning(`Pase recibido con ${noConf} bloque(s) no conforme(s).`)
      else toast.success('Pase recibido conforme')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
