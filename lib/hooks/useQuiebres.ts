'use client'

import { useQuery } from '@tanstack/react-query'
import {
  getQuiebres,
  getQuiebresActivos,
  type FiltrosQuiebres,
} from '@/lib/queries/quiebres'

export const QUIEBRES_KEY = ['quiebres'] as const

/**
 * Quiebres activos ahora. `data === null` significa que la migración
 * 172/173 todavía no corrió → la UI oculta el bloque.
 */
export function useQuiebresActivos() {
  return useQuery({
    queryKey: [...QUIEBRES_KEY, 'activos'],
    queryFn: getQuiebresActivos,
    staleTime: 60 * 1000,
  })
}

export function useQuiebres(filtros: FiltrosQuiebres = {}) {
  return useQuery({
    queryKey: [...QUIEBRES_KEY, filtros],
    queryFn: () => getQuiebres(filtros),
    staleTime: 60 * 1000,
  })
}
