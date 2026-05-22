'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  createCuenta,
  crearMovimiento,
  crearTransferencia,
  getCuentas,
  getMovimientos,
  setConciliadoMovimiento,
  updateCuenta,
  type FiltrosMovimientos,
  type NuevaTransferenciaPayload,
  type NuevoMovimientoPayload,
} from '@/lib/queries/cuentas'
import type { CuentaInsert, CuentaUpdate } from '@/types/database'

export const CUENTAS_KEY = ['cuentas'] as const
export const MOVIMIENTOS_KEY = ['movimientos-cuenta'] as const

export function useCuentas(soloActivas = true) {
  return useQuery({
    queryKey: [...CUENTAS_KEY, { soloActivas }],
    queryFn: () => getCuentas(soloActivas),
    staleTime: 30 * 1000,
  })
}

export function useMovimientos(filtros: FiltrosMovimientos = {}) {
  return useQuery({
    queryKey: [...MOVIMIENTOS_KEY, filtros],
    queryFn: () => getMovimientos(filtros),
    staleTime: 30 * 1000,
  })
}

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: CUENTAS_KEY })
  qc.invalidateQueries({ queryKey: MOVIMIENTOS_KEY })
}

export function useCrearCuenta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (datos: CuentaInsert) => createCuenta(datos),
    onSuccess: () => {
      invalidar(qc)
      toast.success('Cuenta creada')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo crear la cuenta: ${error.message}`)
    },
  })
}

export function useActualizarCuenta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, datos }: { id: number; datos: CuentaUpdate }) =>
      updateCuenta(id, datos),
    onSuccess: () => {
      invalidar(qc)
      toast.success('Cuenta actualizada')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo actualizar: ${error.message}`)
    },
  })
}

export function useCrearMovimiento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: NuevoMovimientoPayload) => crearMovimiento(payload),
    onSuccess: () => {
      invalidar(qc)
      toast.success('Movimiento registrado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo registrar el movimiento: ${error.message}`)
    },
  })
}

export function useCrearTransferencia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: NuevaTransferenciaPayload) =>
      crearTransferencia(payload),
    onSuccess: () => {
      invalidar(qc)
      toast.success('Transferencia registrada')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo registrar la transferencia: ${error.message}`)
    },
  })
}

export function useConciliarMovimiento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, conciliado }: { id: number; conciliado: boolean }) =>
      setConciliadoMovimiento(id, conciliado),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MOVIMIENTOS_KEY })
    },
    onError: (error: Error) => {
      toast.error(`No se pudo conciliar: ${error.message}`)
    },
  })
}

// Nota: la configuración de medios de pago se movió a useMediosPago.ts
