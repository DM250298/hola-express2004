'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  confirmarLiquidacion,
  createEmpleado,
  createNovedad,
  deleteNovedad,
  eliminarDocumento,
  generarLiquidacion,
  getDocumentos,
  getEmpleado,
  getEmpleados,
  getLiquidacionLoteDetalle,
  getLiquidacionLotes,
  getNovedades,
  pagarLiquidacion,
  subirDocumento,
  subirFotoEmpleado,
  toggleEmpleadoActivo,
  updateEmpleado,
  type SubirDocumentoArgs,
} from '@/lib/queries/rrhh'
import type {
  EmpleadoInsert,
  EmpleadoUpdate,
  NovedadEmpleadoInsert,
} from '@/types/database'

export const EMPLEADOS_KEY = ['empleados'] as const
export const DOCUMENTOS_KEY = ['empleado-documentos'] as const
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

export function useEmpleado(id: number | undefined) {
  return useQuery({
    queryKey: [...EMPLEADOS_KEY, id],
    queryFn: () => getEmpleado(id as number),
    enabled: !!id,
  })
}

// ─── Documentos del empleado ──────────────────────────────────────────────────

export function useDocumentos(empleadoId: number | undefined) {
  return useQuery({
    queryKey: [...DOCUMENTOS_KEY, empleadoId],
    queryFn: () => getDocumentos(empleadoId as number),
    enabled: !!empleadoId,
  })
}

export function useSubirDocumento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: SubirDocumentoArgs) => subirDocumento(args),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: [...DOCUMENTOS_KEY, vars.empleadoId] })
      toast.success('Documento subido')
    },
    onError: (e: Error) => toast.error(`No se pudo subir: ${e.message}`),
  })
}

export function useEliminarDocumento(empleadoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (doc: { id: string; archivo_url: string }) =>
      eliminarDocumento(doc),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...DOCUMENTOS_KEY, empleadoId] })
      toast.success('Documento eliminado')
    },
    onError: (e: Error) => toast.error(`No se pudo eliminar: ${e.message}`),
  })
}

export function useSubirFoto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      empleadoId,
      archivo,
    }: {
      empleadoId: number
      archivo: File
    }) => subirFotoEmpleado(empleadoId, archivo),
    onSuccess: (_url, vars) => {
      qc.invalidateQueries({ queryKey: EMPLEADOS_KEY })
      qc.invalidateQueries({ queryKey: [...EMPLEADOS_KEY, vars.empleadoId] })
      toast.success('Foto actualizada')
    },
    onError: (e: Error) => toast.error(`No se pudo subir la foto: ${e.message}`),
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

// ─── Liquidaciones (modelo nuevo · Sprint 4) ─────────────────────────────────

export function useLiquidacionLotes() {
  return useQuery({
    queryKey: LIQUIDACIONES_KEY,
    queryFn: getLiquidacionLotes,
    staleTime: 30 * 1000,
  })
}

export function useLiquidacionLoteDetalle(id: number | undefined) {
  return useQuery({
    queryKey: [...LIQUIDACIONES_KEY, 'detalle', id],
    queryFn: () => getLiquidacionLoteDetalle(id as number),
    enabled: !!id,
  })
}

export function useGenerarLiquidacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      periodo,
      usuarioId,
    }: {
      periodo: string
      usuarioId: string
    }) => generarLiquidacion(periodo, usuarioId),
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
      loteId,
      usuarioId,
    }: {
      loteId: number
      usuarioId: string
    }) => confirmarLiquidacion(loteId, usuarioId),
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
      loteId,
      cuentaId,
      usuarioId,
    }: {
      loteId: number
      cuentaId: number
      usuarioId: string
    }) => pagarLiquidacion(loteId, cuentaId, usuarioId),
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
