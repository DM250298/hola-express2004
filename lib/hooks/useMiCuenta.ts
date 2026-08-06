'use client'

import { useQuery } from '@tanstack/react-query'
import {
  getMiCtaCte,
  getMiSaldoCtaCte,
  getMisNovedades,
} from '@/lib/queries/miCuenta'

export const MI_CUENTA_KEY = ['mi-cuenta'] as const

export function useMiSaldoCtaCte() {
  return useQuery({
    queryKey: [...MI_CUENTA_KEY, 'saldo'],
    queryFn: getMiSaldoCtaCte,
    staleTime: 30 * 1000,
  })
}

export function useMiCtaCte(limite = 100) {
  return useQuery({
    queryKey: [...MI_CUENTA_KEY, 'movimientos', limite],
    queryFn: () => getMiCtaCte(limite),
    staleTime: 30 * 1000,
  })
}

export function useMisNovedades(periodo?: string | null) {
  return useQuery({
    queryKey: [...MI_CUENTA_KEY, 'novedades', periodo ?? 'todas'],
    queryFn: () => getMisNovedades(periodo),
    staleTime: 30 * 1000,
  })
}
