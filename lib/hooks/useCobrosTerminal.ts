'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  conciliarCobro,
  getCobrosSinConciliar,
  type ResultadoConciliacion,
} from '@/lib/queries/cobrosTerminal'

export const COBROS_TERMINAL_KEY = ['cobros-terminal-sin-conciliar'] as const

/** Lista de cobros con terminal sin conciliar (se refresca cada 30 s). */
export function useCobrosSinConciliar() {
  return useQuery({
    queryKey: COBROS_TERMINAL_KEY,
    queryFn: getCobrosSinConciliar,
    refetchInterval: 30 * 1000,
    staleTime: 10 * 1000,
  })
}

/** Registra la venta de un cobro conciliándolo contra Mercado Pago. */
export function useConciliarCobro() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => conciliarCobro(id),
    onSuccess: (data: ResultadoConciliacion) => {
      queryClient.invalidateQueries({ queryKey: COBROS_TERMINAL_KEY })
      const ventaId = data.venta_id ?? data.ventaId ?? null
      if (data.ya_registrada) {
        toast.info('Ese cobro ya tenía la venta registrada.')
      } else if (data.ok && ventaId) {
        // La venta impacta stock, finanzas y el detalle de ventas.
        queryClient.invalidateQueries({ queryKey: ['ventas'] })
        queryClient.invalidateQueries({ queryKey: ['productos'] })
        queryClient.invalidateQueries({ queryKey: ['inventario'] })
        queryClient.invalidateQueries({ queryKey: ['cuentas'] })
        queryClient.invalidateQueries({ queryKey: ['movimientos-cuenta'] })
        toast.success(`Venta registrada (#${ventaId})`)
      } else if (!data.ok) {
        toast.warning(
          data.mensaje ?? 'El pago todavía no está aprobado en Mercado Pago.'
        )
      }
    },
    onError: (error: Error) => {
      toast.error(`No se pudo registrar la venta: ${error.message}`)
    },
  })
}
