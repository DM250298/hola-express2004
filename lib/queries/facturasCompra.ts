import { createClient } from '@/lib/supabase/client'
import { completarCuitProveedor } from '@/lib/queries/proveedores'
import { soloDigitos } from '@/lib/utils/fiscal'
import type { FormaPago } from '@/lib/queries/finanzas'
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
  /** Costo neto = costo sin IVA con el descuento aplicado (valor del comprobante). */
  costoNeto: number
  /** Costo con IVA del comprobante — NO incluye gastos (es el IVA crédito gravado). */
  costoConIva: number
  /**
   * Costo final SIN IVA con los gastos no debitables ya prorrateados
   * (= costoNeto × factorGastos). Es el costo que se guarda como costo del
   * producto y la base sobre la que se calcula el precio de venta.
   */
  costoFinal: number
}

/**
 * Cálculo del lado COMPRA de una línea de factura a partir de los valores
 * editables.
 *
 * `factorGastos` (≥ 1) prorratea los gastos no debitables (flete, etc.) al
 * costo: el costo final se calcula sobre `costoNeto × factorGastos`,
 * exactamente como el RPC `fn_guardar_factura_compra` (migración 086). El
 * neto y el IVA del comprobante NO se tocan — los gastos no generan IVA
 * crédito. El redondeo es paso a paso (cada valor a 2 decimales) para que lo
 * que muestra el modal coincida al centavo con lo que el RPC guarda.
 *
 * El lado VENTA ya no se calcula acá: el precio sale del motor de pricing
 * (lib/pricing vía usePricing en el modal; fn_precio_venta en el RPC,
 * migración 109), que asegura el margen neto de cargas en lugar de
 * multiplicar costo × (1+margen) × (1+IVA).
 */
export function calcularLinea(
  e: EntradaLinea,
  factorGastos = 1
): LineaCalculada {
  const costoNeto = r2(e.costo_sin_iva * (1 - (e.descuento_porcentaje || 0) / 100))
  const costoConIva = r2(costoNeto * (1 + (e.iva_compra_porcentaje || 0) / 100))
  const costoFinal = r2(costoNeto * factorGastos)
  return { costoNeto, costoConIva, costoFinal }
}

export interface LineaFacturaPayload extends EntradaLinea {
  /** null para un producto que no estaba en el pedido (extra de la factura). */
  item_pedido_id: number | null
  producto_id: number
  cantidad: number
  /**
   * Precio de venta final (CON IVA) fijado a mano en la factura (mig 138).
   * Si viene, EL PRECIO MANDA: el RPC lo respeta tal cual y deduce el margen
   * real (par coherente). Null = el margen manda y el precio lo calcula el
   * motor, redondeando al múltiplo de arriba.
   */
  precio_venta?: number | null
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

/**
 * Pago integrado al guardar la factura (mig 144): la deuda se paga en la MISMA
 * transacción del RPC (si el pago falla, la factura tampoco se guarda). El
 * monto es libre: menor al total → pago parcial (el resto queda a cuenta
 * corriente); mayor → el sobrante se registra como diferencia por redondeo
 * (5.2.10) y la deuda queda pagada.
 */
export interface PagoFacturaPayload {
  cuenta_origen_id: number
  monto: number
  forma_pago: FormaPago
  comprobante?: string | null
  /** Fecha del PAGO (la plata sale hoy, no la fecha de emisión de la factura). */
  fecha: string
  nota?: string | null
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
  /** Pago en el mismo acto (mig 144); null/omitido = queda a cuenta corriente. */
  pago?: PagoFacturaPayload | null
}

export interface FacturaCompraCompleta {
  factura: FacturaCompraRow
  items: ItemFacturaCompraRow[]
}

export interface ComprobanteCargado {
  id: number
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
  /** Compra directa (sin orden). */
  es_directa: boolean
  /** Compra directa ya revisada por el administrativo. */
  controlada: boolean
  cuit_proveedor: string | null
  /** Quién cargó la factura (el vendedor, en las compras del POS). */
  usuario_nombre: string | null
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
      'id, cuenta_id, pedido_id, proveedor_id, fecha, tipo_comprobante, punto_venta, numero_comprobante, cae, neto, iva_total, total, es_directa, controlada, cuit_proveedor, usuarios(nombre)'
    )
    .order('fecha', { ascending: false })
  if (error) throw error

  type Fila = Omit<ComprobanteCargado, 'usuario_nombre'> & {
    usuarios: { nombre: string } | null
  }
  return ((data ?? []) as unknown as Fila[]).map((f) => ({
    id: f.id,
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
    es_directa: !!f.es_directa,
    controlada: !!f.controlada,
    cuit_proveedor: f.cuit_proveedor,
    usuario_nombre: f.usuarios?.nombre ?? null,
  }))
}

export interface ItemCompraDetalle {
  producto_id: number | null
  producto_nombre: string | null
  descripcion: string | null
  cantidad: number
  costo_sin_iva: number
  iva_compra_porcentaje: number
  costo_con_iva: number
}

/** Detalle (líneas) de una factura de compra, con el nombre del producto. */
export async function getItemsFacturaCompra(
  facturaId: number
): Promise<ItemCompraDetalle[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('items_factura_compra')
    .select(
      'producto_id, descripcion, cantidad, costo_sin_iva, iva_compra_porcentaje, costo_con_iva, productos(nombre)'
    )
    .eq('factura_id', facturaId)
    .order('id')
  if (error) throw error

  type Fila = {
    producto_id: number | null
    descripcion: string | null
    cantidad: number
    costo_sin_iva: number
    iva_compra_porcentaje: number
    costo_con_iva: number
    productos: { nombre: string } | null
  }
  return ((data ?? []) as unknown as Fila[]).map((it) => ({
    producto_id: it.producto_id,
    producto_nombre: it.productos?.nombre ?? null,
    descripcion: it.descripcion,
    cantidad: Number(it.cantidad),
    costo_sin_iva: Number(it.costo_sin_iva),
    iva_compra_porcentaje: Number(it.iva_compra_porcentaje),
    costo_con_iva: Number(it.costo_con_iva),
  }))
}

/** Edita los datos formales de una compra directa y/o la marca controlada. */
export async function controlarCompraDirecta(payload: {
  factura_id: number
  usuario_id: string
  tipo: string | null
  punto: string | null
  numero: string | null
  cuit: string | null
  controlada: boolean
}): Promise<void> {
  const supabase = createClient()
  // CUIT pelado: es parte de la clave del índice único de comprobantes, y si
  // acá entrara con guiones no cruzaría contra las otras puertas de carga.
  const cuit = payload.cuit ? soloDigitos(payload.cuit) || null : null

  // Pre-chequeo de duplicado: el RPC hace el update sin guarda, así que sin
  // esto un comprobante repetido devuelve el error crudo de Postgres
  // ("duplicate key value violates unique constraint…") en la cara del usuario.
  if (cuit && payload.tipo && payload.punto && payload.numero) {
    const { data: dup, error: errDup } = await supabase
      .from('facturas_compra')
      .select('id')
      .eq('cuit_proveedor', cuit)
      .eq('tipo_comprobante', payload.tipo)
      .eq('punto_venta', payload.punto)
      .eq('numero_comprobante', payload.numero)
      .neq('id', payload.factura_id)
      .limit(1)
      .maybeSingle<{ id: number }>()
    if (errDup) throw errDup
    if (dup) {
      throw new Error(
        `Ese comprobante (${payload.tipo} ${payload.punto}-${payload.numero}) ya está cargado en otra factura.`
      )
    }
  }

  const { error } = await supabase.rpc('fn_controlar_compra_directa', {
    p_factura_id: payload.factura_id,
    p_usuario_id: payload.usuario_id,
    p_tipo: payload.tipo,
    p_punto: payload.punto,
    p_numero: payload.numero,
    p_cuit: cuit,
    p_controlada: payload.controlada,
  })
  if (error) throw error
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
  // CUIT pelado UNA vez: se usa para el anti-duplicado y para guardar, así el
  // chequeo compara exactamente lo mismo que después queda en la fila (el
  // índice único compara texto exacto, y con guiones no cruzaría).
  const cuitNorm = comp?.cuit_proveedor
    ? soloDigitos(comp.cuit_proveedor) || null
    : null

  // 1. Anti-duplicado: si el comprobante está identificado por completo,
  //    no puede existir el mismo (CUIT + tipo + punto + número) en OTRA
  //    cuenta. Re-guardar la misma cuenta sí es válido.
  if (
    cuitNorm &&
    comp?.tipo_comprobante &&
    comp.punto_venta &&
    comp.numero_comprobante
  ) {
    const { data: dup, error: errDup } = await supabase
      .from('facturas_compra')
      .select('cuenta_id')
      .eq('cuit_proveedor', cuitNorm)
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
      precio_venta: l.precio_venta ?? null,
    })) as unknown as Json,
    // Solo se manda si hay gastos: así, antes de correr la migración 086, las
    // facturas sin gastos siguen resolviendo contra la firma vieja de la RPC.
    ...((payload.gastos_no_debitables ?? 0) > 0
      ? { p_gastos_no_debitables: payload.gastos_no_debitables }
      : {}),
    // Solo se manda si hay pago: sin la key, la llamada sigue resolviendo
    // contra la firma pre-144 hasta que se corra la migración.
    ...(payload.pago
      ? {
          p_pago: {
            cuenta_origen_id: payload.pago.cuenta_origen_id,
            monto: payload.pago.monto,
            forma_pago: payload.pago.forma_pago,
            comprobante: payload.pago.comprobante ?? null,
            fecha: payload.pago.fecha,
            nota: payload.pago.nota ?? null,
          } as unknown as Json,
        }
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
        cuit_proveedor: cuitNorm,
      })
      .eq('cuenta_id', payload.cuenta_id)
    if (errComp) throw errComp
  }

  // 4. Completa el CUIT en la ficha del proveedor si no tenía (nunca pisa uno
  //    cargado). Best-effort: la factura ya está guardada, un error acá no
  //    tiene que hacerla fallar.
  const cuitDigitos = (comp?.cuit_proveedor ?? '').replace(/\D/g, '')
  if (payload.proveedor_id && cuitDigitos.length === 11) {
    try {
      await completarCuitProveedor(payload.proveedor_id, cuitDigitos)
    } catch {
      // La ficha se completa a mano desde Configuración › Proveedores.
    }
  }
}

/**
 * Anula la factura de una cuenta a pagar (circuito con orden): revierte el
 * stock que la factura había ingresado (vuelve a lo recibido), reabre la deuda
 * como provisoria y borra el asiento. RPC `fn_anular_factura_compra` (mig 133).
 */
export async function anularFacturaCompra(
  cuentaId: number,
  usuarioId: string
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_anular_factura_compra', {
    p_cuenta_id: cuentaId,
    p_usuario_id: usuarioId,
  })
  if (error) throw error
}
