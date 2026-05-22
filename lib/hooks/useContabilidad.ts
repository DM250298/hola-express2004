'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  actualizarCuentaContable,
  anularAsiento,
  crearActivo,
  crearAsientoManual,
  crearCuentaContable,
  darDeBajaActivo,
  eliminarCuentaContable,
  getActivos,
  getAsientoDetalle,
  getAsientos,
  getLiquidacionIva,
  getPlanCuentas,
  type ActualizarCuentaPatch,
  type NuevaCuentaPayload,
  type NuevoActivoPayload,
  type NuevoAsientoPayload,
} from '@/lib/queries/contabilidad'

export const PLAN_CUENTAS_KEY = ['plan-cuentas'] as const

export function usePlanCuentas() {
  return useQuery({
    queryKey: PLAN_CUENTAS_KEY,
    queryFn: getPlanCuentas,
    staleTime: 5 * 60 * 1000,
  })
}

export function useCrearCuentaContable() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: NuevaCuentaPayload) => crearCuentaContable(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PLAN_CUENTAS_KEY })
      toast.success('Cuenta creada')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo crear la cuenta: ${error.message}`)
    },
  })
}

export function useActualizarCuentaContable() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: ActualizarCuentaPatch }) =>
      actualizarCuentaContable(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PLAN_CUENTAS_KEY })
      toast.success('Cuenta actualizada')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo actualizar: ${error.message}`)
    },
  })
}

export function useEliminarCuentaContable() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => eliminarCuentaContable(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PLAN_CUENTAS_KEY })
      toast.success('Cuenta eliminada')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo eliminar: ${error.message}`)
    },
  })
}

// ─── Asientos ─────────────────────────────────────────────────────

export const ASIENTOS_KEY = ['asientos'] as const

export function useAsientos() {
  return useQuery({
    queryKey: ASIENTOS_KEY,
    queryFn: getAsientos,
    staleTime: 30 * 1000,
  })
}

export function useAsientoDetalle(id: number | null) {
  return useQuery({
    queryKey: ['asiento-detalle', id],
    queryFn: () => (id === null ? null : getAsientoDetalle(id)),
    enabled: id !== null,
    staleTime: 60 * 1000,
  })
}

export function useCrearAsiento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: NuevoAsientoPayload) => crearAsientoManual(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ASIENTOS_KEY })
      toast.success('Asiento registrado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo registrar el asiento: ${error.message}`)
    },
  })
}

export function useAnularAsiento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => anularAsiento(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ASIENTOS_KEY })
      toast.success('Asiento anulado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo anular: ${error.message}`)
    },
  })
}

// ─── Activos fijos ────────────────────────────────────────────────

export const ACTIVOS_KEY = ['activos-fijos'] as const

export function useActivos() {
  return useQuery({
    queryKey: ACTIVOS_KEY,
    queryFn: getActivos,
    staleTime: 60 * 1000,
  })
}

export function useCrearActivo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: NuevoActivoPayload) => crearActivo(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACTIVOS_KEY })
      qc.invalidateQueries({ queryKey: ASIENTOS_KEY })
      toast.success('Activo registrado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo registrar el activo: ${error.message}`)
    },
  })
}

export function useDarDeBajaActivo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => darDeBajaActivo(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACTIVOS_KEY })
      toast.success('Activo dado de baja')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo dar de baja: ${error.message}`)
    },
  })
}

// ─── Liquidación de IVA ───────────────────────────────────────────

export function useLiquidacionIva(desde: string, hastaExcl: string) {
  return useQuery({
    queryKey: ['liquidacion-iva', desde, hastaExcl],
    queryFn: () => getLiquidacionIva(desde, hastaExcl),
    staleTime: 60 * 1000,
  })
}
