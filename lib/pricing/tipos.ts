// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Motor de precios con margen asegurado — tipos                         ║
// ║                                                                        ║
// ║  Fuente de verdad de la lógica: ESPECIFICACION-PRICING.md (raíz del    ║
// ║  repo). El precio de venta se calcula DIVIDIENDO por (1 − cargas),     ║
// ║  no sumando porcentajes al costo: los impuestos y la comisión de MP    ║
// ║  se calculan sobre el precio final, así que muerden el precio ya       ║
// ║  inflado. Regla: lo que se calcula sobre el costo multiplica; lo que   ║
// ║  se calcula sobre el precio, divide.                                   ║
// ║                                                                        ║
// ║  IMPORTANTE: ninguna alícuota ni tasa vive en el código. Todo entra    ║
// ║  por `ConfigPricing`, que se arma desde la config editable (ver        ║
// ║  lib/pricing/config.ts: config_fiscal + medios_pago).                  ║
// ╚══════════════════════════════════════════════════════════════════════╝

/** Régimen fiscal del comercio. Determina qué fórmula del divisor se usa. */
export type RegimenFiscal = 'responsable_inscripto' | 'monotributista'

/**
 * Parámetros de cálculo. Todos en FRACCIÓN (0.21 = 21%), salvo el múltiplo
 * de redondeo que es un monto en pesos. Ninguno está hardcodeado en el motor.
 */
export interface ConfigPricing {
  /** IVA general, fracción. Default de negocio 0.21. Neutro para el RI. */
  iva: number
  /** Ingresos Brutos, fracción. Se calcula sobre el TOTAL cobrado. */
  iibb: number
  /** Impuesto a los créditos y débitos, fracción. Completo (entrada+salida). */
  debcred: number
  /**
   * Tasa de comisión de Mercado Pago SIN IVA, fracción, peor caso ya
   * seleccionado (ver seleccionarPeorTasa). El motor le agrega el IVA:
   * comisión efectiva = tasaMp × (1 + iva).
   */
  tasaMp: number
  /** Múltiplo del redondeo comercial, en pesos (ej: 50). Siempre techo. */
  redondeoMultiplo: number
}

/** Datos del producto para calcular su precio. */
export interface InputPrecio {
  regimen: RegimenFiscal
  /**
   * Costo del producto. Para RI: costo SIN IVA (base imponible, con crédito
   * fiscal). Para Monotributista: costo CON IVA (el IVA es costo real, no lo
   * recupera).
   */
  costo: number
  /** Margen de ganancia como fracción sobre el costo (0.40 = 40%). */
  margen: number
}

/**
 * Desglose verificable de un precio. Expone cada componente en pesos, el
 * precio exacto pre-redondeo y el margen extra que aporta el redondeo, para
 * auditoría y para el test del invariante (la ganancia debe reconstruirse).
 */
export interface DesglosePrecio {
  regimen: RegimenFiscal
  costo: number
  /** Ganancia objetivo = costo × margen. */
  ganancia: number

  /** Tasa efectiva de MP usada = tasaMp × (1 + iva). */
  comisionEfectiva: number
  /** 1 − cargas. Si es ≤ 0, el cálculo se rechaza (no se llega acá). */
  divisor: number

  /** Precio neto (sin IVA) exacto, sin redondear. */
  precioNetoExacto: number
  /** Precio final (con IVA, lo que paga el cliente) exacto, sin redondear. */
  precioFinalExacto: number
  /** Precio final llevado al múltiplo de redondeo, SIEMPRE hacia arriba. */
  precioRedondeado: number

  /** IIBB en pesos (sobre el precio final exacto). */
  iibbMonto: number
  /** Impuesto créd/déb en pesos (sobre el precio final exacto). */
  debcredMonto: number
  /** Comisión MP en pesos, con IVA (sobre el precio final exacto). */
  comisionMonto: number

  /**
   * Ganancia reconstruida desde el desglose sobre el precio exacto. Debe
   * igualar a `ganancia` con tolerancia de centavos (invariante).
   */
  gananciaReal: number
  /**
   * Ganancia extra que aporta el redondeo hacia arriba (ganancia al precio
   * redondeado − ganancia objetivo). Siempre ≥ 0 porque el redondeo sube.
   */
  margenExtraRedondeo: number
}
