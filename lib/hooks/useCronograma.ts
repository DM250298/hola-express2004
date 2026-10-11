'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  eliminarPatron,
  generarCronograma,
  getPatrones,
  guardarPatron,
  togglePatronActivo,
  type GenerarCronogramaArgs,
  type GuardarPatronArgs,
} from '@/lib/queries/cronograma'
import { ASISTENCIA_KEY, HORARIOS_KEY } from './useAsistencia'

export const PATRONES_KEY = ['patrones-cronograma'] as const

export function usePatrones() {
  return useQuery({
    queryKey: PATRONES_KEY,
    queryFn: getPatrones,
    staleTime: 60 * 1000,
  })
}

export function useGuardarPatron() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (a: GuardarPatronArgs) => guardarPatron(a),
    onSuccess: (_, a) => {
      qc.invalidateQueries({ queryKey: PATRONES_KEY })
      toast.success(a.id ? 'Patrón actualizado' : 'Patrón creado')
    },
    onError: (e: Error) => toast.error(`No se pudo guardar el patrón: ${e.message}`),
  })
}

export function useTogglePatronActivo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, activo }: { id: number; activo: boolean }) => togglePatronActivo(id, activo),
    onSuccess: () => qc.invalidateQueries({ queryKey: PATRONES_KEY }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useEliminarPatron() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => eliminarPatron(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PATRONES_KEY })
      toast.success('Patrón eliminado')
    },
    onError: (e: Error) => toast.error(`No se pudo eliminar: ${e.message}`),
  })
}

/** Previsualizar (aplicar=false) o aplicar (aplicar=true). */
export function useGenerarCronograma() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (a: GenerarCronogramaArgs) => generarCronograma(a),
    onSuccess: (r, a) => {
      if (!a.aplicar) return
      qc.invalidateQueries({ queryKey: HORARIOS_KEY })
      qc.invalidateQueries({ queryKey: ASISTENCIA_KEY })
      const partes = [`${r.creados} creado${r.creados === 1 ? '' : 's'}`]
      if (r.reemplazados > 0) partes.push(`${r.reemplazados} reemplazado${r.reemplazados === 1 ? '' : 's'}`)
      if (r.omitidos > 0) partes.push(`${r.omitidos} respetado${r.omitidos === 1 ? '' : 's'} (ya cargados)`)
      toast.success(`Cronograma generado: ${partes.join(', ')}.`)
    },
    onError: (e: Error) => toast.error(`No se pudo generar: ${e.message}`),
  })
}
