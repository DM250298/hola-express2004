'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  createTerminal,
  deleteTerminal,
  getDispositivosPoint,
  getTerminales,
  updateTerminal,
} from '@/lib/queries/terminales'
import type { TerminalInsert, TerminalUpdate } from '@/types/database'

export const TERMINALES_KEY = ['terminales'] as const

export function useTerminales() {
  return useQuery({
    queryKey: TERMINALES_KEY,
    queryFn: getTerminales,
    staleTime: 60 * 1000,
  })
}

/** Dispositivos Point en vivo desde Mercado Pago. */
export function useDispositivosPoint(habilitado: boolean) {
  return useQuery({
    queryKey: ['dispositivos-point'],
    queryFn: getDispositivosPoint,
    enabled: habilitado,
    retry: false,
    staleTime: 30 * 1000,
  })
}

export function useCreateTerminal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (datos: TerminalInsert) => createTerminal(datos),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TERMINALES_KEY })
      toast.success('Terminal registrada')
    },
    onError: (e: Error) => toast.error(`No se pudo registrar: ${e.message}`),
  })
}

export function useUpdateTerminal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, datos }: { id: number; datos: TerminalUpdate }) =>
      updateTerminal(id, datos),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TERMINALES_KEY })
      toast.success('Terminal actualizada')
    },
    onError: (e: Error) => toast.error(`No se pudo actualizar: ${e.message}`),
  })
}

export function useDeleteTerminal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteTerminal(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TERMINALES_KEY })
      toast.success('Terminal eliminada')
    },
    onError: (e: Error) => toast.error(`No se pudo eliminar: ${e.message}`),
  })
}
