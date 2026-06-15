'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  actualizarRol,
  actualizarUsuario,
  crearRol,
  crearUsuario,
  eliminarRol,
  eliminarUsuario,
  getRoles,
  getUsuarios,
  type NuevoUsuarioPayload,
} from '@/lib/queries/roles'

export const ROLES_KEY = ['roles'] as const
export const USUARIOS_ADMIN_KEY = ['usuarios-admin'] as const

export function useRoles() {
  return useQuery({
    queryKey: ROLES_KEY,
    queryFn: getRoles,
    staleTime: 60 * 1000,
  })
}

export function useUsuariosAdmin() {
  return useQuery({
    queryKey: USUARIOS_ADMIN_KEY,
    queryFn: getUsuarios,
    staleTime: 30 * 1000,
  })
}

export function useCrearRol() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { nombre: string; permisos: string[] }) =>
      crearRol(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ROLES_KEY })
      toast.success('Rol creado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo crear el rol: ${error.message}`)
    },
  })
}

export function useActualizarRol() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: number
      patch: { nombre?: string; permisos?: string[] }
    }) => actualizarRol(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ROLES_KEY })
      qc.invalidateQueries({ queryKey: ['usuario-actual'] })
      toast.success('Rol actualizado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo actualizar el rol: ${error.message}`)
    },
  })
}

export function useEliminarRol() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => eliminarRol(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ROLES_KEY })
      toast.success('Rol borrado')
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })
}

export function useCrearUsuario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: NuevoUsuarioPayload) => crearUsuario(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: USUARIOS_ADMIN_KEY })
      toast.success('Usuario creado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo crear el usuario: ${error.message}`)
    },
  })
}

export function useActualizarUsuario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string
      patch: { nombre?: string; rol?: string; activo?: boolean }
    }) => actualizarUsuario(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: USUARIOS_ADMIN_KEY })
      qc.invalidateQueries({ queryKey: ['usuario-actual'] })
      toast.success('Usuario actualizado')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo actualizar el usuario: ${error.message}`)
    },
  })
}

export function useEliminarUsuario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => eliminarUsuario(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: USUARIOS_ADMIN_KEY })
      toast.success('Usuario borrado')
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })
}
