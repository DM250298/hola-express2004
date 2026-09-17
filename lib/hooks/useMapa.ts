'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  actualizarUbicacion,
  agregarUbicacionSecundaria,
  asignarUbicacionPrincipal,
  crearUbicacion,
  eliminarUbicacion,
  getArbolUbicaciones,
  getUbicacionesProducto,
  quitarUbicacionProducto,
  asignarAUbicacion,
  quitarProductoDeUbicacion,
} from '@/lib/queries/ubicaciones'
import { getMapaSemaforo, getSkusNodo } from '@/lib/queries/mapa'
import type { UbicacionInsert, UbicacionUpdate } from '@/types/database'

export const MAPA_KEY = ['mapa'] as const

/** Números y semáforo por nodo (mig 193). Pesado: se recalcula cada 2 min. */
export function useMapaSemaforo(desde: string, hasta: string) {
  return useQuery({
    queryKey: [...MAPA_KEY, 'semaforo', desde, hasta],
    queryFn: () => getMapaSemaforo(desde, hasta),
    staleTime: 2 * 60 * 1000,
  })
}

/** Productos de un nodo y sus descendientes (mig 194). */
export function useSkusNodo(
  ubicacionId: number | null,
  desde: string,
  hasta: string
) {
  return useQuery({
    queryKey: [...MAPA_KEY, 'nodo', ubicacionId, desde, hasta],
    queryFn: () => {
      if (ubicacionId == null) return null
      return getSkusNodo(ubicacionId, desde, hasta)
    },
    enabled: ubicacionId != null,
    staleTime: 60 * 1000,
  })
}

/** Árbol completo del local. `data === null` = migración 170 pendiente. */
export function useArbolUbicaciones() {
  return useQuery({
    queryKey: [...MAPA_KEY, 'arbol'],
    queryFn: getArbolUbicaciones,
    staleTime: 60 * 1000,
  })
}

export function useUbicacionesProducto(productoId: number | undefined) {
  return useQuery({
    queryKey: [...MAPA_KEY, 'producto', productoId],
    queryFn: () => {
      if (!productoId) return null
      return getUbicacionesProducto(productoId)
    },
    enabled: !!productoId,
    staleTime: 60 * 1000,
  })
}

function useInvalidarMapa() {
  const queryClient = useQueryClient()
  return (productoId?: number) => {
    queryClient.invalidateQueries({ queryKey: [...MAPA_KEY, 'arbol'] })
    if (productoId) {
      queryClient.invalidateQueries({
        queryKey: [...MAPA_KEY, 'producto', productoId],
      })
    }
  }
}

export function useCrearUbicacion() {
  const invalidar = useInvalidarMapa()
  return useMutation({
    mutationFn: (datos: UbicacionInsert) => crearUbicacion(datos),
    onSuccess: () => {
      invalidar()
      toast.success('Ubicación creada')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo crear la ubicación: ${error.message}`)
    },
  })
}

export function useActualizarUbicacion() {
  const invalidar = useInvalidarMapa()
  return useMutation({
    mutationFn: ({ id, datos }: { id: number; datos: UbicacionUpdate }) =>
      actualizarUbicacion(id, datos),
    onSuccess: () => {
      invalidar()
      toast.success('Ubicación actualizada')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo guardar: ${error.message}`)
    },
  })
}

export function useEliminarUbicacion() {
  const invalidar = useInvalidarMapa()
  return useMutation({
    mutationFn: (id: number) => eliminarUbicacion(id),
    onSuccess: () => {
      invalidar()
      toast.success('Ubicación eliminada')
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })
}

export function useAsignarUbicacionPrincipal() {
  const invalidar = useInvalidarMapa()
  return useMutation({
    mutationFn: ({
      productoId,
      ubicacionId,
    }: {
      productoId: number
      ubicacionId: number
    }) => asignarUbicacionPrincipal(productoId, ubicacionId),
    onSuccess: (_d, v) => {
      invalidar(v.productoId)
      toast.success('Ubicación asignada')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo asignar: ${error.message}`)
    },
  })
}

export function useAgregarUbicacionSecundaria() {
  const invalidar = useInvalidarMapa()
  return useMutation({
    mutationFn: ({
      productoId,
      ubicacionId,
    }: {
      productoId: number
      ubicacionId: number
    }) => agregarUbicacionSecundaria(productoId, ubicacionId),
    onSuccess: (_d, v) => {
      invalidar(v.productoId)
      toast.success('Ubicación agregada')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo agregar: ${error.message}`)
    },
  })
}

export function useQuitarUbicacionProducto() {
  const invalidar = useInvalidarMapa()
  return useMutation({
    mutationFn: ({ filaId }: { filaId: number; productoId: number }) =>
      quitarUbicacionProducto(filaId),
    onSuccess: (_d, v) => {
      invalidar(v.productoId)
      toast.success('Ubicación quitada')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo quitar: ${error.message}`)
    },
  })
}

/** Asignar desde el mapa: invalida árbol, semáforo y listas de nodos. */
export function useAsignarAUbicacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ productoId, ubicacionId }: { productoId: number; ubicacionId: number }) =>
      asignarAUbicacion(productoId, ubicacionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MAPA_KEY })
    },
    onError: (error: Error) => {
      toast.error(`No se pudo asignar: ${error.message}`)
    },
  })
}

export function useQuitarProductoDeUbicacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ productoId, ubicacionId }: { productoId: number; ubicacionId: number }) =>
      quitarProductoDeUbicacion(productoId, ubicacionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MAPA_KEY })
      toast.success('Producto quitado de la ubicación')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo quitar: ${error.message}`)
    },
  })
}
