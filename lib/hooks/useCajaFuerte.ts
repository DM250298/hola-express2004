'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  registrarSangria,
  getSangriasEnBuzon,
  getTotalSangriasTurno,
  getArqueos,
  validarArqueo,
  getRemesas,
  generarRemesa,
  getSaldoCajaFuerte,
  type ValidarArqueoPayload,
  type GenerarRemesaPayload,
} from '@/lib/queries/cajaFuerte'
import { getTotalRemesado } from '@/lib/queries/posicionCaja'

export const CAJA_FUERTE_KEY = ['caja-fuerte'] as const

export function useSangriasEnBuzon() {
  return useQuery({
    queryKey: [...CAJA_FUERTE_KEY, 'buzon'],
    queryFn: getSangriasEnBuzon,
    staleTime: 30 * 1000,
  })
}

export function useSaldoCajaFuerte() {
  return useQuery({
    queryKey: [...CAJA_FUERTE_KEY, 'saldo'],
    queryFn: getSaldoCajaFuerte,
    staleTime: 30 * 1000,
  })
}

/**
 * Total histórico remesado. Bajo la key de caja fuerte para que las mutaciones
 * del circuito (sangría/arqueo/remesa) lo invaliden solas.
 */
export function useTotalRemesado() {
  return useQuery({
    queryKey: [...CAJA_FUERTE_KEY, 'remesado-total'],
    queryFn: getTotalRemesado,
    staleTime: 30 * 1000,
  })
}

export function useArqueos() {
  return useQuery({
    queryKey: [...CAJA_FUERTE_KEY, 'arqueos'],
    queryFn: () => getArqueos(),
    staleTime: 30 * 1000,
  })
}

export function useRemesas() {
  return useQuery({
    queryKey: [...CAJA_FUERTE_KEY, 'remesas'],
    queryFn: () => getRemesas(),
    staleTime: 30 * 1000,
  })
}

export function useTotalSangriasTurno(turnoId: number | undefined) {
  return useQuery({
    queryKey: [...CAJA_FUERTE_KEY, 'turno', turnoId],
    queryFn: () => getTotalSangriasTurno(turnoId as number),
    enabled: turnoId != null,
    staleTime: 15 * 1000,
  })
}

function invalidarTodo(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: CAJA_FUERTE_KEY })
}

export function useRegistrarSangria() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      turno_id: number
      usuario_id: string
      monto: number
      nota: string | null
    }) => registrarSangria(payload),
    onSuccess: () => {
      invalidarTodo(qc)
      toast.success('Sangría registrada · sobre en el buzón')
    },
    onError: (e: Error) =>
      toast.error(`No se pudo registrar la sangría: ${e.message}`),
  })
}

export function useValidarArqueo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: ValidarArqueoPayload) => validarArqueo(payload),
    onSuccess: (data) => {
      invalidarTodo(qc)
      const dif = Number(
        (data as { diferencia?: number } | null)?.diferencia ?? 0
      )
      if (dif === 0) {
        toast.success('Arqueo validado · sin diferencias')
      } else {
        toast.warning(
          `Arqueo cerrado con diferencia de ${dif}. Quedó registrada la nota de ajuste.`
        )
      }
    },
    onError: (e: Error) => toast.error(`No se pudo validar: ${e.message}`),
  })
}

export function useGenerarRemesa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: GenerarRemesaPayload) => generarRemesa(payload),
    onSuccess: () => {
      invalidarTodo(qc)
      qc.invalidateQueries({ queryKey: ['cuentas'] })
      qc.invalidateQueries({ queryKey: ['movimientos-cuenta'] })
      // La posición de caja del Tablero y el saldo inicial del flujo dependen
      // de cuentas + remesado: refrescarlos para que no diverjan hasta 60s.
      qc.invalidateQueries({ queryKey: ['tablero-directivo'] })
      qc.invalidateQueries({ queryKey: ['flujo-proyectado'] })
      toast.success('Remesa generada · ingresada al banco')
    },
    onError: (e: Error) => toast.error(`No se pudo generar la remesa: ${e.message}`),
  })
}
