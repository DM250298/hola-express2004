import { createClient } from '@/lib/supabase/client'
import type { EtiquetaPendienteRow } from '@/types/database'

export interface EtiquetaPendiente {
  id: number
  producto_id: number
  precio: number
  precio_anterior: number | null
  fecha: string
  producto_nombre: string
  codigo_barras: string | null
}

/** Etiquetas de precio que cambiaron y faltan colocar en góndola. */
export async function getEtiquetasPendientes(): Promise<EtiquetaPendiente[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('etiquetas_pendientes')
    .select('*, productos(nombre, codigo_barras)')
    .order('fecha', { ascending: false })
  if (error) throw error

  type Fila = EtiquetaPendienteRow & {
    productos: { nombre: string; codigo_barras: string | null } | null
  }
  return ((data ?? []) as unknown as Fila[]).map(
    ({ productos, ...resto }) => ({
      ...resto,
      precio: Number(resto.precio),
      precio_anterior:
        resto.precio_anterior != null ? Number(resto.precio_anterior) : null,
      producto_nombre: productos?.nombre ?? 'Producto eliminado',
      codigo_barras: productos?.codigo_barras ?? null,
    })
  )
}

/** Marca una etiqueta como colocada — se elimina de la cola. */
export async function quitarEtiquetaPendiente(id: number): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('etiquetas_pendientes')
    .delete()
    .eq('id', id)
  if (error) throw error
}

/**
 * Quita de la cola la etiqueta pendiente de un producto (si la hubiera).
 * Se llama al imprimir la etiqueta desde Stock/Detalle, para que las dos vías
 * de impresión queden sincronizadas. No falla si el producto no estaba en cola.
 */
export async function marcarColocadaPorProducto(productoId: number): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('etiquetas_pendientes')
    .delete()
    .eq('producto_id', productoId)
  if (error) throw error
}
