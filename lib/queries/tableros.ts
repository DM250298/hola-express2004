import { createClient } from '@/lib/supabase/client'
import type {
  RolTablero,
  TableroInsert,
  TableroMiembroRow,
  TableroRow,
  TableroUpdate,
  VistaTableroUsuarioRow,
} from '@/types/database'

// ─── Tableros ────────────────────────────────────────────────────────────────

/**
 * Devuelve los tableros que el usuario puede ver:
 *   · admins del sistema → todos
 *   · resto              → solo aquellos donde es miembro
 *
 * `esAdminSistema` lo decide la UI a partir del rol del usuario.
 */
export async function getTablerosVisibles(
  esAdminSistema: boolean
): Promise<VistaTableroUsuarioRow[]> {
  const supabase = createClient()
  let q = supabase
    .from('vista_tableros_usuario')
    .select('*')
    .eq('archivado', false)
    .order('created_at', { ascending: false })

  if (!esAdminSistema) {
    q = q.not('mi_rol', 'is', null)
  }

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as VistaTableroUsuarioRow[]
}

export async function getTablero(id: number): Promise<VistaTableroUsuarioRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('vista_tableros_usuario')
    .select('*')
    .eq('id', id)
    .single<VistaTableroUsuarioRow>()
  if (error) throw error
  return data
}

export async function createTablero(
  datos: TableroInsert,
  creadorId: string | null
): Promise<TableroRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tableros')
    .insert(datos)
    .select()
    .single<TableroRow>()
  if (error) throw error

  // El creador entra automáticamente como admin del tablero (si tenemos id).
  if (creadorId) {
    await supabase
      .from('tablero_miembros')
      .upsert(
        { tablero_id: data.id, usuario_id: creadorId, rol: 'admin' },
        { onConflict: 'tablero_id,usuario_id' }
      )
  }

  return data
}

export async function updateTablero(
  id: number,
  datos: TableroUpdate
): Promise<TableroRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tableros')
    .update({ ...datos, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single<TableroRow>()
  if (error) throw error
  return data
}

export async function deleteTablero(id: number): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('tableros').delete().eq('id', id)
  if (error) throw error
}

// ─── Miembros del tablero ────────────────────────────────────────────────────

export async function getMiembrosTablero(
  tableroId: number
): Promise<TableroMiembroRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tablero_miembros')
    .select('*')
    .eq('tablero_id', tableroId)
    .order('agregado_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as TableroMiembroRow[]
}

export async function agregarMiembro(
  tableroId: number,
  usuarioId: string,
  rol: RolTablero
): Promise<TableroMiembroRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tablero_miembros')
    .upsert(
      { tablero_id: tableroId, usuario_id: usuarioId, rol },
      { onConflict: 'tablero_id,usuario_id' }
    )
    .select()
    .single<TableroMiembroRow>()
  if (error) throw error
  return data
}

export async function quitarMiembro(
  tableroId: number,
  usuarioId: string
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('tablero_miembros')
    .delete()
    .eq('tablero_id', tableroId)
    .eq('usuario_id', usuarioId)
  if (error) throw error
}

export async function cambiarRolMiembro(
  tableroId: number,
  usuarioId: string,
  rol: RolTablero
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('tablero_miembros')
    .update({ rol })
    .eq('tablero_id', tableroId)
    .eq('usuario_id', usuarioId)
  if (error) throw error
}
