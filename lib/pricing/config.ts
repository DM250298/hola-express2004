// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Motor de precios — adaptador de configuración                         ║
// ║                                                                        ║
// ║  Traduce la config editable del sistema a la ConfigPricing que        ║
// ║  consume el motor. Fuentes (todas editables sin tocar código):        ║
// ║    · config_fiscal → IVA, IIBB, imp. créd/déb, régimen, múltiplo de   ║
// ║      redondeo                                                          ║
// ║    · medios_pago   → tasa de MP del peor caso (max de comisiones)     ║
// ║                                                                        ║
// ║  Este es el ÚNICO lugar acoplado a medios_pago; el motor es puro.     ║
// ╚══════════════════════════════════════════════════════════════════════╝

import type { ConfigFiscalRow, MedioPagoRow } from '@/types/database'
import type { ConfigPricing, RegimenFiscal } from './tipos'
import { seleccionarPeorTasa } from './motor'

/**
 * ¿Es un medio de Mercado Pago? (los que cobran comisión y mapean a la API de
 * MP). Efectivo/transferencia no tienen mapeo de MP, así que quedan fuera del
 * peor caso de comisión.
 */
export function esMedioMercadoPago(m: MedioPagoRow): boolean {
  return m.mp_payment_type != null || m.mp_channel != null
}

/**
 * Deriva la tasa de MP del peor caso, SIN IVA y en fracción, desde medios_pago.
 * `medios_pago.comision_porcentaje` se guarda CON IVA (convención del repo:
 * cargar `tasa publicada × 1.21`), así que se vuelve a "sin IVA" dividiendo por
 * (1 + iva). Se toma el max sobre los medios MP con comisión > 0 — el motor le
 * reaplica el IVA, de modo que la comisión efectiva usada = la comisión con IVA
 * más alta configurada.
 *
 * Si no hay medios MP con comisión, devuelve 0 (no hay comisión que cubrir).
 */
export function derivarTasaMpPeorCaso(
  medios: readonly MedioPagoRow[],
  iva: number
): number {
  const tasasSinIva = medios
    .filter(esMedioMercadoPago)
    .map((m) => m.comision_porcentaje)
    .filter((c) => Number.isFinite(c) && c > 0)
    .map((c) => c / 100 / (1 + iva))

  if (tasasSinIva.length === 0) return 0
  return seleccionarPeorTasa(tasasSinIva)
}

/** Mapea la condición de IVA de config_fiscal al régimen del motor. */
export function regimenDesdeConfig(condicionIva: string): RegimenFiscal {
  return condicionIva === 'monotributista'
    ? 'monotributista'
    : 'responsable_inscripto'
}

/**
 * Arma la ConfigPricing a partir de la config fiscal y los medios de pago.
 * Todas las alícuotas salen de la DB; ninguna está hardcodeada.
 */
export function armarConfigPricing(
  fiscal: ConfigFiscalRow,
  medios: readonly MedioPagoRow[]
): ConfigPricing {
  const iva = fiscal.iva_alicuota_general / 100
  return {
    iva,
    iibb: fiscal.iibb_alicuota / 100,
    debcred: fiscal.impuesto_deb_cred_alicuota / 100,
    tasaMp: derivarTasaMpPeorCaso(medios, iva),
    redondeoMultiplo: fiscal.redondeo_multiplo,
  }
}
