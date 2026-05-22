'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  createCliente,
  getCliente,
  getClientes,
  getHistorialCliente,
  toggleClienteActivo,
  updateCliente,
  type FiltrosCliente,
} from '@/lib/queries/clientes'
import type { ClienteInsert, ClienteUpdate } from '@/types/database'

export const CLIENTES_KEY = ['clientes'] as const

export function useClientes(filtros: FiltrosCliente = {}) {
  return useQuery({
    queryKey: [...CLIENTES_KEY, filtros],
    queryFn: () => getClientes(filtros),
    staleTime: 60 * 1000,
  })
}

export function useCliente(id: number | undefined) {
  return useQuery({
    queryKey: [...CLIENTES_KEY, 'detalle', id],
    queryFn: () => getCliente(id as number),
    enabled: !!id,
  })
}

export function useHistorialCliente(id: number | undefined) {
  return useQuery({
    queryKey: [...CLIENTES_KEY, 'historial', id],
    queryFn: () => getHistorialCliente(id as number),
    enabled: !!id,
  })
}

export function useCreateCliente() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (datos: ClienteInsert) => createCliente(datos),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLIENTES_KEY })
      toast.success('Cliente creado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo crear el cliente: ${error.message}`)
    },
  })
}

export function useUpdateCliente() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, datos }: { id: number; datos: ClienteUpdate }) =>
      updateCliente(id, datos),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLIENTES_KEY })
      toast.success('Cliente actualizado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo actualizar el cliente: ${error.message}`)
    },
  })
}

export function useToggleClienteActivo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, activo }: { id: number; activo: boolean }) =>
      toggleClienteActivo(id, activo),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: CLIENTES_KEY })
      toast.success(data.activo ? 'Cliente activado' : 'Cliente desactivado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo cambiar el estado: ${error.message}`)
    },
  })
}
