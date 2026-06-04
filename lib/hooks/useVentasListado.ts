'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  getVentaDetalle,
  getVentas,
  type FiltrosVentas,
} from '@/lib/queries/ventas-listado'
import { anularVenta } from '@/lib/queries/ventas'

export function useVentasListado(filtros: FiltrosVentas = {}) {
  return useQuery({
    queryKey: ['ventas-listado', filtros],
    queryFn: () => getVentas(filtros),
    staleTime: 30 * 1000,
  })
}

export function useVentaDetalle(id: number | null) {
  return useQuery({
    queryKey: ['venta-detalle', id],
    queryFn: () => {
      if (id === null) return null
      return getVentaDetalle(id)
    },
    enabled: id !== null,
    staleTime: 60 * 1000,
  })
}

export function useAnularVenta() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      ventaId,
      usuarioId,
    }: {
      ventaId: number
      usuarioId: string
    }) => anularVenta(ventaId, usuarioId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ventas-listado'] })
      queryClient.invalidateQueries({ queryKey: ['venta-detalle'] })
      queryClient.invalidateQueries({ queryKey: ['ventas'] })
      queryClient.invalidateQueries({ queryKey: ['productos'] })
      queryClient.invalidateQueries({ queryKey: ['inventario'] })
      queryClient.invalidateQueries({ queryKey: ['alertas-stock'] })
      queryClient.invalidateQueries({ queryKey: ['cuentas'] })
      queryClient.invalidateQueries({ queryKey: ['movimientos-cuenta'] })
      queryClient.invalidateQueries({ queryKey: ['resumen-turno'] })
      queryClient.invalidateQueries({ queryKey: ['acreditaciones'] })
      queryClient.invalidateQueries({ queryKey: ['lotes-activos'] })
      toast.success('Venta anulada — stock, lotes, cuentas y acreditaciones revertidos')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo anular la venta: ${error.message}`)
    },
  })
}
