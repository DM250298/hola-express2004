'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  getCatalogoProveedor,
  agregarAlCatalogo,
  actualizarItemCatalogo,
  quitarDelCatalogo,
} from '@/lib/queries/proveedorProducto'
import type {
  ProveedorProductoInsert,
  ProveedorProductoUpdate,
} from '@/types/database'

export function catalogoKey(proveedorId: number | undefined) {
  return ['catalogo-proveedor', proveedorId ?? 0] as const
}

export function useCatalogoProveedor(proveedorId: number | undefined) {
  return useQuery({
    queryKey: catalogoKey(proveedorId),
    queryFn: () => getCatalogoProveedor(proveedorId as number),
    enabled: proveedorId != null,
    staleTime: 60 * 1000,
  })
}

export function useAgregarAlCatalogo(proveedorId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (datos: ProveedorProductoInsert) => agregarAlCatalogo(datos),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogoKey(proveedorId) })
      toast.success('Producto agregado al catálogo')
    },
    onError: (e: Error) => toast.error(`No se pudo agregar: ${e.message}`),
  })
}

export function useActualizarItemCatalogo(proveedorId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, datos }: { id: number; datos: ProveedorProductoUpdate }) =>
      actualizarItemCatalogo(id, datos),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogoKey(proveedorId) })
      toast.success('Catálogo actualizado')
    },
    onError: (e: Error) => toast.error(`No se pudo actualizar: ${e.message}`),
  })
}

export function useQuitarDelCatalogo(proveedorId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => quitarDelCatalogo(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogoKey(proveedorId) })
      toast.success('Producto quitado del catálogo')
    },
    onError: (e: Error) => toast.error(`No se pudo quitar: ${e.message}`),
  })
}
