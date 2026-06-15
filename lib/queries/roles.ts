import { createClient } from '@/lib/supabase/client'
import type { RolRow } from '@/types/database'

function slugRol(nombre: string): string {
  return (
    nombre
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30) || 'rol'
  )
}

// ─── Roles ──────────────────────────────────────────────────────────

export async function getRoles(): Promise<RolRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('roles')
    .select('*')
    .order('es_sistema', { ascending: false })
    .order('nombre', { ascending: true })
  if (error) throw error
  return (data ?? []) as RolRow[]
}

export async function crearRol(payload: {
  nombre: string
  permisos: string[]
}): Promise<RolRow> {
  const supabase = createClient()
  const nombre = payload.nombre.trim()
  if (!nombre) throw new Error('El nombre del rol no puede estar vacío.')

  const { data: existentes } = await supabase.from('roles').select('codigo')
  const usados = new Set((existentes ?? []).map((r) => r.codigo))
  const base = slugRol(nombre)
  let codigo = base
  let n = 2
  while (usados.has(codigo)) {
    codigo = `${base}_${n}`
    n++
  }

  const { data, error } = await supabase
    .from('roles')
    .insert({ codigo, nombre, permisos: payload.permisos, es_sistema: false })
    .select()
    .single<RolRow>()
  if (error) throw error
  return data
}

export async function actualizarRol(
  id: number,
  patch: { nombre?: string; permisos?: string[] }
): Promise<RolRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('roles')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single<RolRow>()
  if (error) throw error
  return data
}

export async function eliminarRol(id: number): Promise<void> {
  const supabase = createClient()

  const { data: rol, error: errRol } = await supabase
    .from('roles')
    .select('codigo, nombre, es_sistema')
    .eq('id', id)
    .maybeSingle<{ codigo: string; nombre: string; es_sistema: boolean }>()
  if (errRol) throw errRol
  if (!rol) throw new Error('El rol no existe.')
  if (rol.es_sistema) {
    throw new Error(`"${rol.nombre}" es un rol base y no se puede borrar.`)
  }

  const { count, error: errUso } = await supabase
    .from('usuarios')
    .select('id', { count: 'exact', head: true })
    .eq('rol', rol.codigo)
  if (errUso) throw errUso
  if ((count ?? 0) > 0) {
    throw new Error(
      `Hay ${count} usuario(s) con el rol "${rol.nombre}". Reasignalos antes de borrarlo.`
    )
  }

  const { error } = await supabase.from('roles').delete().eq('id', id)
  if (error) throw error
}

// ─── Usuarios ───────────────────────────────────────────────────────

export interface UsuarioAdmin {
  id: string
  email: string
  nombre: string
  rol: string
  activo: boolean
}

export async function getUsuarios(): Promise<UsuarioAdmin[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('usuarios')
    .select('id, email, nombre, rol, activo')
    .order('nombre', { ascending: true })
  if (error) throw error
  return (data ?? []) as UsuarioAdmin[]
}

export async function actualizarUsuario(
  id: string,
  patch: { nombre?: string; rol?: string; activo?: boolean }
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('usuarios').update(patch).eq('id', id)
  if (error) throw error
}

export interface NuevoUsuarioPayload {
  nombre: string
  email: string
  password: string
  rol: string
}

/** Crea un usuario nuevo vía el endpoint protegido /api/usuarios. */
export async function crearUsuario(
  payload: NuevoUsuarioPayload
): Promise<void> {
  const res = await fetch('/api/usuarios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) {
    throw new Error(data.error ?? 'No se pudo crear el usuario.')
  }
}

/** Borra un usuario vía el endpoint protegido /api/usuarios (solo admin). */
export async function eliminarUsuario(id: string): Promise<void> {
  const res = await fetch(`/api/usuarios?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) {
    throw new Error(data.error ?? 'No se pudo borrar el usuario.')
  }
}
