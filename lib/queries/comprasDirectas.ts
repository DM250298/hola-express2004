import { createClient } from '@/lib/supabase/client'
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
  origen: 'turno' | 'cuenta'
  turno_id?: number | null
  cuenta_id?: number | null
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
}

/** Registra una factura de compra directa (pagada al instante) vía RPC atómico. */
export async function registrarCompraDirecta(p: CompraDirectaPayload) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_registrar_compra_directa', {
    p_usuario_id: p.usuario_id,
    p_proveedor_id: p.proveedor_id,
    p_fecha: p.fecha,
    p_fiscal: p.fiscal as unknown as Json,
    p_lineas: p.lineas as unknown as Json,
    p_gasto: (p.gasto ?? {}) as unknown as Json,
    p_mueve_stock: p.mueve_stock,
    p_afecta_precio_venta: p.afecta_precio_venta,
    p_pago: p.pago as unknown as Json,
  })
  if (error) throw error
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
