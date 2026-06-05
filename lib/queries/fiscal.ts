import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
import type { ConfigFiscalRow, ConfigFiscalUpdate } from '@/types/database'

const r2 = (n: number) => Math.round(n * 100) / 100

// ─── Configuración fiscal ────────────────────────────────────────────

/** Lee el singleton de configuración fiscal (id=1). */
export async function getConfigFiscal(): Promise<ConfigFiscalRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('config_fiscal')
    .select('*')
    .eq('id', 1)
    .single<ConfigFiscalRow>()
  if (error) throw error
  return data
}

/** Actualiza la configuración fiscal (siempre el id=1). */
export async function actualizarConfigFiscal(
  patch: ConfigFiscalUpdate
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('config_fiscal')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', 1)
  if (error) throw error
}

// ─── Resumen fiscal del período (IVA + IIBB + retenciones) ───────────

export interface BloqueIva {
  ventas_total: number
  /** Neto gravado de ventas (sin IVA). */
  ventas_neto: number
  iva_debito: number
  compras_neto: number
  iva_credito: number
  /** Percepciones de IVA sufridas en compras (pago a cuenta). */
  percepciones_iva: number
  /** Posición: > 0 IVA a pagar · < 0 saldo a favor. */
  posicion: number
}

export interface BloqueIibb {
  jurisdiccion: string
  alicuota: number
  /** Base imponible = ventas netas del período. */
  base: number
  /** IIBB determinado = base × alícuota. */
  determinado: number
  /** Retenciones de IIBB sufridas (MP/bancos) + percepciones de compra. */
  retenciones_sufridas: number
  /** Percepciones de IIBB sufridas en compras (parte de retenciones_sufridas). */
  percepciones_compra: number
  /** A pagar = determinado − retenciones (nunca negativo). */
  a_pagar: number
  /** Saldo a favor si las retenciones superan el determinado. */
  saldo_favor: number
}

export interface ResumenFiscal {
  iva: BloqueIva
  iibb: BloqueIibb
  /** Total de retenciones soportadas en el período (hoy solo IIBB). */
  retenciones_totales: number
}

/**
 * Resumen fiscal de un período (desde inclusive, hastaExcl exclusivo).
 *  · IVA débito  = IVA contenido en las ventas (precio final, alícuota general).
 *  · IVA crédito = IVA de las facturas de compra emitidas en el período.
 *  · IIBB        = ventas netas × alícuota − retenciones sufridas.
 *  · Retenciones sufridas = movimientos de cuenta con categoría 'iibb'
 *    (lo que MP/bancos ya le retuvieron al comercio).
 */
export async function getResumenFiscal(
  desde: string,
  hastaExcl: string,
  alicuotaIibb: number,
  jurisdiccion: string,
  alicuotaIvaGeneral = 21
): Promise<ResumenFiscal> {
  const supabase = createClient()
  const factorIva = 1 + alicuotaIvaGeneral / 100

  // Ventas del período
  const ventas = await traerTodo<{ total: number }>(() =>
    supabase
      .from('ventas')
      .select('total')
      .eq('estado', 'completada')
      .gte('fecha', desde)
      .lt('fecha', hastaExcl)
  )
  const ventasTotal = ventas.reduce((s, v) => s + Number(v.total), 0)
  const ventasNeto = ventasTotal / factorIva
  const ivaDebito = ventasTotal - ventasNeto

  // Facturas de compra emitidas en el período → IVA crédito + percepciones
  const { data: facturas, error } = await supabase
    .from('facturas_compra')
    .select('neto, iva_total, percepcion_iva, percepcion_iibb')
    .gte('fecha', desde)
    .lt('fecha', hastaExcl)
  if (error) throw error
  const comprasNeto = (facturas ?? []).reduce((s, f) => s + Number(f.neto), 0)
  const ivaCredito = (facturas ?? []).reduce(
    (s, f) => s + Number(f.iva_total),
    0
  )
  const percepcionesIva = (facturas ?? []).reduce(
    (s, f) => s + Number(f.percepcion_iva ?? 0),
    0
  )
  const percepcionesIibb = (facturas ?? []).reduce(
    (s, f) => s + Number(f.percepcion_iibb ?? 0),
    0
  )

  // Retenciones de IIBB ya sufridas (egresos categoría 'iibb')
  const retenciones = await traerTodo<{ monto: number }>(() =>
    supabase
      .from('movimientos_cuenta')
      .select('monto')
      .eq('categoria', 'iibb')
      .gte('fecha', desde)
      .lt('fecha', hastaExcl)
  )
  const retencionesIibbMov = retenciones.reduce(
    (s, m) => s + Number(m.monto),
    0
  )
  // Las percepciones de IIBB sufridas en compras también son pago a cuenta.
  const retencionesIibbTotal = retencionesIibbMov + percepcionesIibb

  const iibbDeterminado = ventasNeto * (alicuotaIibb / 100)
  const iibbAPagar = Math.max(0, iibbDeterminado - retencionesIibbTotal)
  const iibbSaldoFavor = Math.max(0, retencionesIibbTotal - iibbDeterminado)

  // Las percepciones de IVA reducen la posición (pago a cuenta del IVA).
  const ivaPosicion = ivaDebito - ivaCredito - percepcionesIva

  return {
    iva: {
      ventas_total: r2(ventasTotal),
      ventas_neto: r2(ventasNeto),
      iva_debito: r2(ivaDebito),
      compras_neto: r2(comprasNeto),
      iva_credito: r2(ivaCredito),
      percepciones_iva: r2(percepcionesIva),
      posicion: r2(ivaPosicion),
    },
    iibb: {
      jurisdiccion,
      alicuota: alicuotaIibb,
      base: r2(ventasNeto),
      determinado: r2(iibbDeterminado),
      retenciones_sufridas: r2(retencionesIibbTotal),
      percepciones_compra: r2(percepcionesIibb),
      a_pagar: r2(iibbAPagar),
      saldo_favor: r2(iibbSaldoFavor),
    },
    retenciones_totales: r2(retencionesIibbTotal),
  }
}

// ─── Libro IVA Compras (export, discriminado por alícuota) ───────────

export interface LineaLibroIva {
  fecha: string
  tipo_comprobante: string | null
  punto_venta: string | null
  numero_comprobante: string | null
  cae: string | null
  cuit_proveedor: string | null
  proveedor_nombre: string
  neto21: number
  iva21: number
  neto105: number
  iva105: number
  neto27: number
  iva27: number
  /** Neto no gravado / exento / alícuotas no estándar. */
  exento: number
  perc_iva: number
  perc_iibb: number
  total: number
}

export interface TotalesLibroIva {
  neto21: number
  iva21: number
  neto105: number
  iva105: number
  neto27: number
  iva27: number
  exento: number
  perc_iva: number
  perc_iibb: number
  total: number
}

export interface LibroIvaCompras {
  lineas: LineaLibroIva[]
  totales: TotalesLibroIva
}

/**
 * Libro IVA Compras de un período (desde inclusive, hastaExcl exclusivo).
 * Una fila por comprobante de `facturas_compra`, con el neto y el IVA
 * discriminados por alícuota (21 / 10,5 / 27) a partir de sus items. El
 * resto del neto (alícuota 0 u otras) cae en "exento". `proveedor_id` no
 * tiene FK → la razón social se resuelve en cliente.
 */
export async function getLibroIvaCompras(
  desde: string,
  hastaExcl: string
): Promise<LibroIvaCompras> {
  const supabase = createClient()

  type FacturaRow = {
    id: number
    fecha: string
    tipo_comprobante: string | null
    punto_venta: string | null
    numero_comprobante: string | null
    cae: string | null
    cuit_proveedor: string | null
    proveedor_id: number | null
    neto: number
    total: number
    percepcion_iva: number
    percepcion_iibb: number
  }

  const { data: facturasData, error } = await supabase
    .from('facturas_compra')
    .select(
      'id, fecha, tipo_comprobante, punto_venta, numero_comprobante, cae, cuit_proveedor, proveedor_id, neto, total, percepcion_iva, percepcion_iibb'
    )
    .gte('fecha', desde)
    .lt('fecha', hastaExcl)
    .order('fecha', { ascending: true })
  if (error) throw error
  const facturas = (facturasData ?? []) as unknown as FacturaRow[]

  const cero: TotalesLibroIva = {
    neto21: 0,
    iva21: 0,
    neto105: 0,
    iva105: 0,
    neto27: 0,
    iva27: 0,
    exento: 0,
    perc_iva: 0,
    perc_iibb: 0,
    total: 0,
  }
  if (facturas.length === 0) return { lineas: [], totales: cero }

  type ItemRow = {
    factura_id: number
    cantidad: number
    costo_sin_iva: number
    descuento_porcentaje: number
    iva_compra_porcentaje: number
  }
  const ids = facturas.map((f) => f.id)
  const { data: itemsData, error: e2 } = await supabase
    .from('items_factura_compra')
    .select(
      'factura_id, cantidad, costo_sin_iva, descuento_porcentaje, iva_compra_porcentaje'
    )
    .in('factura_id', ids)
  if (e2) throw e2
  const items = (itemsData ?? []) as unknown as ItemRow[]

  type ProvRow = { id: number; nombre: string; razon_social: string | null }
  const { data: provData, error: e3 } = await supabase
    .from('proveedores')
    .select('id, nombre, razon_social')
  if (e3) throw e3
  const provById = new Map(
    ((provData ?? []) as unknown as ProvRow[]).map((p) => [p.id, p])
  )

  const itemsPorFactura = new Map<number, ItemRow[]>()
  for (const it of items) {
    const arr = itemsPorFactura.get(it.factura_id) ?? []
    arr.push(it)
    itemsPorFactura.set(it.factura_id, arr)
  }

  const lineas: LineaLibroIva[] = facturas.map((f) => {
    let neto21 = 0
    let iva21 = 0
    let neto105 = 0
    let iva105 = 0
    let neto27 = 0
    let iva27 = 0
    for (const it of itemsPorFactura.get(f.id) ?? []) {
      const netoItem =
        Number(it.costo_sin_iva) *
        (1 - Number(it.descuento_porcentaje || 0) / 100) *
        Number(it.cantidad)
      const alic = Math.round(Number(it.iva_compra_porcentaje) * 10) / 10
      if (alic === 21) {
        neto21 += netoItem
        iva21 += netoItem * 0.21
      } else if (alic === 10.5) {
        neto105 += netoItem
        iva105 += netoItem * 0.105
      } else if (alic === 27) {
        neto27 += netoItem
        iva27 += netoItem * 0.27
      }
      // alícuota 0 u otras → quedan en "exento" vía la resta de abajo
    }
    const netoTotal = Number(f.neto)
    const exento = Math.max(0, netoTotal - (neto21 + neto105 + neto27))
    const prov = provById.get(f.proveedor_id ?? -1)
    return {
      fecha: f.fecha,
      tipo_comprobante: f.tipo_comprobante,
      punto_venta: f.punto_venta,
      numero_comprobante: f.numero_comprobante,
      cae: f.cae,
      cuit_proveedor: f.cuit_proveedor,
      proveedor_nombre: prov?.razon_social || prov?.nombre || '—',
      neto21: r2(neto21),
      iva21: r2(iva21),
      neto105: r2(neto105),
      iva105: r2(iva105),
      neto27: r2(neto27),
      iva27: r2(iva27),
      exento: r2(exento),
      perc_iva: r2(Number(f.percepcion_iva ?? 0)),
      perc_iibb: r2(Number(f.percepcion_iibb ?? 0)),
      total: Number(f.total),
    }
  })

  const sum = (sel: (l: LineaLibroIva) => number) =>
    r2(lineas.reduce((s, l) => s + sel(l), 0))
  const totales: TotalesLibroIva = {
    neto21: sum((l) => l.neto21),
    iva21: sum((l) => l.iva21),
    neto105: sum((l) => l.neto105),
    iva105: sum((l) => l.iva105),
    neto27: sum((l) => l.neto27),
    iva27: sum((l) => l.iva27),
    exento: sum((l) => l.exento),
    perc_iva: sum((l) => l.perc_iva),
    perc_iibb: sum((l) => l.perc_iibb),
    total: sum((l) => l.total),
  }

  return { lineas, totales }
}
