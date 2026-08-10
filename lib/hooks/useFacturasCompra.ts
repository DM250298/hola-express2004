'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  anularFacturaCompra,
  controlarCompraDirecta,
  getComprobantesCargados,
  getFacturaCompra,
  getItemsFacturaCompra,
  guardarFacturaCompra,
  type GuardarFacturaPayload,
} from '@/lib/queries/facturasCompra'
import { anularCompraDirecta } from '@/lib/queries/comprasDirectas'

export function useComprobantesCargados() {
  return useQuery({
    queryKey: ['comprobantes-cargados'],
    queryFn: getComprobantesCargados,
    staleTime: 30 * 1000,
  })
}

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

function invalidarComprasDirectas(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['comprobantes-cargados'] })
  qc.invalidateQueries({ queryKey: ['resumen-fiscal'] })
  qc.invalidateQueries({ queryKey: ['resumen-financiero'] })
  qc.invalidateQueries({ queryKey: ['productos'] })
  qc.invalidateQueries({ queryKey: ['inventario'] })
  qc.invalidateQueries({ queryKey: ['egresos'] })
  qc.invalidateQueries({ queryKey: ['cuentas'] })
  qc.invalidateQueries({ queryKey: ['movimientos-cuenta'] })
  qc.invalidateQueries({ queryKey: ['caja-fuerte'] })
  qc.invalidateQueries({ queryKey: ['tablero-directivo'] })
}

export function useItemsFacturaCompra(facturaId: number | null) {
  return useQuery({
    queryKey: ['items-factura-compra', facturaId],
    queryFn: () =>
      facturaId === null ? [] : getItemsFacturaCompra(facturaId),
    enabled: facturaId !== null,
    staleTime: 10 * 1000,
  })
}

export function useControlarCompraDirecta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: Parameters<typeof controlarCompraDirecta>[0]) =>
      controlarCompraDirecta(payload),
    onSuccess: () => {
      invalidarComprasDirectas(qc)
      toast.success('Compra actualizada')
    },
    onError: (e: Error) => toast.error(`No se pudo controlar: ${e.message}`),
  })
}

export function useAnularCompraDirecta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ facturaId, usuarioId }: { facturaId: number; usuarioId: string }) =>
      anularCompraDirecta(facturaId, usuarioId),
    onSuccess: () => {
      invalidarComprasDirectas(qc)
      toast.success('Compra anulada')
    },
    onError: (e: Error) => toast.error(`No se pudo anular: ${e.message}`),
  })
}

export function useGuardarFacturaCompra() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: GuardarFacturaPayload) =>
      guardarFacturaCompra(payload),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['factura-compra', vars.cuenta_id] })
      qc.invalidateQueries({ queryKey: ['comprobantes-cargados'] })
      qc.invalidateQueries({ queryKey: ['resumen-fiscal'] })
      qc.invalidateQueries({ queryKey: ['cuentas-a-pagar'] })
      qc.invalidateQueries({ queryKey: ['resumen-financiero'] })
      qc.invalidateQueries({ queryKey: ['pedidos'] })
      qc.invalidateQueries({ queryKey: ['pedido-detalle', vars.pedido_id] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario'] })
      // La factura ahora reconcilia stock/lotes (mig 132) → refrescar inventario.
      qc.invalidateQueries({ queryKey: ['alertas-stock'] })
      qc.invalidateQueries({ queryKey: ['lotes-activos'] })
      qc.invalidateQueries({ queryKey: ['vencimientos'] })
      qc.invalidateQueries({ queryKey: ['historial-costos'] })
      // El CUIT tipeado puede haber completado la ficha del proveedor.
      qc.invalidateQueries({ queryKey: ['proveedores'] })
      // El pago integrado (mig 144) mueve tesorería: mismas invalidaciones
      // que usePagarCuenta (baratas; se refrescan siempre por simplicidad).
      qc.invalidateQueries({ queryKey: ['cuentas'] })
      qc.invalidateQueries({ queryKey: ['movimientos-cuenta'] })
      qc.invalidateQueries({ queryKey: ['pagos-cuenta'] })
      qc.invalidateQueries({ queryKey: ['egresos'] })
      qc.invalidateQueries({ queryKey: ['caja-fuerte'] })
      qc.invalidateQueries({ queryKey: ['tablero-directivo'] })
      qc.invalidateQueries({ queryKey: ['asientos'] })
      qc.invalidateQueries({ queryKey: ['flujo-proyectado'] })
      toast.success(
        vars.pago
          ? 'Factura guardada y pago registrado'
          : 'Factura guardada · stock, costos y precios actualizados'
      )
    },
    onError: (error: Error) => {
      toast.error(`No se pudo guardar la factura: ${error.message}`)
    },
  })
}

export function useAnularFacturaCompra() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      cuentaId,
      usuarioId,
    }: {
      cuentaId: number
      usuarioId: string
    }) => anularFacturaCompra(cuentaId, usuarioId),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['factura-compra', vars.cuentaId] })
      qc.invalidateQueries({ queryKey: ['comprobantes-cargados'] })
      qc.invalidateQueries({ queryKey: ['resumen-fiscal'] })
      qc.invalidateQueries({ queryKey: ['cuentas-a-pagar'] })
      qc.invalidateQueries({ queryKey: ['resumen-financiero'] })
      qc.invalidateQueries({ queryKey: ['pedidos'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario'] })
      qc.invalidateQueries({ queryKey: ['alertas-stock'] })
      qc.invalidateQueries({ queryKey: ['lotes-activos'] })
      qc.invalidateQueries({ queryKey: ['vencimientos'] })
      toast.success('Factura anulada · stock y deuda revertidos')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo anular la factura: ${error.message}`)
    },
  })
}
