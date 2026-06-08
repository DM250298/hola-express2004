'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { calcularResumen, ejecutar } from '@/lib/import/motor'
import type {
  DefinicionEntidad,
  FilaProcesadaGen,
  ResultadoImport,
  ResumenImport,
} from '@/lib/import/tipos'

/** Query keys a invalidar tras importar cada entidad. */
const INVALIDAR: Record<string, string[][]> = {
  productos: [['inventario'], ['productos'], ['alertas-stock']],
  clientes: [['clientes']],
  categorias: [['categorias']],
  proveedores: [['proveedores']],
}

export function useResumenImport() {
  return useMutation<ResumenImport, Error, { filas: FilaProcesadaGen[]; def: DefinicionEntidad }>({
    mutationFn: ({ filas, def }) => calcularResumen(filas, def),
  })
}

export function useEjecutarImport() {
  const qc = useQueryClient()
  return useMutation<
    ResultadoImport,
    Error,
    { filas: FilaProcesadaGen[]; def: DefinicionEntidad }
  >({
    mutationFn: ({ filas, def }) => ejecutar(filas, def),
    onSuccess: (res, { def }) => {
      for (const key of INVALIDAR[def.clave] ?? []) {
        qc.invalidateQueries({ queryKey: key })
      }
      const total = res.creados + res.actualizados
      toast.success(
        `Importación lista: ${res.creados} creados, ${res.actualizados} actualizados` +
          (res.errores.length ? `, ${res.errores.length} con error` : '') +
          (total === 0 && res.errores.length === 0 ? ' (sin cambios)' : '')
      )
    },
    onError: (e) => toast.error(`No se pudo importar: ${e.message}`),
  })
}
