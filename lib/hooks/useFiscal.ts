'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  actualizarConfigFiscal,
  getConfigFiscal,
  getResumenFiscal,
} from '@/lib/queries/fiscal'
import type { ConfigFiscalUpdate } from '@/types/database'

export const CONFIG_FISCAL_KEY = ['config-fiscal'] as const

export function useConfigFiscal() {
  return useQuery({
    queryKey: CONFIG_FISCAL_KEY,
    queryFn: getConfigFiscal,
    staleTime: 5 * 60 * 1000,
  })
}

export function useActualizarConfigFiscal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: ConfigFiscalUpdate) => actualizarConfigFiscal(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CONFIG_FISCAL_KEY })
      qc.invalidateQueries({ queryKey: ['resumen-fiscal'] })
      toast.success('Configuración fiscal guardada')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo guardar: ${error.message}`)
    },
  })
}

/**
 * Resumen fiscal del período. Necesita la config fiscal (alícuota IIBB,
 * jurisdicción, alícuota IVA general); si no se pasa, usa defaults seguros.
 */
export function useResumenFiscal(
  desde: string,
  hastaExcl: string,
  alicuotaIibb: number,
  jurisdiccion: string,
  alicuotaIvaGeneral = 21
) {
  return useQuery({
    queryKey: [
      'resumen-fiscal',
      desde,
      hastaExcl,
      alicuotaIibb,
      jurisdiccion,
      alicuotaIvaGeneral,
    ],
    queryFn: () =>
      getResumenFiscal(
        desde,
        hastaExcl,
        alicuotaIibb,
        jurisdiccion,
        alicuotaIvaGeneral
      ),
    staleTime: 60 * 1000,
  })
}
