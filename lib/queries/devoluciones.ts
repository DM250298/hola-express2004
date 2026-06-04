import { createClient } from '@/lib/supabase/client'
import type { Json, TipoReembolso, DestinoItemDevolucion } from '@/types/database'

export interface ItemVentaDevolucion {
  item_venta_id: number
  producto_id: number
  nombre: string
  codigo_barras: string | null
  cantidad_vendida: number
  cantidad_ya_devuelta: number
  precio_unitario: number
}

export interface VentaParaDevolucion {
  venta_id: number
  fecha: string
  total: number
  medio_pago: string
  estado: string
  cliente_id: number | null
  items: ItemVentaDevolucion[]
}

/** Trae una venta con sus items y cuánto ya se devolvió de cada uno. */
export async function getVentaParaDevolucion(
  ventaId: number
): Promise<VentaParaDevolucion | null> {
  const supabase = createClient()

  const { data: venta, error: errV } = await supabase
    .from('ventas')
    .select('id, fecha, total, medio_pago, estado, cliente_id')
    .eq('id', ventaId)
    .maybeSingle()
  if (errV) throw errV
  if (!venta) return null

  const { data: items, error: errI } = await supabase
    .from('items_venta')
    .select('id, producto_id, cantidad, precio_unitario, productos(nombre, codigo_barras)')
    .eq('venta_id', ventaId)
  if (errI) throw errI

  const ids = (items ?? []).map((i) => i.id)
  const yaDevueltas = new Map<number, number>()
  if (ids.length > 0) {
    const { data: devs } = await supabase
      .from('items_devolucion')
      .select('item_venta_id, cantidad')
      .in('item_venta_id', ids)
    for (const d of devs ?? []) {
      const k = d.item_venta_id as number
      yaDevueltas.set(k, (yaDevueltas.get(k) ?? 0) + Number(d.cantidad))
    }
  }

  type FilaItem = {
    id: number
    producto_id: number
    cantidad: number
    precio_unitario: number
    productos: { nombre: string; codigo_barras: string | null } | null
  }

  return {
    venta_id: venta.id,
    fecha: venta.fecha,
    total: Number(venta.total),
    medio_pago: venta.medio_pago,
    estado: venta.estado,
    cliente_id: venta.cliente_id ?? null,
    items: ((items ?? []) as unknown as FilaItem[]).map((i) => ({
      item_venta_id: i.id,
      producto_id: i.producto_id,
      nombre: i.productos?.nombre ?? 'Producto',
      codigo_barras: i.productos?.codigo_barras ?? null,
      cantidad_vendida: i.cantidad,
      cantidad_ya_devuelta: yaDevueltas.get(i.id) ?? 0,
      precio_unitario: Number(i.precio_unitario),
    })),
  }
}

export interface ItemDevolucionPayload {
  item_venta_id: number
  producto_id: number
  cantidad: number
  precio_unitario: number
  destino: DestinoItemDevolucion
}

export interface CrearDevolucionPayload {
  venta_id: number
  usuario_id: string
  turno_id: number | null
  motivo: string | null
  tipo_reembolso: TipoReembolso
  cliente_id: number | null
  items: ItemDevolucionPayload[]
}

export interface ResultadoDevolucion {
  devolucion_id: number
  total_devuelto: number
  nota_credito_id: number | null
  codigo_nc: string | null
}

export async function crearDevolucion(
  payload: CrearDevolucionPayload
): Promise<ResultadoDevolucion> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_crear_devolucion', {
    p_venta_id: payload.venta_id,
    p_usuario_id: payload.usuario_id,
    p_turno_id: payload.turno_id,
    p_motivo: payload.motivo,
    p_tipo_reembolso: payload.tipo_reembolso,
    p_cliente_id: payload.cliente_id,
    p_items: payload.items as unknown as Json,
  })
  if (error) throw error
  return data as ResultadoDevolucion
}
