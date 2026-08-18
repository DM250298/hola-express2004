'use client'

import { useQuery } from '@tanstack/react-query'
import {
  getProductosAReponer,
  getSugerenciasCompra,
} from '@/lib/queries/compras'

export function useProductosAReponer(proveedorId?: number | null) {
  return useQuery({
    queryKey: ['productos-a-reponer', proveedorId ?? 'todos'],
    queryFn: () => getProductosAReponer(proveedorId),
    staleTime: 30 * 1000,
  })
}

/** Sugerencias de compra por cobertura (Centro de Compras, mig 151). */
export function useSugerenciasCompra() {
  return useQuery({
    queryKey: ['sugerencias-compra'],
    queryFn: getSugerenciasCompra,
    staleTime: 60 * 1000,
  })
}
