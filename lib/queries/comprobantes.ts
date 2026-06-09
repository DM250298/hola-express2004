import { createClient } from '@/lib/supabase/client'
import type { PedidoComprobanteRow } from '@/types/database'

/** Bucket PRIVADO (ver migración 073). Se accede con signed URLs temporales. */
const BUCKET = 'comprobantes'
const MAX_MB = 10
/** Vigencia de la URL firmada para mostrar la miniatura (1 hora). */
const URL_TTL_SEG = 3600

export interface ComprobanteImagen {
  id: number
  pedido_id: number
  storage_path: string
  created_at: string
  /** URL firmada temporal para mostrar/abrir la imagen (bucket privado). */
  url: string | null
}

/** Imágenes de comprobante (factura/remito) de un pedido, con URL firmada. */
export async function getComprobantesPedido(
  pedidoId: number
): Promise<ComprobanteImagen[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('pedido_comprobantes')
    .select('id, pedido_id, storage_path, created_at')
    .eq('pedido_id', pedidoId)
    .order('created_at', { ascending: true })
  if (error) throw error

  type Fila = Pick<
    PedidoComprobanteRow,
    'id' | 'pedido_id' | 'storage_path' | 'created_at'
  >
  const filas = (data ?? []) as Fila[]

  return Promise.all(
    filas.map(async (f) => {
      const { data: firmada } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(f.storage_path, URL_TTL_SEG)
      return { ...f, url: firmada?.signedUrl ?? null }
    })
  )
}

/**
 * Sube una imagen al bucket y registra la fila. Si el insert falla, borra el
 * archivo recién subido (best-effort) para no dejar huérfanos.
 */
export async function subirComprobante(
  pedidoId: number,
  file: File,
  usuarioId: string | null
): Promise<void> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Elegí un archivo de imagen.')
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    throw new Error(`La imagen supera los ${MAX_MB} MB.`)
  }

  const supabase = createClient()
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `pedido_${pedidoId}/${crypto.randomUUID()}.${ext}`

  const { error: errUp } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false })
  if (errUp) throw errUp

  const { error: errIns } = await supabase
    .from('pedido_comprobantes')
    .insert({ pedido_id: pedidoId, storage_path: path, usuario_id: usuarioId })
  if (errIns) {
    await supabase.storage.from(BUCKET).remove([path])
    throw errIns
  }
}

/** Borra la fila y el archivo del storage. */
export async function eliminarComprobante(
  id: number,
  storagePath: string
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('pedido_comprobantes')
    .delete()
    .eq('id', id)
  if (error) throw error
  await supabase.storage.from(BUCKET).remove([storagePath])
}
