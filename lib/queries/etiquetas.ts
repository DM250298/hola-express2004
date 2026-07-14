import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
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

  type Fila = EtiquetaPendienteRow & {
    productos: { nombre: string; codigo_barras: string | null } | null
  }

  // Paginado con traerTodo: un cambio masivo de precios puede encolar miles
  // de etiquetas y PostgREST corta en 1000 filas por request. El order por id
  // desempata las fechas repetidas — sin un orden total la paginación
  // duplica o saltea filas entre páginas.
  const filas = await traerTodo<Fila>(() =>
    supabase
      .from('etiquetas_pendientes')
      .select('*, productos(nombre, codigo_barras)')
      .order('fecha', { ascending: false })
      .order('id', { ascending: false })
  )

  return filas.map(({ productos, ...resto }) => ({
    ...resto,
    precio: Number(resto.precio),
    precio_anterior:
      resto.precio_anterior != null ? Number(resto.precio_anterior) : null,
    producto_nombre: productos?.nombre ?? 'Producto eliminado',
    codigo_barras: productos?.codigo_barras ?? null,
  }))
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
 * Marca VARIAS etiquetas como colocadas de una (después de una impresión
 * masiva). Borra en lotes: los ids van en la URL del request y miles de ids
 * juntos la pasarían de largo.
 */
export async function quitarEtiquetasPendientes(ids: number[]): Promise<void> {
  const supabase = createClient()
  const LOTE = 400
  for (let i = 0; i < ids.length; i += LOTE) {
    const { error } = await supabase
      .from('etiquetas_pendientes')
      .delete()
      .in('id', ids.slice(i, i + LOTE))
    if (error) throw error
  }
}
