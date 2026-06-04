'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  getVentaParaDevolucion,
  crearDevolucion,
  type CrearDevolucionPayload,
} from '@/lib/queries/devoluciones'

export function useVentaParaDevolucion(ventaId: number | undefined) {
  return useQuery({
    queryKey: ['venta-devolucion', ventaId],
    queryFn: () => getVentaParaDevolucion(ventaId as number),
    enabled: ventaId != null && ventaId > 0,
    staleTime: 10 * 1000,
  })
}

export function useCrearDevolucion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CrearDevolucionPayload) => crearDevolucion(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ventas-listado'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario'] })
      qc.invalidateQueries({ queryKey: ['alertas-stock'] })
      qc.invalidateQueries({ queryKey: ['lotes-activos'] })
      qc.invalidateQueries({ queryKey: ['acreditaciones'] })
      qc.invalidateQueries({ queryKey: ['resumen-turno'] })
      qc.invalidateQueries({ queryKey: ['venta-devolucion'] })
    },
    onError: (e: Error) =>
      toast.error(`No se pudo registrar la devolución: ${e.message}`),
  })
}
