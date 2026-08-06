'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  buscarDeudores,
  cobrarCtaCte,
  getCarteraFiado,
  getLimiteCredito,
  getLimiteSugeridoEmpleado,
  getMovimientosDeudor,
  setLimiteCredito,
  type CobrarCtaCtePayload,
  type SetLimitePayload,
} from '@/lib/queries/ctaCte'
import { CTA_CTE_KEY, EMPLEADOS_SALDO_KEY } from '@/lib/hooks/useCtaCteEmpleado'
import { CLIENTES_KEY } from '@/lib/hooks/useClientes'
import type { QueryClient } from '@tanstack/react-query'
import type { TipoDeudorCtaCte } from '@/types/database'

export const CARTERA_FIADO_KEY = ['cartera-fiado'] as const
export const MOVIMIENTOS_DEUDOR_KEY = ['movimientos-deudor'] as const
export const LIMITE_CREDITO_KEY = ['limite-credito'] as const

/**
 * Invalidación en cascada tras un movimiento de fiado (venta fiada, cobro,
 * cambio de tope): cartera, movimientos, saldos del CRM y de RRHH.
 */
export function invalidarFiado(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: CARTERA_FIADO_KEY })
  qc.invalidateQueries({ queryKey: MOVIMIENTOS_DEUDOR_KEY })
  qc.invalidateQueries({ queryKey: LIMITE_CREDITO_KEY })
  qc.invalidateQueries({ queryKey: CLIENTES_KEY })
  qc.invalidateQueries({ queryKey: CTA_CTE_KEY })
  qc.invalidateQueries({ queryKey: EMPLEADOS_SALDO_KEY })
}

/** Cartera completa de deudores (tab Fiado). */
export function useCarteraFiado(busqueda?: string) {
  return useQuery({
    queryKey: [...CARTERA_FIADO_KEY, busqueda ?? ''],
    queryFn: () => getCarteraFiado(busqueda),
    staleTime: 30 * 1000,
  })
}

/** Buscador liviano de deudores para el POS (debounced por el caller). */
export function useBuscarDeudores(busqueda: string, habilitado = true) {
  return useQuery({
    queryKey: [...CARTERA_FIADO_KEY, 'buscar', busqueda],
    queryFn: () => buscarDeudores(busqueda),
    enabled: habilitado,
    staleTime: 15 * 1000,
  })
}

/** Movimientos de un deudor (cliente o empleado). */
export function useMovimientosDeudor(
  deudorTipo: TipoDeudorCtaCte | null,
  deudorId: number | null
) {
  return useQuery({
    queryKey: [...MOVIMIENTOS_DEUDOR_KEY, deudorTipo, deudorId],
    queryFn: () =>
      getMovimientosDeudor(deudorTipo as TipoDeudorCtaCte, deudorId as number),
    enabled: !!deudorTipo && !!deudorId,
    staleTime: 15 * 1000,
  })
}

/** Tope de fiado de un deudor. */
export function useLimiteCredito(
  deudorTipo: TipoDeudorCtaCte | null,
  deudorId: number | null
) {
  return useQuery({
    queryKey: [...LIMITE_CREDITO_KEY, deudorTipo, deudorId],
    queryFn: () =>
      getLimiteCredito(deudorTipo as TipoDeudorCtaCte, deudorId as number),
    enabled: !!deudorTipo && !!deudorId,
    staleTime: 30 * 1000,
  })
}

export function useSetLimiteCredito() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: SetLimitePayload) => setLimiteCredito(payload),
    onSuccess: () => {
      invalidarFiado(qc)
      toast.success('Tope de fiado actualizado')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Sugerencia de tope del empleado (fetch imperativo, solo rrhh_sueldos). */
export function useLimiteSugeridoEmpleado() {
  return useMutation({
    mutationFn: (empleadoId: number) => getLimiteSugeridoEmpleado(empleadoId),
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Cobro de fiado (efectivo del POS o tesorería). */
export function useCobrarCtaCte() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CobrarCtaCtePayload) => cobrarCtaCte(payload),
    onSuccess: (_r, payload) => {
      invalidarFiado(qc)
      // Cobro por tesorería mueve cuentas; cobro en caja mueve el esperado.
      qc.invalidateQueries({ queryKey: ['cuentas'] })
      qc.invalidateQueries({ queryKey: ['movimientos-cuenta'] })
      qc.invalidateQueries({ queryKey: ['asientos'] })
      if (payload.turno_id) {
        qc.invalidateQueries({ queryKey: ['resumen-turno'] })
      }
      toast.success('Cobro registrado')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
