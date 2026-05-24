'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  agregarMiembro,
  cambiarRolMiembro,
  createTablero,
  deleteTablero,
  getMiembrosTablero,
  getTablero,
  getTablerosVisibles,
  quitarMiembro,
  updateTablero,
} from '@/lib/queries/tableros'
import { tienePermiso } from '@/lib/permisos'
import { useUsuario } from './useUsuario'
import type {
  RolTablero,
  TableroInsert,
  TableroUpdate,
} from '@/types/database'

export const TABLEROS_KEY = ['tableros'] as const
export const MIEMBROS_KEY = ['tablero-miembros'] as const

export function useTableros() {
  const { data: usuario } = useUsuario()
  // El admin de sistema (permiso 'configuracion') ve todo.
  const esAdmin = tienePermiso(usuario?.permisos, 'configuracion')

  return useQuery({
    queryKey: [...TABLEROS_KEY, esAdmin],
    queryFn: () => getTablerosVisibles(esAdmin),
    staleTime: 30 * 1000,
    enabled: !!usuario,
  })
}

export function useTablero(id: number | null | undefined) {
  return useQuery({
    queryKey: [...TABLEROS_KEY, 'detalle', id],
    queryFn: () => getTablero(id as number),
    enabled: !!id,
    staleTime: 30 * 1000,
  })
}

export function useCreateTablero() {
  const qc = useQueryClient()
  const { data: usuario } = useUsuario()
  return useMutation({
    mutationFn: (datos: TableroInsert) =>
      createTablero(
        { ...datos, creado_por: datos.creado_por ?? usuario?.id ?? null },
        usuario?.id ?? null
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TABLEROS_KEY })
      toast.success('Tablero creado')
    },
    onError: (e: Error) => toast.error(`No se pudo crear: ${e.message}`),
  })
}

export function useUpdateTablero() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, datos }: { id: number; datos: TableroUpdate }) =>
      updateTablero(id, datos),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TABLEROS_KEY })
      toast.success('Tablero actualizado')
    },
    onError: (e: Error) => toast.error(`No se pudo actualizar: ${e.message}`),
  })
}

export function useDeleteTablero() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteTablero(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TABLEROS_KEY })
      toast.success('Tablero eliminado')
    },
    onError: (e: Error) => toast.error(`No se pudo eliminar: ${e.message}`),
  })
}

// ─── Miembros ────────────────────────────────────────────────────────────────

export function useMiembrosTablero(tableroId: number | null | undefined) {
  return useQuery({
    queryKey: [...MIEMBROS_KEY, tableroId],
    queryFn: () => getMiembrosTablero(tableroId as number),
    enabled: !!tableroId,
    staleTime: 30 * 1000,
  })
}

function useMiembroMutation<TVars>(
  fn: (v: TVars) => Promise<unknown>,
  okMsg: string
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MIEMBROS_KEY })
      qc.invalidateQueries({ queryKey: TABLEROS_KEY })
      if (okMsg) toast.success(okMsg)
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useAgregarMiembro() {
  return useMiembroMutation(
    (v: { tableroId: number; usuarioId: string; rol: RolTablero }) =>
      agregarMiembro(v.tableroId, v.usuarioId, v.rol),
    'Miembro agregado'
  )
}

export function useQuitarMiembro() {
  return useMiembroMutation(
    (v: { tableroId: number; usuarioId: string }) =>
      quitarMiembro(v.tableroId, v.usuarioId),
    'Miembro quitado'
  )
}

export function useCambiarRolMiembro() {
  return useMiembroMutation(
    (v: { tableroId: number; usuarioId: string; rol: RolTablero }) =>
      cambiarRolMiembro(v.tableroId, v.usuarioId, v.rol),
    'Rol actualizado'
  )
}
