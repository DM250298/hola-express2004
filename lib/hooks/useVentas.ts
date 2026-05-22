'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  crearVenta,
  getProductosFrecuentesTurno,
  type CrearVentaPayload,
} from '@/lib/queries/ventas'

export const VENTAS_KEY = ['ventas'] as const
export const FRECUENTES_KEY = ['productos-frecuentes-turno'] as const

export function useProductosFrecuentesTurno(turnoId: number | undefined) {
  return useQuery({
    queryKey: [...FRECUENTES_KEY, turnoId],
    queryFn: () => {
      if (!turnoId) return []
      return getProductosFrecuentesTurno(turnoId, 12)
    },
    enabled: !!turnoId,
    staleTime: 10 * 1000,
  })
}

export function useCrearVenta() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CrearVentaPayload) => crearVenta(payload),
    onSuccess: (venta) => {
      if (venta.pendiente) {
        // Venta cobrada offline: quedó en cola para sincronizar.
        toast.warning('Venta guardada sin conexión', {
          description: 'Se sincronizará automáticamente al volver internet.',
        })
        return
      }
      queryClient.invalidateQueries({ queryKey: FRECUENTES_KEY })
      queryClient.invalidateQueries({ queryKey: ['productos'] })
      queryClient.invalidateQueries({ queryKey: VENTAS_KEY })
      // Lotes y vencimientos se actualizan por descuento FIFO
      queryClient.invalidateQueries({ queryKey: ['lotes-activos'] })
      queryClient.invalidateQueries({ queryKey: ['resumen-vencimientos'] })
      queryClient.invalidateQueries({ queryKey: ['inventario'] })
      queryClient.invalidateQueries({ queryKey: ['alertas-stock'] })
      // Movimientos de cuenta generados automáticamente
      queryClient.invalidateQueries({ queryKey: ['cuentas'] })
      queryClient.invalidateQueries({ queryKey: ['movimientos-cuenta'] })
      toast.success('Venta registrada')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo completar la venta: ${error.message}`)
    },
  })
}
