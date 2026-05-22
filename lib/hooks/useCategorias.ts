'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  getCategorias,
  createCategoria,
  updateCategoria,
} from '@/lib/queries/categorias'
import type { CategoriaInsert, CategoriaUpdate } from '@/types/database'

export const CATEGORIAS_KEY = ['categorias'] as const

export function useCategorias() {
  return useQuery({
    queryKey: CATEGORIAS_KEY,
    queryFn: getCategorias,
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateCategoria() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (datos: CategoriaInsert) => createCategoria(datos),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CATEGORIAS_KEY })
      toast.success('Categoría creada')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo crear la categoría: ${error.message}`)
    },
  })
}

export function useUpdateCategoria() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, datos }: { id: number; datos: CategoriaUpdate }) =>
      updateCategoria(id, datos),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CATEGORIAS_KEY })
      queryClient.invalidateQueries({ queryKey: ['productos'] })
      toast.success('Categoría actualizada')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo actualizar la categoría: ${error.message}`)
    },
  })
}
