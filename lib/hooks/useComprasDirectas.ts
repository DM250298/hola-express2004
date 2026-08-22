'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  registrarCompraDirecta,
  type CompraDirectaPayload,
} from '@/lib/queries/comprasDirectas'

export function useRegistrarCompraDirecta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: CompraDirectaPayload) => registrarCompraDirecta(p),
    onSuccess: (_data, vars) => {
      // Stock / inventario
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario'] })
      qc.invalidateQueries({ queryKey: ['movimientos-stock'] })
      // Fiscal / compras
      qc.invalidateQueries({ queryKey: ['resumen-fiscal'] })
      qc.invalidateQueries({ queryKey: ['libro-iva'] })
      // Finanzas / P&L / contabilidad
      qc.invalidateQueries({ queryKey: ['egresos'] })
      qc.invalidateQueries({ queryKey: ['resumen-financiero'] })
      qc.invalidateQueries({ queryKey: ['tablero-directivo'] })
      qc.invalidateQueries({ queryKey: ['flujo-proyectado'] })
      qc.invalidateQueries({ queryKey: ['asientos'] })
      // Tesorería / caja fuerte / cierre del turno
      qc.invalidateQueries({ queryKey: ['cuentas'] })
      qc.invalidateQueries({ queryKey: ['movimientos-cuenta'] })
      qc.invalidateQueries({ queryKey: ['caja-fuerte'] })
      qc.invalidateQueries({ queryKey: ['resumen-turno'] })
      // El saldo impago queda como deuda al proveedor (mig 149).
      qc.invalidateQueries({ queryKey: ['cuentas-a-pagar'] })
      // El CUIT tipeado puede haber completado la ficha del proveedor.
      qc.invalidateQueries({ queryKey: ['proveedores'] })
      const dejaSaldo = !!vars.cta_cte || (vars.cuotas?.length ?? 0) > 0
      toast.success(
        dejaSaldo
          ? 'Compra registrada · el saldo quedó a cuenta corriente'
          : 'Compra registrada con factura'
      )
    },
    onError: (e: Error) =>
      toast.error(`No se pudo registrar la compra: ${e.message}`),
  })
}
