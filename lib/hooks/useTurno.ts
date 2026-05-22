'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  abrirTurno,
  cerrarTurno,
  getTurnoActivo,
} from '@/lib/queries/turnos'

export const TURNO_KEY = ['turno-activo'] as const

export function useTurnoActivo(usuarioId: string | undefined) {
  return useQuery({
    queryKey: [...TURNO_KEY, usuarioId],
    queryFn: () => {
      if (!usuarioId) return null
      return getTurnoActivo(usuarioId)
    },
    enabled: !!usuarioId,
    staleTime: 30 * 1000,
  })
}

export function useAbrirTurno() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      usuarioId,
      montoApertura,
    }: {
      usuarioId: string
      montoApertura: number
    }) => abrirTurno(usuarioId, montoApertura),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TURNO_KEY })
      toast.success('Turno abierto')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo abrir el turno: ${error.message}`)
    },
  })
}

export function useCerrarTurno() {
  // Nota: NO se invalida TURNO_KEY acá. Si se invalidara, el turno pasaría a
  // null al instante y la pantalla saltaría a "Abrir caja", desmontando el
  // modal del informe de cierre antes de que el cajero lo vea/imprima.
  // La invalidación se hace recién al cerrar ese modal (ver CierreCaja).
  return useMutation({
    mutationFn: ({
      turnoId,
      montoCierreReal,
      novedades,
    }: {
      turnoId: number
      montoCierreReal: number
      novedades: string | null
    }) => cerrarTurno(turnoId, montoCierreReal, novedades),
    onSuccess: () => {
      toast.success('Turno cerrado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo cerrar el turno: ${error.message}`)
    },
  })
}
