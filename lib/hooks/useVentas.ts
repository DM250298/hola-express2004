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
      // Fiado: saldos de cuenta corriente (cartera, CRM y RRHH)
      queryClient.invalidateQueries({ queryKey: ['cartera-fiado'] })
      queryClient.invalidateQueries({ queryKey: ['movimientos-deudor'] })
      queryClient.invalidateQueries({ queryKey: ['clientes'] })
      queryClient.invalidateQueries({ queryKey: ['cta-cte-empleado'] })
      queryClient.invalidateQueries({ queryKey: ['empleados-saldo'] })
      toast.success('Venta registrada')
    },
    onError: (error: Error) => {
      // El tope de fiado rebota desde fn_crear_venta con el prefijo
      // CTACTE_LIMITE: se muestra el detalle (quién, cuánto debe, su tope)
      // sin el ruido de "No se pudo completar la venta: ...".
      const idx = error.message.indexOf('CTACTE_LIMITE:')
      if (idx >= 0) {
        toast.error('No hay cupo para fiar', {
          description: error.message.slice(idx + 'CTACTE_LIMITE:'.length).trim(),
        })
        return
      }
      toast.error(`No se pudo completar la venta: ${error.message}`)
    },
  })
}
