'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  actualizarEgreso,
  crearEgreso,
  editarCuentaAPagar,
  eliminarEgreso,
  getCuentaAPagarPorId,
  getCuentasAPagar,
  getCuentasSinFactura,
  getEgresos,
  getPagosCuenta,
  getResumenFinanciero,
  pagarCuenta,
  type ActualizarEgresoPayload,
  type EditarCuentaPayload,
  type FiltroEstadoCuentas,
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

export function useCuentasAPagar(estado?: FiltroEstadoCuentas) {
  return useQuery({
    queryKey: [...CUENTAS_PAGAR_KEY, estado ?? 'todas'],
    queryFn: () => getCuentasAPagar(estado),
    staleTime: 30 * 1000,
  })
}

/** Cuentas sin factura cargada (three-way match), filtradas server-side. */
export function useCuentasSinFactura() {
  return useQuery({
    queryKey: [...CUENTAS_PAGAR_KEY, 'sin-factura'],
    queryFn: () => getCuentasSinFactura(),
    staleTime: 30 * 1000,
  })
}

/**
 * Fetch imperativo de una cuenta por id (con caché). Para resolver bajo
 * demanda cuentas pagadas viejas que quedaron fuera de la ventana de 500
 * del listado (ej. botón "Ver" de un comprobante histórico).
 */
export function useBuscarCuentaAPagar() {
  const qc = useQueryClient()
  return (id: number) =>
    qc.fetchQuery({
      queryKey: [...CUENTAS_PAGAR_KEY, 'por-id', id],
      queryFn: () => getCuentaAPagarPorId(id),
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

function invalidarTrasPago(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: CUENTAS_PAGAR_KEY })
  qc.invalidateQueries({ queryKey: EGRESOS_KEY })
  qc.invalidateQueries({ queryKey: RESUMEN_FIN_KEY })
  // El pago descuenta del saldo de una cuenta de tesorería y deja movimiento.
  qc.invalidateQueries({ queryKey: ['cuentas'] })
  qc.invalidateQueries({ queryKey: ['movimientos-cuenta'] })
  qc.invalidateQueries({ queryKey: ['pagos-cuenta'] })
  // El tablero directivo y los asientos también cambian.
  qc.invalidateQueries({ queryKey: ['tablero-directivo'] })
  qc.invalidateQueries({ queryKey: ['asientos'] })
}

export function usePagarCuenta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: PagarCuentaPayload) => pagarCuenta(payload),
    onSuccess: () => {
      invalidarTrasPago(qc)
      toast.success('Pago registrado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo registrar el pago: ${error.message}`)
    },
  })
}

export function usePagosCuenta(cuentaAPagarId: number | null) {
  return useQuery({
    queryKey: ['pagos-cuenta', cuentaAPagarId],
    queryFn: () =>
      cuentaAPagarId === null ? [] : getPagosCuenta(cuentaAPagarId),
    enabled: cuentaAPagarId !== null,
    staleTime: 15 * 1000,
  })
}

export function useEditarCuentaAPagar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: EditarCuentaPayload) => editarCuentaAPagar(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CUENTAS_PAGAR_KEY })
      toast.success('Cuenta actualizada')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo actualizar: ${error.message}`)
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
