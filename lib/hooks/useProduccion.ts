'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  cancelarOrden,
  cerrarOrden,
  crearOrden,
  generarReposicion,
  getDesfasajes,
  getDisponibilidadInsumos,
  getOrdenDetalle,
  getOrdenes,
  getPendientesProduccion,
  getProductosProduccion,
  getRecetaDeProducto,
  getRecetas,
  guardarReceta,
  iniciarOrden,
  previewCostoReceta,
  type ConsumoReal,
  type FiltrosOrdenes,
  type GuardarRecetaPayload,
  type NuevaOrdenPayload,
} from '@/lib/queries/produccion'

export const RECETAS_KEY = ['recetas'] as const
export const ORDENES_KEY = ['ordenes-produccion'] as const

// ─── Queries ────────────────────────────────────────────────────────────────────

export function useRecetas() {
  return useQuery({
    queryKey: RECETAS_KEY,
    queryFn: () => getRecetas(),
    staleTime: 30 * 1000,
  })
}

export function useRecetaDeProducto(productoId: number | undefined) {
  return useQuery({
    queryKey: ['receta', productoId],
    queryFn: () => {
      if (!productoId) return null
      return getRecetaDeProducto(productoId)
    },
    enabled: !!productoId,
    staleTime: 30 * 1000,
  })
}

export function usePreviewCostoReceta(productoId: number | undefined) {
  return useQuery({
    queryKey: ['costo-receta', productoId],
    queryFn: () => {
      if (!productoId) return 0
      return previewCostoReceta(productoId)
    },
    enabled: !!productoId,
    staleTime: 30 * 1000,
  })
}

export function useDisponibilidadInsumos(
  recetaId: number | undefined,
  cantidadPlanificada: number
) {
  return useQuery({
    queryKey: ['disponibilidad-insumos', recetaId, cantidadPlanificada],
    queryFn: () => {
      if (!recetaId || cantidadPlanificada <= 0) return []
      return getDisponibilidadInsumos(recetaId, cantidadPlanificada)
    },
    enabled: !!recetaId && cantidadPlanificada > 0,
    staleTime: 15 * 1000,
  })
}

export function useProductosProduccion(tipos: string[], busqueda?: string) {
  return useQuery({
    queryKey: ['productos-produccion', tipos, busqueda ?? ''],
    queryFn: () => getProductosProduccion(tipos, busqueda),
    staleTime: 30 * 1000,
  })
}

export function useOrdenes(filtros: FiltrosOrdenes = {}) {
  return useQuery({
    queryKey: [...ORDENES_KEY, filtros],
    queryFn: () => getOrdenes(filtros),
    staleTime: 30 * 1000,
  })
}

export function useOrdenDetalle(id: number | undefined) {
  return useQuery({
    queryKey: ['orden-prod', id],
    queryFn: () => {
      if (!id) return null
      return getOrdenDetalle(id)
    },
    enabled: !!id,
    staleTime: 30 * 1000,
  })
}

// ─── Mutaciones ──────────────────────────────────────────────────────────────────

export function useGuardarReceta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: GuardarRecetaPayload) => guardarReceta(payload),
    onSuccess: (_d, variables) => {
      qc.invalidateQueries({ queryKey: RECETAS_KEY })
      qc.invalidateQueries({ queryKey: ['receta', variables.producto_id] })
      qc.invalidateQueries({ queryKey: ['costo-receta', variables.producto_id] })
      toast.success('Receta guardada')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo guardar la receta: ${error.message}`)
    },
  })
}

export function useCrearOrden() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: NuevaOrdenPayload) => crearOrden(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ORDENES_KEY })
      qc.invalidateQueries({ queryKey: ['pendientes-produccion'] })
      toast.success('Orden de producción creada')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo crear la orden: ${error.message}`)
    },
  })
}

/** Invalida todo lo que toca un movimiento de stock de producción. */
function invalidarStock(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ORDENES_KEY })
  qc.invalidateQueries({ queryKey: ['pendientes-produccion'] })
  qc.invalidateQueries({ queryKey: ['productos'] })
  qc.invalidateQueries({ queryKey: ['inventario'] })
  qc.invalidateQueries({ queryKey: ['alertas-stock'] })
  qc.invalidateQueries({ queryKey: ['lotes-activos'] })
  qc.invalidateQueries({ queryKey: ['movimientos-stock'] })
}

export function useIniciarOrden() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orden_id, usuario_id }: { orden_id: number; usuario_id: string }) =>
      iniciarOrden(orden_id, usuario_id),
    onSuccess: (_d, variables) => {
      invalidarStock(qc)
      qc.invalidateQueries({ queryKey: ['orden-prod', variables.orden_id] })
      toast.success('Orden iniciada · insumos descontados')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo iniciar la orden: ${error.message}`)
    },
  })
}

export function useCerrarOrden() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      orden_id,
      cantidad_producida,
      usuario_id,
      consumos,
    }: {
      orden_id: number
      cantidad_producida: number
      usuario_id: string
      consumos?: ConsumoReal[]
    }) => cerrarOrden(orden_id, cantidad_producida, usuario_id, consumos ?? []),
    onSuccess: (_d, variables) => {
      invalidarStock(qc)
      qc.invalidateQueries({ queryKey: ['orden-prod', variables.orden_id] })
      qc.invalidateQueries({ queryKey: ['vencimientos'] })
      qc.invalidateQueries({ queryKey: ['historial-costos'] })
      qc.invalidateQueries({ queryKey: ['costo-receta'] })
      qc.invalidateQueries({ queryKey: ['desfasajes'] })
      toast.success('Producción cerrada · stock ingresado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo cerrar la orden: ${error.message}`)
    },
  })
}

export function useCancelarOrden() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orden_id, usuario_id }: { orden_id: number; usuario_id: string }) =>
      cancelarOrden(orden_id, usuario_id),
    onSuccess: (_d, variables) => {
      invalidarStock(qc)
      qc.invalidateQueries({ queryKey: ['orden-prod', variables.orden_id] })
      toast.warning('Orden cancelada · insumos repuestos')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo cancelar la orden: ${error.message}`)
    },
  })
}

export function useGenerarReposicion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => generarReposicion(),
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ORDENES_KEY })
      qc.invalidateQueries({ queryKey: ['pendientes-produccion'] })
      if (count > 0) {
        toast.success(`${count} orden(es) de reposición creada(s) en borrador`)
      } else {
        toast('No hay elaborados bajo el mínimo (o ya tienen una orden abierta).')
      }
    },
    onError: (error: Error) => {
      toast.error(`No se pudo generar la reposición: ${error.message}`)
    },
  })
}

export function useDesfasajes() {
  return useQuery({
    queryKey: ['desfasajes'],
    queryFn: () => getDesfasajes(),
    staleTime: 30 * 1000,
  })
}

/** Cantidad de órdenes pendientes de elaborar (borradores). Refresca solo. */
export function usePendientesProduccion() {
  return useQuery({
    queryKey: ['pendientes-produccion'],
    queryFn: () => getPendientesProduccion(),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  })
}
