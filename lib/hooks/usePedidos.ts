'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  actualizarEstadoPedido,
  crearPedido,
  getPedidoDetalle,
  getPedidos,
  getProductosSugeridos,
  recibirPedido,
  type FiltrosPedidos,
  type NuevoPedidoPayload,
  type RecibirPedidoPayload,
} from '@/lib/queries/pedidos'
import type { EstadoPedido } from '@/types/database'

export const PEDIDOS_KEY = ['pedidos'] as const

export function usePedidos(filtros: FiltrosPedidos = {}) {
  return useQuery({
    queryKey: [...PEDIDOS_KEY, filtros],
    queryFn: () => getPedidos(filtros),
    staleTime: 30 * 1000,
  })
}

export function usePedidoDetalle(id: number | undefined) {
  return useQuery({
    queryKey: ['pedido-detalle', id],
    queryFn: () => {
      if (!id) return null
      return getPedidoDetalle(id)
    },
    enabled: !!id,
    staleTime: 30 * 1000,
  })
}

export function useProductosSugeridos(proveedor_id: number | undefined) {
  return useQuery({
    queryKey: ['productos-sugeridos', proveedor_id],
    queryFn: () => {
      if (!proveedor_id) return []
      return getProductosSugeridos(proveedor_id)
    },
    enabled: !!proveedor_id,
    staleTime: 60 * 1000,
  })
}

export function useCrearPedido() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: NuevoPedidoPayload) => crearPedido(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PEDIDOS_KEY })
      toast.success('Pedido creado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo crear el pedido: ${error.message}`)
    },
  })
}

export function useActualizarEstadoPedido() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, estado }: { id: number; estado: EstadoPedido }) =>
      actualizarEstadoPedido(id, estado),
    onSuccess: (_d, variables) => {
      qc.invalidateQueries({ queryKey: PEDIDOS_KEY })
      qc.invalidateQueries({ queryKey: ['pedido-detalle', variables.id] })
      toast.success('Estado del pedido actualizado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo cambiar el estado: ${error.message}`)
    },
  })
}

export function useRecibirPedido() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: RecibirPedidoPayload) => recibirPedido(payload),
    onSuccess: (_d, variables) => {
      qc.invalidateQueries({ queryKey: PEDIDOS_KEY })
      qc.invalidateQueries({
        queryKey: ['pedido-detalle', variables.pedido_id],
      })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario'] })
      qc.invalidateQueries({ queryKey: ['alertas-stock'] })
      qc.invalidateQueries({ queryKey: ['lotes-activos'] })
      qc.invalidateQueries({ queryKey: ['cuentas-a-pagar'] })
      qc.invalidateQueries({ queryKey: ['historial-costos'] })
      if (_d.es_parcial) {
        toast.warning(
          'Recepción parcial registrada · el pedido queda abierto para el faltante'
        )
      } else {
        toast.success('Recepción registrada · deuda provisoria creada')
      }
    },
    onError: (error: Error) => {
      toast.error(`No se pudo registrar la recepción: ${error.message}`)
    },
  })
}
