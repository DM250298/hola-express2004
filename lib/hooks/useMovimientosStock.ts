'use client'

import { useQuery } from '@tanstack/react-query'
import {
  getMovimientosStock,
  getUsuariosConMovimientos,
  type FiltrosMovimientos,
} from '@/lib/queries/movimientosStock'

export const MOVIMIENTOS_KEY = ['movimientos-stock'] as const

export function useMovimientosStock(
  filtros: FiltrosMovimientos,
  pagina = 0,
  porPagina = 50
) {
  return useQuery({
    queryKey: [...MOVIMIENTOS_KEY, filtros, pagina, porPagina],
    queryFn: () => getMovimientosStock(filtros, pagina, porPagina),
    staleTime: 30 * 1000,
  })
}

export function useUsuariosConMovimientos() {
  return useQuery({
    queryKey: ['usuarios-movimientos'],
    queryFn: getUsuariosConMovimientos,
    staleTime: 5 * 60 * 1000,
  })
}
