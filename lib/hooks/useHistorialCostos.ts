'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  getHistorialCostos,
  getConfigCompras,
  actualizarConfigCompras,
} from '@/lib/queries/historialCostos'
import type { ConfigComprasUpdate } from '@/types/database'

export const HISTORIAL_COSTOS_KEY = ['historial-costos'] as const
export const CONFIG_COMPRAS_KEY = ['config-compras'] as const

export function useHistorialCostos(limite = 100) {
  return useQuery({
    queryKey: [...HISTORIAL_COSTOS_KEY, limite],
    queryFn: () => getHistorialCostos(limite),
    staleTime: 60 * 1000,
  })
}

export function useConfigCompras() {
  return useQuery({
    queryKey: CONFIG_COMPRAS_KEY,
    queryFn: getConfigCompras,
    staleTime: 5 * 60 * 1000,
  })
}

export function useActualizarConfigCompras() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (datos: ConfigComprasUpdate) => actualizarConfigCompras(datos),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CONFIG_COMPRAS_KEY })
      toast.success('Configuración guardada')
    },
    onError: (e: Error) => toast.error(`No se pudo guardar: ${e.message}`),
  })
}
