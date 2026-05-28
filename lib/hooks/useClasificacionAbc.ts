'use client'

import { useQuery } from '@tanstack/react-query'
import { calcularClasificacionABC } from '@/lib/queries/clasificacionAbc'

export const ABC_KEY = ['clasificacion-abc'] as const

export function useClasificacionABC(dias: number) {
  return useQuery({
    queryKey: [...ABC_KEY, dias],
    queryFn: () => calcularClasificacionABC(dias),
    staleTime: 5 * 60 * 1000, // 5 min — cálculo pesado, no refrescar seguido
  })
}
