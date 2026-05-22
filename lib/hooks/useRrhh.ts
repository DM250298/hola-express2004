'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  confirmarLiquidacion,
  createEmpleado,
  createNovedad,
  deleteNovedad,
  getEmpleados,
  getLiquidacionDetalle,
  getLiquidaciones,
  getNovedades,
  liquidarPeriodo,
  pagarLiquidacion,
  toggleEmpleadoActivo,
  updateEmpleado,
} from '@/lib/queries/rrhh'
import type {
  EmpleadoInsert,
  EmpleadoUpdate,
  NovedadEmpleadoInsert,
} from '@/types/database'

export const EMPLEADOS_KEY = ['empleados'] as const
export const NOVEDADES_KEY = ['novedades'] as const
export const LIQUIDACIONES_KEY = ['liquidaciones'] as const

// ─── Empleados ───────────────────────────────────────────────────────────────

export function useEmpleados() {
  return useQuery({
    queryKey: EMPLEADOS_KEY,
    queryFn: getEmpleados,
    staleTime: 60 * 1000,
  })
}

export function useCreateEmpleado() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (datos: EmpleadoInsert) => createEmpleado(datos),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: EMPLEADOS_KEY })
      toast.success('Empleado creado')
    },
    onError: (e: Error) => toast.error(`No se pudo crear: ${e.message}`),
  })
}

export function useUpdateEmpleado() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, datos }: { id: number; datos: EmpleadoUpdate }) =>
      updateEmpleado(id, datos),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: EMPLEADOS_KEY })
      toast.success('Empleado actualizado')
    },
    onError: (e: Error) => toast.error(`No se pudo actualizar: ${e.message}`),
  })
}

export function useToggleEmpleadoActivo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, activo }: { id: number; activo: boolean }) =>
      toggleEmpleadoActivo(id, activo),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: EMPLEADOS_KEY })
      toast.success(data.activo ? 'Empleado activado' : 'Empleado dado de baja')
    },
    onError: (e: Error) => toast.error(`No se pudo cambiar: ${e.message}`),
  })
}

// ─── Novedades ───────────────────────────────────────────────────────────────

export function useNovedades(periodo: string) {
  return useQuery({
    queryKey: [...NOVEDADES_KEY, periodo],
    queryFn: () => getNovedades(periodo),
    enabled: !!periodo,
    staleTime: 30 * 1000,
  })
}

export function useCreateNovedad() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (datos: NovedadEmpleadoInsert) => createNovedad(datos),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: NOVEDADES_KEY })
      toast.success('Novedad registrada')
    },
    onError: (e: Error) => toast.error(`No se pudo registrar: ${e.message}`),
  })
}

export function useDeleteNovedad() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteNovedad(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: NOVEDADES_KEY })
      toast.success('Novedad eliminada')
    },
    onError: (e: Error) => toast.error(`No se pudo eliminar: ${e.message}`),
  })
}

// ─── Liquidaciones ───────────────────────────────────────────────────────────

export function useLiquidaciones() {
  return useQuery({
    queryKey: LIQUIDACIONES_KEY,
    queryFn: getLiquidaciones,
    staleTime: 30 * 1000,
  })
}

export function useLiquidacionDetalle(id: number | undefined) {
  return useQuery({
    queryKey: [...LIQUIDACIONES_KEY, 'detalle', id],
    queryFn: () => getLiquidacionDetalle(id as number),
    enabled: !!id,
  })
}

export function useLiquidarPeriodo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      periodo,
      aportesPorcentaje,
      usuarioId,
    }: {
      periodo: string
      aportesPorcentaje: number
      usuarioId: string
    }) => liquidarPeriodo(periodo, aportesPorcentaje, usuarioId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LIQUIDACIONES_KEY })
      toast.success('Liquidación generada')
    },
    onError: (e: Error) => toast.error(`No se pudo liquidar: ${e.message}`),
  })
}

export function useConfirmarLiquidacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      liquidacionId,
      usuarioId,
    }: {
      liquidacionId: number
      usuarioId: string
    }) => confirmarLiquidacion(liquidacionId, usuarioId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LIQUIDACIONES_KEY })
      qc.invalidateQueries({ queryKey: ['asientos'] })
      toast.success('Liquidación confirmada')
    },
    onError: (e: Error) => toast.error(`No se pudo confirmar: ${e.message}`),
  })
}

export function usePagarLiquidacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      liquidacionId,
      cuentaId,
      usuarioId,
    }: {
      liquidacionId: number
      cuentaId: number
      usuarioId: string
    }) => pagarLiquidacion(liquidacionId, cuentaId, usuarioId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LIQUIDACIONES_KEY })
      qc.invalidateQueries({ queryKey: ['asientos'] })
      qc.invalidateQueries({ queryKey: ['cuentas'] })
      qc.invalidateQueries({ queryKey: ['movimientos-cuenta'] })
      toast.success('Sueldos pagados')
    },
    onError: (e: Error) => toast.error(`No se pudo pagar: ${e.message}`),
  })
}
