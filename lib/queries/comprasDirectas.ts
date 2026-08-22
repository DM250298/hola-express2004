import { createClient } from '@/lib/supabase/client'
import { completarCuitProveedor } from '@/lib/queries/proveedores'
import {
  exigeDatosFiscales,
  normalizarNumeroComprobante,
  normalizarPuntoVenta,
  numeroComprobanteValido,
  puntoVentaValido,
  soloDigitos,
} from '@/lib/utils/fiscal'
import {
  labelComprobante,
  requiereComprobante,
  type CuotaPlanPayload,
  type FormaPago,
} from '@/lib/queries/finanzas'
import type { Json } from '@/types/database'

export interface CompraDirectaLinea {
  producto_id: number
  cantidad: number
  costo_sin_iva: number
  descuento_porcentaje?: number
  iva_compra_porcentaje: number
  margen_porcentaje: number
  iva_venta_porcentaje: number
}

export interface CompraDirectaFiscal {
  tipo_comprobante: string | null
  punto_venta: string | null
  numero_comprobante: string | null
  cuit: string | null
  neto: number
  iva_total: number
  perc_iva?: number
  perc_iibb?: number
  perc_otros?: number
  gastos?: number
}

export interface CompraDirectaPago {
  /** 'ninguno' (mig 149) = no se paga nada ahora: todo el total queda a CC. */
  origen: 'turno' | 'cuenta' | 'ninguno'
  turno_id?: number | null
  cuenta_id?: number | null
  /** Importe que se paga AHORA (mig 149). Omitido = el total (compat v1). */
  monto?: number
  /** Forma de pago (mig 155). Origen turno = siempre efectivo. */
  forma_pago?: FormaPago | null
  /** N° de transferencia / cheque / operación (mig 155): obligatorio según la forma. */
  comprobante?: string | null
}

export interface CompraDirectaPayload {
  usuario_id: string
  proveedor_id: number
  fecha: string
  fiscal: CompraDirectaFiscal
  /** Líneas de producto (solo cuando mueve_stock). */
  lineas: CompraDirectaLinea[]
  /** Datos del gasto sin stock (cuando !mueve_stock). */
  gasto: { descripcion: string; categoria: string } | null
  mueve_stock: boolean
  afecta_precio_venta: boolean
  pago: CompraDirectaPago
  /** Saldo a cuenta corriente (mig 149): vencimiento único del impago. */
  cta_cte?: { fecha_vencimiento: string; nota?: string | null } | null
  /** Plan de cuotas del saldo (mig 149 → fn_definir_cuotas_cuenta). */
  cuotas?: CuotaPlanPayload[] | null
}

/**
 * Registra una factura de compra directa vía RPC atómico. El pago puede ser
 * total (como siempre), parcial o nulo (mig 149): el saldo queda como deuda
 * al proveedor, con vencimiento único o en cuotas.
 */
export async function registrarCompraDirecta(p: CompraDirectaPayload) {
  const supabase = createClient()
  // Pto/número al formato AFIP (mig 155): el índice único y los anti-duplicados
  // comparan texto exacto. El RPC v3 normaliza y valida igual (defensa en
  // profundidad); acá el mensaje llega antes y en castellano claro.
  const fiscal = {
    ...p.fiscal,
    punto_venta: normalizarPuntoVenta(p.fiscal.punto_venta) || null,
    numero_comprobante: normalizarNumeroComprobante(p.fiscal.numero_comprobante) || null,
  }
  const cuitDigitos = soloDigitos(p.fiscal.cuit ?? '')
  if (exigeDatosFiscales(p.fiscal.tipo_comprobante)) {
    if (!p.fiscal.tipo_comprobante) throw new Error('Falta el tipo de comprobante.')
    if (!fiscal.punto_venta) throw new Error('Falta el punto de venta del comprobante.')
    if (!fiscal.numero_comprobante) throw new Error('Falta el número del comprobante.')
    if (cuitDigitos.length !== 11) {
      throw new Error('Falta el CUIT del proveedor (11 dígitos).')
    }
  }
  if (fiscal.punto_venta && !puntoVentaValido(fiscal.punto_venta)) {
    throw new Error('El punto de venta tiene más de 5 dígitos.')
  }
  if (fiscal.numero_comprobante && !numeroComprobanteValido(fiscal.numero_comprobante)) {
    throw new Error('El número de comprobante tiene más de 8 dígitos.')
  }
  if (
    p.pago.origen === 'cuenta' &&
    requiereComprobante(p.pago.forma_pago) &&
    !(p.pago.comprobante ?? '').trim()
  ) {
    throw new Error(`Falta el ${labelComprobante(p.pago.forma_pago)} del pago.`)
  }
  const { data, error } = await supabase.rpc('fn_registrar_compra_directa', {
    p_usuario_id: p.usuario_id,
    p_proveedor_id: p.proveedor_id,
    p_fecha: p.fecha,
    p_fiscal: fiscal as unknown as Json,
    p_lineas: p.lineas as unknown as Json,
    p_gasto: (p.gasto ?? {}) as unknown as Json,
    p_mueve_stock: p.mueve_stock,
    p_afecta_precio_venta: p.afecta_precio_venta,
    p_pago: p.pago as unknown as Json,
    // Solo viajan si hay saldo a CC: sin las keys, la llamada sigue
    // resolviendo contra la firma pre-149 hasta correr la migración.
    ...(p.cta_cte ? { p_cta_cte: p.cta_cte as unknown as Json } : {}),
    ...(p.cuotas && p.cuotas.length > 0
      ? { p_cuotas: p.cuotas as unknown as Json }
      : {}),
  })
  if (error) throw error

  // Completa el CUIT en la ficha del proveedor si no tenía (nunca pisa uno ya
  // cargado: el filtro `.is('cuit', null)` corre en el server). Best-effort: la
  // compra ya quedó registrada y pagada, un error acá no puede voltearla.
  if (p.proveedor_id && cuitDigitos.length === 11) {
    try {
      await completarCuitProveedor(p.proveedor_id, cuitDigitos)
    } catch {
      // Se completa a mano desde Configuración › Proveedores.
    }
  }

  return data
}

/** Anula una compra directa: repone stock, revierte el pago y borra la factura. */
export async function anularCompraDirecta(
  facturaId: number,
  usuarioId: string
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_anular_compra_directa', {
    p_factura_id: facturaId,
    p_usuario_id: usuarioId,
  })
  if (error) throw error
}
