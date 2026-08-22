'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  actualizarEgreso,
  anularEgreso,
  cancelarPagoProgramado,
  crearEgreso,
  definirCuotasCuenta,
  editarCuentaAPagar,
  ejecutarPagoProgramado,
  getCuentaAPagarPorId,
  getCuentasAPagar,
  getCuentasSinFactura,
  getEgresos,
  getPagosCuenta,
  getPagosProgramados,
  getResumenFinanciero,
  pagarCuenta,
  type ActualizarEgresoPayload,
  type DefinirCuotasPayload,
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
  // El pago saca deuda de las semanas futuras del flujo proyectado.
  qc.invalidateQueries({ queryKey: ['flujo-proyectado'] })
  // El pago desde la bóveda mueve su saldo (banner de descuadre incluido).
  qc.invalidateQueries({ queryKey: ['caja-fuerte'] })
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

// ─── Pagos programados (mig 146) ─────────────────────────────────────────────

export const PAGOS_PROGRAMADOS_KEY = ['pagos-programados'] as const

export function usePagosProgramados() {
  return useQuery({
    queryKey: PAGOS_PROGRAMADOS_KEY,
    queryFn: getPagosProgramados,
    staleTime: 30 * 1000,
  })
}

export function useEjecutarPagoProgramado() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      programadoId,
      usuarioId,
      comprobante,
    }: {
      programadoId: number
      usuarioId: string
      /** N° de transferencia/cheque/operación cargado al ejecutar (mig 155). */
      comprobante?: string | null
    }) => ejecutarPagoProgramado(programadoId, usuarioId, comprobante),
    onSuccess: () => {
      // Ejecutar = un pago real: invalida todo lo de un pago + la lista.
      invalidarTrasPago(qc)
      qc.invalidateQueries({ queryKey: PAGOS_PROGRAMADOS_KEY })
      toast.success('Pago ejecutado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo ejecutar el pago: ${error.message}`)
    },
  })
}

export function useCancelarPagoProgramado() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (programadoId: number) => cancelarPagoProgramado(programadoId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PAGOS_PROGRAMADOS_KEY })
      toast.success('Pago programado cancelado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo cancelar: ${error.message}`)
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

/** Define/reemplaza/quita el plan de cuotas de una deuda (mig 148). */
export function useDefinirCuotas() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: DefinirCuotasPayload) => definirCuotasCuenta(payload),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: CUENTAS_PAGAR_KEY })
      // El plan redistribuye la deuda en el tiempo: tablero y flujo cambian.
      qc.invalidateQueries({ queryKey: ['tablero-directivo'] })
      qc.invalidateQueries({ queryKey: ['flujo-proyectado'] })
      toast.success(
        vars.cuotas.length > 0 ? 'Plan de cuotas guardado' : 'Plan de cuotas quitado'
      )
    },
    onError: (error: Error) => {
      toast.error(`No se pudo guardar el plan: ${error.message}`)
    },
  })
}

function invalidarEgresos(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: EGRESOS_KEY })
  qc.invalidateQueries({ queryKey: RESUMEN_FIN_KEY })
  // El cierre de caja descuenta los gastos del turno.
  qc.invalidateQueries({ queryKey: ['resumen-turno'] })
  // Un egreso de Finanzas ahora debita una cuenta (movimiento + saldo + asiento);
  // refrescar posición de caja, bóveda, tablero, flujo y asientos.
  qc.invalidateQueries({ queryKey: ['cuentas'] })
  qc.invalidateQueries({ queryKey: ['movimientos-cuenta'] })
  qc.invalidateQueries({ queryKey: ['caja-fuerte'] })
  qc.invalidateQueries({ queryKey: ['tablero-directivo'] })
  qc.invalidateQueries({ queryKey: ['flujo-proyectado'] })
  qc.invalidateQueries({ queryKey: ['asientos'] })
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

export function useAnularEgreso() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, usuarioId }: { id: number; usuarioId: string }) =>
      anularEgreso(id, usuarioId),
    onSuccess: () => {
      invalidarEgresos(qc)
      toast.success('Gasto anulado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo anular el gasto: ${error.message}`)
    },
  })
}
