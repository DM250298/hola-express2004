'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  actualizarEgreso,
  crearEgreso,
  eliminarEgreso,
  getCuentasAPagar,
  getEgresos,
  getResumenFinanciero,
  pagarCuenta,
  type ActualizarEgresoPayload,
  type EstadoCuentaDerivado,
  type NuevoEgresoPayload,
  type PagarCuentaPayload,
} from '@/lib/queries/finanzas'

export const RESUMEN_FIN_KEY = ['resumen-financiero'] as const
export const CUENTAS_PAGAR_KEY = ['cuentas-a-pagar'] as const
export const EGRESOS_KEY = ['egresos'] as const

export function useResumenFinanciero(desde: string, hasta: string) {
  return useQuery({
    queryKey: [...RESUMEN_FIN_KEY, desde, hasta],
    queryFn: () => getResumenFinanciero(desde, hasta),
    staleTime: 60 * 1000,
  })
}

export function useCuentasAPagar(estado?: EstadoCuentaDerivado | null) {
  return useQuery({
    queryKey: [...CUENTAS_PAGAR_KEY, estado ?? 'todas'],
    queryFn: () => getCuentasAPagar(estado),
    staleTime: 30 * 1000,
  })
}

export function useEgresos(
  desde: string,
  hasta: string,
  categoria?: string | null
) {
  return useQuery({
    queryKey: [...EGRESOS_KEY, desde, hasta, categoria ?? 'todas'],
    queryFn: () => getEgresos(desde, hasta, categoria),
    staleTime: 30 * 1000,
  })
}

export function usePagarCuenta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: PagarCuentaPayload) => pagarCuenta(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CUENTAS_PAGAR_KEY })
      qc.invalidateQueries({ queryKey: EGRESOS_KEY })
      qc.invalidateQueries({ queryKey: RESUMEN_FIN_KEY })
      toast.success('Cuenta marcada como pagada')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo pagar la cuenta: ${error.message}`)
    },
  })
}

function invalidarEgresos(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: EGRESOS_KEY })
  qc.invalidateQueries({ queryKey: RESUMEN_FIN_KEY })
  // El cierre de caja descuenta los gastos del turno.
  qc.invalidateQueries({ queryKey: ['resumen-turno'] })
}

export function useCrearEgreso() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: NuevoEgresoPayload) => crearEgreso(payload),
    onSuccess: () => {
      invalidarEgresos(qc)
      toast.success('Gasto registrado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo registrar el gasto: ${error.message}`)
    },
  })
}

export function useActualizarEgreso() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      datos,
    }: {
      id: number
      datos: ActualizarEgresoPayload
    }) => actualizarEgreso(id, datos),
    onSuccess: () => {
      invalidarEgresos(qc)
      toast.success('Gasto actualizado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo actualizar el gasto: ${error.message}`)
    },
  })
}

export function useEliminarEgreso() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => eliminarEgreso(id),
    onSuccess: () => {
      invalidarEgresos(qc)
      toast.success('Gasto eliminado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo eliminar el gasto: ${error.message}`)
    },
  })
}
