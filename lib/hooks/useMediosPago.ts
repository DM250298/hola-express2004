'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  actualizarMedioPago,
  crearMedioPago,
  eliminarMedioPago,
  getMediosPago,
  getMediosPagoActivos,
  type ActualizarMedioPagoPatch,
  type NuevoMedioPagoPayload,
} from '@/lib/queries/mediosPago'

export const MEDIOS_PAGO_KEY = ['medios-pago'] as const
export const MEDIOS_PAGO_ACTIVOS_KEY = ['medios-pago', 'activos'] as const

/** Todos los medios de pago (activos e inactivos) — para configuración. */
export function useMediosPago() {
  return useQuery({
    queryKey: MEDIOS_PAGO_KEY,
    queryFn: getMediosPago,
    staleTime: 60 * 1000,
  })
}

/** Solo los medios activos — para el POS. */
export function useMediosPagoActivos() {
  return useQuery({
    queryKey: MEDIOS_PAGO_ACTIVOS_KEY,
    queryFn: getMediosPagoActivos,
    staleTime: 60 * 1000,
  })
}

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: MEDIOS_PAGO_KEY })
}

export function useCrearMedioPago() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: NuevoMedioPagoPayload) => crearMedioPago(payload),
    onSuccess: () => {
      invalidar(qc)
      toast.success('Medio de pago creado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo crear: ${error.message}`)
    },
  })
}

export function useActualizarMedioPago() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: ActualizarMedioPagoPatch }) =>
      actualizarMedioPago(id, patch),
    onSuccess: () => {
      invalidar(qc)
    },
    onError: (error: Error) => {
      toast.error(`No se pudo guardar: ${error.message}`)
    },
  })
}

export function useEliminarMedioPago() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => eliminarMedioPago(id),
    onSuccess: () => {
      invalidar(qc)
      toast.success('Medio de pago borrado')
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })
}
