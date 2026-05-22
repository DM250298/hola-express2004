'use client'

import { useQuery } from '@tanstack/react-query'
import { getProductosAReponer } from '@/lib/queries/compras'

export function useProductosAReponer(proveedorId?: number | null) {
  return useQuery({
    queryKey: ['productos-a-reponer', proveedorId ?? 'todos'],
    queryFn: () => getProductosAReponer(proveedorId),
    staleTime: 30 * 1000,
  })
}
