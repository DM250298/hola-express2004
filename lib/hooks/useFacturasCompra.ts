'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  getFacturaCompra,
  guardarFacturaCompra,
  type GuardarFacturaPayload,
} from '@/lib/queries/facturasCompra'

export function useFacturaCompra(cuentaId: number | null) {
  return useQuery({
    queryKey: ['factura-compra', cuentaId],
    queryFn: () => {
      if (cuentaId === null) return null
      return getFacturaCompra(cuentaId)
    },
    enabled: cuentaId !== null,
    staleTime: 10 * 1000,
  })
}

export function useGuardarFacturaCompra() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: GuardarFacturaPayload) =>
      guardarFacturaCompra(payload),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['factura-compra', vars.cuenta_id] })
      qc.invalidateQueries({ queryKey: ['cuentas-a-pagar'] })
      qc.invalidateQueries({ queryKey: ['resumen-financiero'] })
      qc.invalidateQueries({ queryKey: ['pedidos'] })
      qc.invalidateQueries({ queryKey: ['pedido-detalle', vars.pedido_id] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario'] })
      toast.success('Factura guardada · costos y precios actualizados')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo guardar la factura: ${error.message}`)
    },
  })
}
