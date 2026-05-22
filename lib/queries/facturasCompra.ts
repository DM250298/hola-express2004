import { createClient } from '@/lib/supabase/client'
import type {
  FacturaCompraRow,
  ItemFacturaCompraRow,
  Json,
} from '@/types/database'

const r2 = (n: number) => Math.round(n * 100) / 100

export interface EntradaLinea {
  costo_sin_iva: number
  descuento_porcentaje: number
  iva_compra_porcentaje: number
  margen_porcentaje: number
  iva_venta_porcentaje: number
}

export interface LineaCalculada {
  /** Costo neto = costo sin IVA con el descuento aplicado. */
  costoNeto: number
  costoConIva: number
  precioSinIva: number
  precioConIva: number
}

/** Cálculo de una línea de factura a partir de los valores editables. */
export function calcularLinea(e: EntradaLinea): LineaCalculada {
  const costoNeto = e.costo_sin_iva * (1 - (e.descuento_porcentaje || 0) / 100)
  const costoConIva = costoNeto * (1 + (e.iva_compra_porcentaje || 0) / 100)
  const precioSinIva = costoNeto * (1 + (e.margen_porcentaje || 0) / 100)
  const precioConIva = precioSinIva * (1 + (e.iva_venta_porcentaje || 0) / 100)
  return {
    costoNeto: r2(costoNeto),
    costoConIva: r2(costoConIva),
    precioSinIva: r2(precioSinIva),
    precioConIva: r2(precioConIva),
  }
}

export interface LineaFacturaPayload extends EntradaLinea {
  item_pedido_id: number
  producto_id: number
  cantidad: number
}

export interface GuardarFacturaPayload {
  cuenta_id: number
  pedido_id: number
  proveedor_id: number | null
  fecha: string
  afecta_precio_venta: boolean
  usuario_id: string
  lineas: LineaFacturaPayload[]
}

export interface FacturaCompraCompleta {
  factura: FacturaCompraRow
  items: ItemFacturaCompraRow[]
}

/** Devuelve la factura guardada para una cuenta a pagar (o null). */
export async function getFacturaCompra(
  cuentaId: number
): Promise<FacturaCompraCompleta | null> {
  const supabase = createClient()
  const { data: factura, error } = await supabase
    .from('facturas_compra')
    .select('*')
    .eq('cuenta_id', cuentaId)
    .maybeSingle<FacturaCompraRow>()
  if (error) throw error
  if (!factura) return null

  const { data: items, error: errItems } = await supabase
    .from('items_factura_compra')
    .select('*')
    .eq('factura_id', factura.id)
    .order('id', { ascending: true })
  if (errItems) throw errItems

  return { factura, items: (items ?? []) as ItemFacturaCompraRow[] }
}

/**
 * Guarda la factura de compra de una cuenta a pagar:
 *  · Reemplaza la factura previa (si existía) y sus items.
 *  · Actualiza el precio de costo NETO de cada producto.
 *  · Si "afecta precio de venta", actualiza el precio de venta (con IVA).
 *  · Recalcula el total del pedido y el monto de la cuenta a pagar.
 */
export async function guardarFacturaCompra(
  payload: GuardarFacturaPayload
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_guardar_factura_compra', {
    p_cuenta_id: payload.cuenta_id,
    p_pedido_id: payload.pedido_id,
    p_proveedor_id: payload.proveedor_id,
    p_fecha: payload.fecha,
    p_afecta_precio_venta: payload.afecta_precio_venta,
    p_usuario_id: payload.usuario_id,
    p_lineas: payload.lineas.map((l) => ({
      item_pedido_id: l.item_pedido_id,
      producto_id: l.producto_id,
      cantidad: l.cantidad,
      costo_sin_iva: l.costo_sin_iva,
      descuento_porcentaje: l.descuento_porcentaje,
      iva_compra_porcentaje: l.iva_compra_porcentaje,
      margen_porcentaje: l.margen_porcentaje,
      iva_venta_porcentaje: l.iva_venta_porcentaje,
    })) as unknown as Json,
  })
  if (error) throw error
}
