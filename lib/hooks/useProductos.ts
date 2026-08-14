'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  asignarCodigoBarras,
  getOpcionesTipoUnidad,
  getProductos,
  createProducto,
  updateProducto,
  toggleProductoActivo,
  eliminarProducto,
  productoEliminable,
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

/**
 * Asigna/corrige el código de barras de un producto desde la recepción móvil.
 * No reusa `useUpdateProducto` para poder traducir el choque contra el índice
 * único (23505) a un mensaje que se entienda en el mostrador.
 *
 * OJO: no invalida `['pedido-detalle', …]` a propósito — la recepción móvil
 * reconstruye su estado con cada cambio del pedido y un refetch le borraría al
 * usuario las cantidades tipeadas.
 */
export function useAsignarCodigoBarras() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, codigo }: { id: number; codigo: string }) =>
      asignarCodigoBarras(id, codigo),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: PRODUCTOS_KEY })
      queryClient.invalidateQueries({ queryKey: ['inventario'] })
      queryClient.invalidateQueries({
        queryKey: ['producto-detalle', variables.id],
      })
      toast.success('Código de barras guardado')
    },
    onError: (error: Error) => {
      const codigoPg = (error as { code?: string }).code
      toast.error(
        codigoPg === '23505'
          ? 'Ese código ya lo tiene otro producto.'
          : error.message
      )
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
      queryClient.invalidateQueries({ queryKey: ['inventario'] })
      queryClient.invalidateQueries({
        queryKey: ['producto-detalle', data.id],
      })
      toast.success(
        data.activo ? 'Producto activado' : 'Producto desactivado'
      )
    },
    onError: (error: Error) => {
      toast.error(`No se pudo cambiar el estado: ${error.message}`)
    },
  })
}

/**
 * ¿El producto se puede borrar? Se usa para decidir, en el diálogo de borrado,
 * si ofrecer "Eliminar" o directamente "Desactivar" (cuando tiene historial).
 */
export function useProductoEliminable(id: number, habilitado: boolean) {
  return useQuery({
    queryKey: [...PRODUCTOS_KEY, 'eliminable', id],
    queryFn: () => productoEliminable(id),
    enabled: habilitado,
    staleTime: 0,
    gcTime: 0,
  })
}

/**
 * Borra un producto definitivamente. El manejo del caso "tiene historial"
 * (mensaje PRODUCTO_CON_HISTORIAL) queda en el componente, que ofrece
 * desactivarlo; por eso acá no toasteamos el error.
 */
export function useEliminarProducto() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: number) => eliminarProducto(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRODUCTOS_KEY })
      queryClient.invalidateQueries({ queryKey: ['inventario'] })
    },
  })
}
