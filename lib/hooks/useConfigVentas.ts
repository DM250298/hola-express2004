'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  getConfigVentas,
  actualizarConfigVentas,
} from '@/lib/queries/configVentas'
import type { ConfigVentasUpdate } from '@/types/database'

export const CONFIG_VENTAS_KEY = ['config-ventas'] as const

export function useConfigVentas() {
  return useQuery({
    queryKey: CONFIG_VENTAS_KEY,
    queryFn: getConfigVentas,
    staleTime: 5 * 60 * 1000,
  })
}

export function useActualizarConfigVentas() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (datos: ConfigVentasUpdate) => actualizarConfigVentas(datos),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CONFIG_VENTAS_KEY })
      toast.success('Configuración guardada')
    },
    onError: (e: Error) => toast.error(`No se pudo guardar: ${e.message}`),
  })
}
