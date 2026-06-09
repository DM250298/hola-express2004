'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  eliminarComprobante,
  getComprobantesPedido,
  subirComprobante,
} from '@/lib/queries/comprobantes'

function comprobantesKey(pedidoId: number | undefined) {
  return ['comprobantes-pedido', pedidoId] as const
}

export function useComprobantesPedido(pedidoId: number | undefined) {
  return useQuery({
    queryKey: comprobantesKey(pedidoId),
    queryFn: () => (pedidoId ? getComprobantesPedido(pedidoId) : []),
    enabled: !!pedidoId,
    staleTime: 30 * 1000,
  })
}

export function useSubirComprobante(pedidoId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      file,
      usuarioId,
    }: {
      file: File
      usuarioId: string | null
    }) => {
      if (!pedidoId) throw new Error('Pedido no especificado.')
      return subirComprobante(pedidoId, file, usuarioId)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: comprobantesKey(pedidoId) })
      toast.success('Comprobante adjuntado')
    },
    onError: (e: Error) => {
      toast.error(`No se pudo subir el comprobante: ${e.message}`)
    },
  })
}

export function useEliminarComprobante(pedidoId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, storagePath }: { id: number; storagePath: string }) =>
      eliminarComprobante(id, storagePath),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: comprobantesKey(pedidoId) })
      toast.success('Comprobante quitado')
    },
    onError: (e: Error) => {
      toast.error(`No se pudo quitar el comprobante: ${e.message}`)
    },
  })
}
