import { createClient } from '@/lib/supabase/client'
import type {
  EstadoSugerencia,
  SugerenciaProductoRow,
} from '@/types/database'

export interface SugerenciaConRelaciones extends SugerenciaProductoRow {
  proveedor_nombre: string | null
  producto: { id: number; nombre: string } | null
  usuario_nombre: string | null
}

/** Lista las sugerencias con proveedor, producto y cajero resueltos. */
export async function getSugerencias(): Promise<SugerenciaConRelaciones[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('sugerencias_producto')
    .select(
      '*, proveedores(nombre), productos(id, nombre), usuarios(nombre)'
    )
    .order('created_at', { ascending: false })
  if (error) throw error

  type Cruda = SugerenciaProductoRow & {
    proveedores: { nombre: string } | null
    productos: { id: number; nombre: string } | null
    usuarios: { nombre: string } | null
  }

  return ((data ?? []) as unknown as Cruda[]).map(
    ({ proveedores, productos, usuarios, ...resto }) => ({
      ...resto,
      proveedor_nombre: proveedores?.nombre ?? null,
      producto: productos,
      usuario_nombre: usuarios?.nombre ?? null,
    })
  )
}

export interface NuevaSugerencia {
  texto: string
  nota: string | null
  usuario_id: string | null
}

/** Carga una sugerencia (desde el POS). Sin returning → no exige SELECT. */
export async function crearSugerencia(payload: NuevaSugerencia): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('sugerencias_producto').insert({
    texto: payload.texto.trim(),
    nota: payload.nota?.trim() ? payload.nota.trim() : null,
    usuario_id: payload.usuario_id,
  })
  if (error) throw error
}

export interface CambiosSugerencia {
  estado?: EstadoSugerencia
  proveedor_id?: number | null
  producto_id?: number | null
  nota?: string | null
}

/** Actualiza una sugerencia (gestión desde Compras). */
export async function actualizarSugerencia(
  id: number,
  cambios: CambiosSugerencia
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('sugerencias_producto')
    .update({ ...cambios, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}
