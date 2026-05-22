'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  crearLote,
  darDeBajaLote,
  getLotesActivos,
  getResumenVencimientos,
  obtenerPlanSincronizacionStock,
  sincronizarStockConLotes,
  type DarDeBajaLotePayload,
  type NuevoLotePayload,
} from '@/lib/queries/vencimientos'

export const LOTES_KEY = ['lotes-activos'] as const
export const RESUMEN_VENC_KEY = ['resumen-vencimientos'] as const

export function useLotesActivos() {
  return useQuery({
    queryKey: LOTES_KEY,
    queryFn: getLotesActivos,
    staleTime: 30 * 1000,
  })
}

export function useResumenVencimientos() {
  return useQuery({
    queryKey: RESUMEN_VENC_KEY,
    queryFn: getResumenVencimientos,
    staleTime: 30 * 1000,
  })
}

function invalidarRelacionados(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: LOTES_KEY })
  qc.invalidateQueries({ queryKey: RESUMEN_VENC_KEY })
  qc.invalidateQueries({ queryKey: ['productos'] })
  qc.invalidateQueries({ queryKey: ['inventario'] })
  qc.invalidateQueries({ queryKey: ['alertas-stock'] })
}

export function useCrearLote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: NuevoLotePayload) => crearLote(payload),
    onSuccess: () => {
      invalidarRelacionados(qc)
      toast.success('Lote ingresado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo crear el lote: ${error.message}`)
    },
  })
}

export function useDarDeBajaLote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: DarDeBajaLotePayload) => darDeBajaLote(payload),
    onSuccess: () => {
      invalidarRelacionados(qc)
      toast.success('Baja registrada como merma')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo dar de baja: ${error.message}`)
    },
  })
}

export const PLAN_SINCRONIZACION_KEY = ['plan-sincronizacion-stock'] as const

export function usePlanSincronizacionStock(habilitado: boolean) {
  return useQuery({
    queryKey: PLAN_SINCRONIZACION_KEY,
    queryFn: obtenerPlanSincronizacionStock,
    enabled: habilitado,
    staleTime: 0,
  })
}

export function useSincronizarStockConLotes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (fechaVencimiento: string) =>
      sincronizarStockConLotes(fechaVencimiento),
    onSuccess: (resultado) => {
      invalidarRelacionados(qc)
      qc.invalidateQueries({ queryKey: PLAN_SINCRONIZACION_KEY })
      if (resultado.lotes_creados === 0) {
        toast.info('Todo el stock ya estaba cubierto por lotes.')
      } else {
        toast.success(
          `${resultado.lotes_creados} lotes creados con ${resultado.unidades_cubiertas} unidades`
        )
      }
    },
    onError: (error: Error) => {
      toast.error(`No se pudo sincronizar: ${error.message}`)
    },
  })
}
