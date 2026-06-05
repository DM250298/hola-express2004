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
  /** Retenciones de IIBB ya sufridas (MP, bancos) en el período. */
  retenciones_sufridas: number
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

  // Facturas de compra emitidas en el período → IVA crédito
  const { data: facturas, error } = await supabase
    .from('facturas_compra')
    .select('neto, iva_total')
    .gte('fecha', desde)
    .lt('fecha', hastaExcl)
  if (error) throw error
  const comprasNeto = (facturas ?? []).reduce((s, f) => s + Number(f.neto), 0)
  const ivaCredito = (facturas ?? []).reduce(
    (s, f) => s + Number(f.iva_total),
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
  const retencionesIibb = retenciones.reduce((s, m) => s + Number(m.monto), 0)

  const iibbDeterminado = ventasNeto * (alicuotaIibb / 100)
  const iibbAPagar = Math.max(0, iibbDeterminado - retencionesIibb)
  const iibbSaldoFavor = Math.max(0, retencionesIibb - iibbDeterminado)

  return {
    iva: {
      ventas_total: r2(ventasTotal),
      ventas_neto: r2(ventasNeto),
      iva_debito: r2(ivaDebito),
      compras_neto: r2(comprasNeto),
      iva_credito: r2(ivaCredito),
      posicion: r2(ivaDebito - ivaCredito),
    },
    iibb: {
      jurisdiccion,
      alicuota: alicuotaIibb,
      base: r2(ventasNeto),
      determinado: r2(iibbDeterminado),
      retenciones_sufridas: r2(retencionesIibb),
      a_pagar: r2(iibbAPagar),
      saldo_favor: r2(iibbSaldoFavor),
    },
    retenciones_totales: r2(retencionesIibb),
  }
}
