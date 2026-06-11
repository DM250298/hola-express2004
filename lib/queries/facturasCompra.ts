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
  /** null para un producto que no estaba en el pedido (extra de la factura). */
  item_pedido_id: number | null
  producto_id: number
  cantidad: number
}

/** Datos formales del comprobante (cabecera AFIP). Todos opcionales. */
export interface DatosComprobante {
  tipo_comprobante: string | null
  punto_venta: string | null
  numero_comprobante: string | null
  cae: string | null
  cuit_proveedor: string | null
}

export interface PercepcionesPayload {
  iva: number
  iibb: number
  otros: number
}

export interface GuardarFacturaPayload {
  cuenta_id: number
  pedido_id: number
  proveedor_id: number | null
  /** Fecha de EMISIÓN del comprobante (define el período fiscal). */
  fecha: string
  afecta_precio_venta: boolean
  usuario_id: string
  lineas: LineaFacturaPayload[]
  /** Percepciones sufridas (suman al total a pagar y quedan como saldo a favor). */
  percepciones?: PercepcionesPayload
  /** Gastos NO debitables (flete, etc.): se prorratean al costo de los productos, sin IVA. */
  gastos_no_debitables?: number
  /** Datos formales del comprobante; si se omiten, no se tocan. */
  comprobante?: DatosComprobante
}

export interface FacturaCompraCompleta {
  factura: FacturaCompraRow
  items: ItemFacturaCompraRow[]
}

export interface ComprobanteCargado {
  cuenta_id: number | null
  pedido_id: number | null
  proveedor_id: number | null
  fecha: string
  tipo_comprobante: string | null
  punto_venta: string | null
  numero_comprobante: string | null
  cae: string | null
  neto: number
  iva_total: number
  total: number
}

/**
 * Lista las facturas de compra cargadas. NO embebe `proveedores` porque
 * `facturas_compra.proveedor_id` no tiene FK declarada hacia esa tabla
 * (migración 012), así que PostgREST no resuelve el embed y la query
 * fallaría. El nombre del proveedor se resuelve en la UI por proveedor_id.
 */
export async function getComprobantesCargados(): Promise<ComprobanteCargado[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('facturas_compra')
    .select(
      'cuenta_id, pedido_id, proveedor_id, fecha, tipo_comprobante, punto_venta, numero_comprobante, cae, neto, iva_total, total'
    )
    .order('fecha', { ascending: false })
  if (error) throw error

  return ((data ?? []) as unknown as ComprobanteCargado[]).map((f) => ({
    cuenta_id: f.cuenta_id,
    pedido_id: f.pedido_id,
    proveedor_id: f.proveedor_id,
    fecha: f.fecha,
    tipo_comprobante: f.tipo_comprobante,
    punto_venta: f.punto_venta,
    numero_comprobante: f.numero_comprobante,
    cae: f.cae,
    neto: Number(f.neto),
    iva_total: Number(f.iva_total),
    total: Number(f.total),
  }))
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
  const comp = payload.comprobante

  // 1. Anti-duplicado: si el comprobante está identificado por completo,
  //    no puede existir el mismo (CUIT + tipo + punto + número) en OTRA
  //    cuenta. Re-guardar la misma cuenta sí es válido.
  if (
    comp?.cuit_proveedor &&
    comp.tipo_comprobante &&
    comp.punto_venta &&
    comp.numero_comprobante
  ) {
    const { data: dup, error: errDup } = await supabase
      .from('facturas_compra')
      .select('cuenta_id')
      .eq('cuit_proveedor', comp.cuit_proveedor)
      .eq('tipo_comprobante', comp.tipo_comprobante)
      .eq('punto_venta', comp.punto_venta)
      .eq('numero_comprobante', comp.numero_comprobante)
      .neq('cuenta_id', payload.cuenta_id)
      .maybeSingle<{ cuenta_id: number | null }>()
    if (errDup) throw errDup
    if (dup) {
      throw new Error(
        `Ese comprobante (${comp.tipo_comprobante} ${comp.punto_venta}-${comp.numero_comprobante}) ya fue cargado para otra cuenta.`
      )
    }
  }

  // 2. RPC de costos/precios (NO toca los campos formales).
  const { error } = await supabase.rpc('fn_guardar_factura_compra', {
    p_cuenta_id: payload.cuenta_id,
    p_pedido_id: payload.pedido_id,
    p_proveedor_id: payload.proveedor_id,
    p_fecha: payload.fecha,
    p_afecta_precio_venta: payload.afecta_precio_venta,
    p_usuario_id: payload.usuario_id,
    p_percepciones: {
      iva: payload.percepciones?.iva ?? 0,
      iibb: payload.percepciones?.iibb ?? 0,
      otros: payload.percepciones?.otros ?? 0,
    } as unknown as Json,
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
    // Solo se manda si hay gastos: así, antes de correr la migración 086, las
    // facturas sin gastos siguen resolviendo contra la firma vieja de la RPC.
    ...((payload.gastos_no_debitables ?? 0) > 0
      ? { p_gastos_no_debitables: payload.gastos_no_debitables }
      : {}),
  })
  if (error) throw error

  // 3. Cabecera formal del comprobante (UPDATE aditivo por cuenta_id).
  if (comp) {
    const { error: errComp } = await supabase
      .from('facturas_compra')
      .update({
        tipo_comprobante: comp.tipo_comprobante,
        punto_venta: comp.punto_venta,
        numero_comprobante: comp.numero_comprobante,
        cae: comp.cae,
        cuit_proveedor: comp.cuit_proveedor,
      })
      .eq('cuenta_id', payload.cuenta_id)
    if (errComp) throw errComp
  }
}
