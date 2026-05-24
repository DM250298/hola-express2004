import { createClient } from '@/lib/supabase/client'
import type { TareaRow } from '@/types/database'

/** Tarea + nombre del proyecto/sección y del tablero — para la agenda. */
export type TareaAgenda = TareaRow & {
  proyecto_nombre: string
  tablero_id: number
  tablero_nombre: string
  tablero_color: string
}

/**
 * Devuelve todas las tareas no completadas asignadas a un usuario,
 * ordenadas por fecha_limite (las que no tienen, al final).
 *
 * Si `verTodas` es true, trae las tareas de todos los usuarios — útil
 * para el admin del sistema.
 */
export async function getAgenda(
  usuarioId: string,
  verTodas: boolean
): Promise<TareaAgenda[]> {
  const supabase = createClient()
  let q = supabase
    .from('tareas')
    .select(
      `*,
       proyectos!inner (
         nombre,
         tablero_id,
         tableros!inner ( nombre, color )
       )`
    )
    .neq('estado', 'hecha')

  if (!verTodas) {
    q = q.eq('responsable_id', usuarioId)
  }

  const { data, error } = await q
  if (error) throw error

  // Aplanar la respuesta para que sea TareaAgenda.
  type Raw = TareaRow & {
    proyectos: {
      nombre: string
      tablero_id: number
      tableros: { nombre: string; color: string }
    } | null
  }

  const filas = (data ?? []) as unknown as Raw[]
  const ret: TareaAgenda[] = filas.map((t) => ({
    ...t,
    proyecto_nombre: t.proyectos?.nombre ?? '—',
    tablero_id: t.proyectos?.tablero_id ?? 0,
    tablero_nombre: t.proyectos?.tableros?.nombre ?? '—',
    tablero_color: t.proyectos?.tableros?.color ?? '#f9b44c',
  }))

  // Orden: las que tienen fecha primero (asc), después las que no tienen fecha.
  ret.sort((a, b) => {
    if (a.fecha_limite && b.fecha_limite)
      return a.fecha_limite.localeCompare(b.fecha_limite)
    if (a.fecha_limite) return -1
    if (b.fecha_limite) return 1
    return a.created_at.localeCompare(b.created_at)
  })

  return ret
}
