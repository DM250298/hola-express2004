'use client'

import { useQuery } from '@tanstack/react-query'
import { getMarcas } from '@/lib/queries/marcas'

export function useMarcas() {
  return useQuery({
    queryKey: ['marcas'],
    queryFn: getMarcas,
    staleTime: 5 * 60 * 1000,
  })
}
