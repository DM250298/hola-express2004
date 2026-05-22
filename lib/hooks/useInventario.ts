'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ajustarStock,
  getEvolucionStock,
  getHistorialMovimientos,
  getProductoDetalle,
  getProductosConStock,
  getResumenAlertasStock,
  type AjusteStockPayload,
  type FiltrosInventario,
} from '@/lib/queries/inventario'

export const INVENTARIO_KEY = ['inventario'] as const
export const ALERTAS_STOCK_KEY = ['alertas-stock'] as const

export function useProductosConStock(filtros: FiltrosInventario = {}) {
  return useQuery({
    queryKey: [...INVENTARIO_KEY, filtros],
    queryFn: () => getProductosConStock(filtros),
    staleTime: 30 * 1000,
  })
}

export function useResumenAlertasStock() {
  return useQuery({
    queryKey: ALERTAS_STOCK_KEY,
    queryFn: getResumenAlertasStock,
    staleTime: 30 * 1000,
  })
}

export function useAjustarStock() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: AjusteStockPayload) => ajustarStock(payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: INVENTARIO_KEY })
      queryClient.invalidateQueries({ queryKey: ALERTAS_STOCK_KEY })
      queryClient.invalidateQueries({ queryKey: ['productos'] })
      queryClient.invalidateQueries({
        queryKey: ['producto-detalle', variables.producto_id],
      })
      queryClient.invalidateQueries({
        queryKey: ['historial-movimientos', variables.producto_id],
      })
      queryClient.invalidateQueries({
        queryKey: ['evolucion-stock', variables.producto_id],
      })
      toast.success('Stock ajustado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo ajustar el stock: ${error.message}`)
    },
  })
}

export function useHistorialMovimientos(
  producto_id: number | undefined,
  pagina = 0,
  porPagina = 20
) {
  return useQuery({
    queryKey: ['historial-movimientos', producto_id, pagina, porPagina],
    queryFn: () => {
      if (!producto_id) {
        return { movimientos: [], total: 0 }
      }
      return getHistorialMovimientos(producto_id, pagina, porPagina)
    },
    enabled: !!producto_id,
    staleTime: 30 * 1000,
  })
}

export function useProductoDetalle(id: number | undefined) {
  return useQuery({
    queryKey: ['producto-detalle', id],
    queryFn: () => {
      if (!id) return null
      return getProductoDetalle(id)
    },
    enabled: !!id,
    staleTime: 60 * 1000,
  })
}

export function useEvolucionStock(id: number | undefined, dias = 30) {
  return useQuery({
    queryKey: ['evolucion-stock', id, dias],
    queryFn: () => {
      if (!id) return []
      return getEvolucionStock(id, dias)
    },
    enabled: !!id,
    staleTime: 60 * 1000,
  })
}
