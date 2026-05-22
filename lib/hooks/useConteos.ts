'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  aprobarConteo,
  crearConteo,
  getConteoDetalle,
  getConteos,
  getUsuariosActivos,
  guardarConteoEmpleado,
  type NuevoConteoPayload,
} from '@/lib/queries/conteos'

export const CONTEOS_KEY = ['conteos'] as const

export function useConteos() {
  return useQuery({
    queryKey: CONTEOS_KEY,
    queryFn: getConteos,
    staleTime: 20 * 1000,
  })
}

export function useConteoDetalle(id: number | null) {
  return useQuery({
    queryKey: ['conteo-detalle', id],
    queryFn: () => {
      if (id === null) return null
      return getConteoDetalle(id)
    },
    enabled: id !== null,
    staleTime: 10 * 1000,
  })
}

export function useUsuariosActivos() {
  return useQuery({
    queryKey: ['usuarios-activos'],
    queryFn: getUsuariosActivos,
    staleTime: 5 * 60 * 1000,
  })
}

function invalidarConteos(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: CONTEOS_KEY })
  qc.invalidateQueries({ queryKey: ['conteo-detalle'] })
}

export function useCrearConteo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: NuevoConteoPayload) => crearConteo(payload),
    onSuccess: () => {
      invalidarConteos(qc)
      toast.success('Conteo creado y asignado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo crear el conteo: ${error.message}`)
    },
  })
}

export function useGuardarConteoEmpleado() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      conteoId,
      conteos,
    }: {
      conteoId: number
      conteos: Array<{ itemId: number; cantidad: number }>
    }) => guardarConteoEmpleado(conteoId, conteos),
    onSuccess: () => {
      invalidarConteos(qc)
      toast.success('Conteo enviado para aprobación')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo guardar el conteo: ${error.message}`)
    },
  })
}

export function useAprobarConteo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      conteoId,
      aprobadorId,
    }: {
      conteoId: number
      aprobadorId: string
    }) => aprobarConteo(conteoId, aprobadorId),
    onSuccess: () => {
      invalidarConteos(qc)
      qc.invalidateQueries({ queryKey: ['inventario'] })
      qc.invalidateQueries({ queryKey: ['alertas-stock'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      toast.success('Conteo aprobado — stock ajustado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo aprobar el conteo: ${error.message}`)
    },
  })
}
