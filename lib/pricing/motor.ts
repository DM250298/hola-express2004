// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Motor de precios con margen asegurado — cálculo                       ║
// ║                                                                        ║
// ║  Ver ESPECIFICACION-PRICING.md. Funciones puras, sin dependencias:     ║
// ║  reciben la config y devuelven el desglose completo. La config sale    ║
// ║  de lib/pricing/config.ts (config_fiscal + medios_pago); acá no hay    ║
// ║  ni una alícuota escrita a mano.                                       ║
// ╚══════════════════════════════════════════════════════════════════════╝

import type {
  ConfigPricing,
  DesglosePrecio,
  InputPrecio,
  RegimenFiscal,
} from './tipos'

/** Error de dominio del motor (divisor inválido, tasas vacías, etc.). */
export class ErrorPricing extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorPricing'
  }
}

/**
 * Selecciona la PEOR tasa (la más alta) entre las configuradas. Con un único
 * precio por producto, pricear por el peor caso asegura la ganancia en el
 * escenario más caro (hoy: crédito con acreditación inmediata) y deja margen
 * extra en los medios más baratos. Si mañana MP sube una tasa y se actualiza
 * la config, el peor caso se recalcula solo.
 */
export function seleccionarPeorTasa(tasas: readonly number[]): number {
  const validas = tasas.filter((t) => Number.isFinite(t) && t >= 0)
  if (validas.length === 0) {
    throw new ErrorPricing(
      'No hay tasas de Mercado Pago configuradas para elegir el peor caso.'
    )
  }
  return Math.max(...validas)
}

/**
 * Redondeo comercial: lleva el precio al múltiplo indicado SIEMPRE hacia
 * arriba (techo). Nunca hacia abajo ni al más cercano — eso erosionaría el
 * margen garantizado. Si ya es múltiplo exacto, se mantiene.
 *
 * Ej: 19764.58, 50 → 19800 · 17950.00, 50 → 17950 · 17950.01, 50 → 18000
 */
export function redondearComercial(precio: number, multiplo: number): number {
  if (!(multiplo > 0)) {
    throw new ErrorPricing(
      `El múltiplo de redondeo debe ser mayor a 0 (recibido: ${multiplo}).`
    )
  }
  // Corrige el ruido de punto flotante para no subir un múltiplo de más cuando
  // el precio ya es (casi) exacto: 17950.0000000001 no debe saltar a 18000.
  const cocientes = precio / multiplo
  const cociente = Math.abs(cocientes - Math.round(cocientes)) < 1e-9
    ? Math.round(cocientes)
    : Math.ceil(cocientes)
  return cociente * multiplo
}

/** Comisión efectiva de MP = tasa publicada × (1 + IVA). El IVA sale de la config. */
function comisionEfectiva(config: ConfigPricing): number {
  return config.tasaMp * (1 + config.iva)
}

/**
 * Divisor de la fórmula según régimen. Es 1 menos la suma de las cargas que
 * se llevan una porción del PRECIO. Para el RI las tres cargas están sobre el
 * total, así que se convierten a base neta multiplicando por (1 + IVA); el
 * IVA de la venta no entra porque el RI es intermediario (lo cobra y lo
 * remite, es neutro). Para el Monotributista todo se calcula sobre el precio
 * final directo.
 */
function calcularDivisor(
  regimen: RegimenFiscal,
  config: ConfigPricing
): number {
  const cargas = config.iibb + config.debcred + comisionEfectiva(config)
  return regimen === 'responsable_inscripto'
    ? 1 - cargas * (1 + config.iva)
    : 1 - cargas
}

/**
 * Ganancia real a un precio final dado, reconstruida restando costo y cada
 * carga. Unifica ambos regímenes: la ganancia vive en la base neta para el
 * RI (que remite el IVA) y en el precio final para el Monotributista.
 */
function gananciaAlPrecioFinal(
  precioFinal: number,
  input: InputPrecio,
  config: ConfigPricing
): number {
  const base =
    input.regimen === 'responsable_inscripto'
      ? precioFinal / (1 + config.iva)
      : precioFinal
  const cargas = config.iibb + config.debcred + comisionEfectiva(config)
  return base - input.costo - precioFinal * cargas
}

/**
 * Calcula el precio de venta que asegura la ganancia objetivo después de todas
 * las cargas, y devuelve el desglose completo para auditoría.
 *
 * @throws {ErrorPricing} si el divisor es ≤ 0 (las cargas superan el 100% del
 *   precio): nunca devuelve un precio negativo o infinito.
 */
export function calcularPrecio(
  input: InputPrecio,
  config: ConfigPricing
): DesglosePrecio {
  if (!(input.costo >= 0)) {
    throw new ErrorPricing(`El costo debe ser ≥ 0 (recibido: ${input.costo}).`)
  }

  const comEf = comisionEfectiva(config)
  const ganancia = input.costo * input.margen
  const divisor = calcularDivisor(input.regimen, config)

  if (divisor <= 0) {
    throw new ErrorPricing(
      `Divisor inválido (${divisor.toFixed(6)}): las cargas ` +
        `(IIBB ${pct(config.iibb)}, créd/déb ${pct(config.debcred)}, ` +
        `comisión ${pct(comEf)}) superan el 100% del precio. ` +
        `No hay precio que asegure la ganancia; revisá las tasas.`
    )
  }

  let precioNetoExacto: number
  let precioFinalExacto: number
  if (input.regimen === 'responsable_inscripto') {
    precioNetoExacto = (input.costo + ganancia) / divisor
    precioFinalExacto = precioNetoExacto * (1 + config.iva)
  } else {
    precioFinalExacto = (input.costo + ganancia) / divisor
    precioNetoExacto = precioFinalExacto / (1 + config.iva)
  }

  const precioRedondeado = redondearComercial(
    precioFinalExacto,
    config.redondeoMultiplo
  )

  return {
    regimen: input.regimen,
    costo: input.costo,
    ganancia,
    comisionEfectiva: comEf,
    divisor,
    precioNetoExacto,
    precioFinalExacto,
    precioRedondeado,
    iibbMonto: precioFinalExacto * config.iibb,
    debcredMonto: precioFinalExacto * config.debcred,
    comisionMonto: precioFinalExacto * comEf,
    gananciaReal: gananciaAlPrecioFinal(precioFinalExacto, input, config),
    margenExtraRedondeo:
      gananciaAlPrecioFinal(precioRedondeado, input, config) - ganancia,
  }
}

/** Desglose de las retenciones reales de MP sobre un total cobrado. */
export interface DesgloseTransaccionMP {
  total: number
  debcredMonto: number
  iibbMonto: number
  comisionMonto: number
  netoRecibido: number
}

/**
 * Reproduce los descuentos que MP aplica sobre una transacción REAL, dado el
 * total cobrado. A diferencia del pricing (que usa el 1.2% completo del imp.
 * créd/déb para cubrir entrada + salida), la liquidación de MP solo retiene la
 * pata de ENTRADA (0.6%) al acreditar; por eso `debcredEntrada` es un
 * parámetro aparte. Usado en el test de regresión contra caja real (Test 7).
 */
export function desglosarTransaccionMP(
  total: number,
  params: {
    iibb: number
    debcredEntrada: number
    tasaMp: number
    iva: number
  }
): DesgloseTransaccionMP {
  const debcredMonto = total * params.debcredEntrada
  const iibbMonto = total * params.iibb
  const comisionMonto = total * params.tasaMp * (1 + params.iva)
  return {
    total,
    debcredMonto,
    iibbMonto,
    comisionMonto,
    netoRecibido: total - debcredMonto - iibbMonto - comisionMonto,
  }
}

/** Formatea una fracción como porcentaje legible para los mensajes de error. */
function pct(fraccion: number): string {
  return `${(fraccion * 100).toFixed(4).replace(/\.?0+$/, '')}%`
}
