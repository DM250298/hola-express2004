'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  getProveedores,
  createProveedor,
  updateProveedor,
} from '@/lib/queries/proveedores'
import type { ProveedorInsert, ProveedorUpdate } from '@/types/database'

export const PROVEEDORES_KEY = ['proveedores'] as const

export function useProveedores() {
  return useQuery({
    queryKey: PROVEEDORES_KEY,
    queryFn: getProveedores,
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateProveedor() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (datos: ProveedorInsert) => createProveedor(datos),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROVEEDORES_KEY })
      toast.success('Proveedor creado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo crear el proveedor: ${error.message}`)
    },
  })
}

export function useUpdateProveedor() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, datos }: { id: number; datos: ProveedorUpdate }) =>
      updateProveedor(id, datos),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROVEEDORES_KEY })
      queryClient.invalidateQueries({ queryKey: ['productos'] })
      toast.success('Proveedor actualizado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo actualizar el proveedor: ${error.message}`)
    },
  })
}
