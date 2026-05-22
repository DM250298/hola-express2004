'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  calcularResumenImportacion,
  ejecutarImportacion,
  type ResumenImportacion,
  type ResultadoImportacion,
} from '@/lib/queries/importar-productos'
import type { FilaProcesada } from '@/lib/utils/parseo-excel'

export function useResumenImportacion() {
  return useMutation({
    mutationFn: (filas: FilaProcesada[]) => calcularResumenImportacion(filas),
  })
}

export function useEjecutarImportacion() {
  const qc = useQueryClient()
  return useMutation<ResultadoImportacion, Error, FilaProcesada[]>({
    mutationFn: (filas) => ejecutarImportacion(filas),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['categorias'] })
      qc.invalidateQueries({ queryKey: ['proveedores'] })
      qc.invalidateQueries({ queryKey: ['inventario'] })
      qc.invalidateQueries({ queryKey: ['alertas-stock'] })
      const total = res.productos_creados + res.productos_actualizados
      toast.success(
        `${total} producto${total !== 1 ? 's' : ''} importado${total !== 1 ? 's' : ''}`
      )
    },
    onError: (error: Error) => {
      toast.error(`Falló la importación: ${error.message}`)
    },
  })
}

export type { ResumenImportacion, ResultadoImportacion }
