'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  getOpcionesTipoUnidad,
  getProductos,
  createProducto,
  updateProducto,
  toggleProductoActivo,
  getComponentesCombo,
  guardarComponentesCombo,
  type FiltrosProducto,
} from '@/lib/queries/productos'
import type { ProductoInsert, ProductoUpdate } from '@/types/database'

export const PRODUCTOS_KEY = ['productos'] as const

export function useProductos(filtros: FiltrosProducto = {}) {
  return useQuery({
    queryKey: [...PRODUCTOS_KEY, filtros],
    queryFn: () => getProductos(filtros),
    staleTime: 30 * 1000,
  })
}

/** Búsqueda liviana para pickers (se activa recién con 2+ caracteres). */
export function useBuscarProductos(busqueda: string) {
  return useQuery({
    queryKey: [...PRODUCTOS_KEY, 'buscar', busqueda],
    queryFn: () => getProductos({ busqueda, activo: true }),
    enabled: busqueda.trim().length >= 2,
    staleTime: 30 * 1000,
  })
}

export function useOpcionesTipoUnidad() {
  return useQuery({
    queryKey: [...PRODUCTOS_KEY, 'opciones-tipo-unidad'],
    queryFn: getOpcionesTipoUnidad,
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateProducto() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (datos: ProductoInsert) => createProducto(datos),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRODUCTOS_KEY })
      queryClient.invalidateQueries({ queryKey: ['inventario'] })
      toast.success('Producto creado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo crear el producto: ${error.message}`)
    },
  })
}

export function useUpdateProducto() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, datos }: { id: number; datos: ProductoUpdate }) =>
      updateProducto(id, datos),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: PRODUCTOS_KEY })
      queryClient.invalidateQueries({ queryKey: ['inventario'] })
      queryClient.invalidateQueries({
        queryKey: ['producto-detalle', variables.id],
      })
      toast.success('Producto actualizado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo actualizar el producto: ${error.message}`)
    },
  })
}

/** Componentes de un combo (para el drawer de producto). */
export function useComponentesCombo(
  productoId: number | null,
  habilitado: boolean
) {
  return useQuery({
    queryKey: [...PRODUCTOS_KEY, 'componentes', productoId],
    queryFn: () => getComponentesCombo(productoId as number),
    enabled: habilitado && productoId != null,
    staleTime: 30 * 1000,
  })
}

/** Guarda la composición de un combo (se llama después de guardar el producto). */
export function useGuardarComponentesCombo() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      productoId,
      componentes,
    }: {
      productoId: number
      componentes: { componente_id: number; cantidad: number }[]
    }) => guardarComponentesCombo(productoId, componentes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRODUCTOS_KEY })
      queryClient.invalidateQueries({ queryKey: ['inventario'] })
    },
    onError: (error: Error) => {
      toast.error(
        `El producto se guardó, pero falló la composición del combo: ${error.message}`
      )
    },
  })
}

export function useToggleProductoActivo() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, activo }: { id: number; activo: boolean }) =>
      toggleProductoActivo(id, activo),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: PRODUCTOS_KEY })
      toast.success(
        data.activo ? 'Producto activado' : 'Producto desactivado'
      )
    },
    onError: (error: Error) => {
      toast.error(`No se pudo cambiar el estado: ${error.message}`)
    },
  })
}
