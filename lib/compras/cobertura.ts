// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Motor de cobertura de compras — cálculo                               ║
// ║                                                                        ║
// ║  Espejo TS de fn_sugerencias_compra (migración 151). Funciones puras,  ║
// ║  sin dependencias: la fuente de verdad del batch es el SQL; este       ║
// ║  módulo recalcula en vivo cuando Fernanda edita cantidades, hace la    ║
// ║  lógica explicable y es donde viven los umbrales visuales              ║
// ║  (rojo/naranja/verde/gris/sobrestock) para tunearlos sin migración.    ║
// ║                                                                        ║
// ║  Si se cambia una fórmula acá, cambiarla TAMBIÉN en la función SQL     ║
// ║  (y viceversa). Los tests de cobertura.test.ts cubren ambos sentidos   ║
// ║  con los mismos escenarios que supabase/tests/test_cobertura_compras.  ║
// ╚══════════════════════════════════════════════════════════════════════╝

import type {
  EstadoCobertura,
  InputCobertura,
  ParametrosReposicion,
  RedondeoPresentacion,
  ResultadoCobertura,
} from './tiposCobertura'

// ─── Constantes de negocio (tunear acá, no en SQL) ────────────────────────

/** Ventana de la venta promedio, en días. Debe coincidir con la migración 151. */
export const DIAS_VENTANA_VENTAS = 30

/**
 * Naranja = "cerca del punto": disponible proyectado a menos de 25% por
 * encima del punto de reposición.
 */
export const FACTOR_NARANJA = 1.25

/**
 * Sobrestock dinámico: más de 2× la cobertura objetivo en días de stock
 * (config_compras.umbral_sobrestock_dias lo pisa con un valor fijo).
 */
export const FACTOR_SOBRESTOCK = 2

/**
 * Ajuste "fuerte" (pide motivo opcional): la cantidad final es al menos el
 * doble o como mucho la mitad de la sugerida.
 */
export const FACTOR_AJUSTE_FUERTE = 2

/**
 * Tolerancia de comparación para cantidades fraccionadas (misma que
 * cantidadesIguales en lib/utils/formato.ts): restar kilos arrastra error
 * de float y una comparación exacta inventa diferencias que no existen.
 */
const TOLERANCIA = 0.0005

// ─── Redondeos internos (espejan los round(x, n) del SQL) ─────────────────

function redondear3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function redondear1(n: number): number {
  return Math.round(n * 10) / 10
}

/**
 * Techo con guarda de ruido float: 12.000000001 no debe saltar a 13
 * (mismo criterio que redondearComercial en lib/pricing/motor.ts).
 */
function techoConTolerancia(n: number): number {
  return Math.abs(n - Math.round(n)) < 1e-9 ? Math.round(n) : Math.ceil(n)
}

// ─── Fórmulas ─────────────────────────────────────────────────────────────

/** Venta promedio diaria: unidades físicas de los últimos 30 días / 30. */
export function calcularVentaDiaria(venta30d: number): number {
  return redondear3(Math.max(venta30d, 0) / DIAS_VENTANA_VENTAS)
}

/**
 * Días de cobertura actual. null si no hay ventas recientes: NUNCA se divide
 * por cero, y la UI muestra "Sin ventas recientes".
 */
export function calcularDiasStock(
  stockActual: number,
  ventaDiaria: number
): number | null {
  if (ventaDiaria <= 0) return null
  return redondear1(stockActual / ventaDiaria)
}

/** Punto de reposición: demanda esperada hasta la próxima reposición + colchón. */
export function calcularPuntoReposicion(
  ventaDiaria: number,
  frecuenciaReposicionDias: number,
  diasSeguridad: number
): number {
  return redondear3(ventaDiaria * (frecuenciaReposicionDias + diasSeguridad))
}

/** Stock objetivo: hasta dónde reponer (cobertura objetivo en días de venta). */
export function calcularStockObjetivo(
  ventaDiaria: number,
  diasCoberturaObjetivo: number
): number {
  return redondear3(ventaDiaria * diasCoberturaObjetivo)
}

/**
 * Redondeo por presentación de compra: SIEMPRE hacia arriba al múltiplo del
 * proveedor (necesidad 10, caja x6 → 2 cajas = 12 u). Sin múltiplo: 3
 * decimales si es por peso, techo entero si es por unidad.
 */
export function redondearPorPresentacion(
  cantidad: number,
  multiploCompra: number | null | undefined,
  ventaPorPeso: boolean
): RedondeoPresentacion {
  const tieneMultiplo = multiploCompra != null && multiploCompra > 0
  if (cantidad <= TOLERANCIA) {
    return { cantidadFinal: 0, paquetes: tieneMultiplo ? 0 : null }
  }
  if (tieneMultiplo) {
    const paquetes = techoConTolerancia(cantidad / multiploCompra)
    return { cantidadFinal: redondear3(paquetes * multiploCompra), paquetes }
  }
  if (ventaPorPeso) {
    return { cantidadFinal: redondear3(cantidad), paquetes: null }
  }
  return { cantidadFinal: techoConTolerancia(cantidad), paquetes: null }
}

/**
 * ¿La cantidad final se aparta tanto de la sugerida como para pedir un
 * motivo (opcional)? Doble o más, mitad o menos — incluye pedir algo cuando
 * la sugerencia era 0.
 */
export function esAjusteFuerte(
  cantidadSugerida: number,
  cantidadFinal: number
): boolean {
  if (Math.abs(cantidadFinal - cantidadSugerida) < TOLERANCIA) return false
  if (cantidadSugerida <= TOLERANCIA) return cantidadFinal > TOLERANCIA
  const razon = cantidadFinal / cantidadSugerida
  return razon >= FACTOR_AJUSTE_FUERTE || razon <= 1 / FACTOR_AJUSTE_FUERTE
}

// ─── Estados visuales ─────────────────────────────────────────────────────

interface InputEstado {
  ventaDiaria: number
  stockActual: number
  disponible: number
  puntoReposicion: number
  requiereCompra: boolean
}

/** Clasifica la fila en rojo / naranja / verde / gris (ver EstadoCobertura). */
export function clasificarEstado(input: InputEstado): EstadoCobertura {
  if (input.requiereCompra) return 'rojo'
  if (input.ventaDiaria <= 0) return 'gris'
  if (input.stockActual <= 0) return 'rojo'
  if (input.disponible <= input.puntoReposicion * FACTOR_NARANJA + TOLERANCIA) {
    return 'naranja'
  }
  return 'verde'
}

/** Sobrestock: días de cobertura por encima del umbral (fijo o 2× objetivo). */
export function esSobrestock(
  diasStock: number | null,
  diasCoberturaObjetivo: number,
  umbralSobrestockDias?: number | null
): boolean {
  if (diasStock == null) return false
  const umbral =
    umbralSobrestockDias != null && umbralSobrestockDias > 0
      ? umbralSobrestockDias
      : diasCoberturaObjetivo * FACTOR_SOBRESTOCK
  return diasStock > umbral + TOLERANCIA
}

// ─── Tránsito (espejo del CTE de la migración 151) ────────────────────────

/** Estados de OC que cuentan como mercadería en camino. */
export const ESTADOS_EN_TRANSITO = ['enviado', 'recepcion_parcial'] as const

/** ¿Una orden en este estado suma a stock_en_transito? */
export function cuentaComoTransito(estado: string): boolean {
  return (ESTADOS_EN_TRANSITO as readonly string[]).includes(estado)
}

/**
 * Pendiente de recibir de un renglón: lo pedido menos lo ya recibido,
 * nunca negativo (una sobre-recepción no genera tránsito negativo).
 */
export function transitoNetoRenglon(
  cantidadPedida: number,
  cantidadRecibida: number | null | undefined
): number {
  return Math.max(cantidadPedida - (cantidadRecibida ?? 0), 0)
}

// ─── Pipeline completo ────────────────────────────────────────────────────

/**
 * Cálculo completo de cobertura para un producto. Es la misma matemática de
 * fn_sugerencias_compra, para recomputar en vivo en la UI y para los tests.
 */
export function calcularCobertura(
  input: InputCobertura,
  params: ParametrosReposicion
): ResultadoCobertura {
  const ventaDiaria = calcularVentaDiaria(input.venta30d)
  const diasStock = calcularDiasStock(input.stockActual, ventaDiaria)
  const puntoReposicion = calcularPuntoReposicion(
    ventaDiaria,
    params.frecuenciaReposicionDias,
    params.diasSeguridad
  )
  // El objetivo nunca queda debajo del punto: con una config incoherente
  // (cobertura < frecuencia + seguridad) la fila diría "requiere compra"
  // con sugerido 0. Mismo clamp que fn_sugerencias_compra (mig 151).
  const stockObjetivo = Math.max(
    calcularStockObjetivo(ventaDiaria, params.diasCoberturaObjetivo),
    puntoReposicion
  )
  const disponible = input.stockActual + input.stockEnTransito

  const stockMinimo = input.stockMinimo ?? 0
  const requiereCompra =
    ventaDiaria > 0
      ? disponible <= puntoReposicion + TOLERANCIA
      : (input.esCritico === true || input.productoNuevo === true) &&
        stockMinimo > 0 &&
        disponible < stockMinimo - TOLERANCIA

  const cantidadSugerida = !requiereCompra
    ? 0
    : ventaDiaria > 0
      ? redondear3(Math.max(stockObjetivo - disponible, 0))
      : redondear3(Math.max(stockMinimo - disponible, 0))

  const { cantidadFinal, paquetes } = redondearPorPresentacion(
    cantidadSugerida,
    input.multiploCompra,
    input.ventaPorPeso
  )

  return {
    ventaDiaria,
    diasStock,
    puntoReposicion,
    stockObjetivo,
    disponible,
    requiereCompra,
    cantidadSugerida,
    cantidadSugeridaRedondeada: cantidadFinal,
    paquetes,
    estado: clasificarEstado({
      ventaDiaria,
      stockActual: input.stockActual,
      disponible,
      puntoReposicion,
      requiereCompra,
    }),
    esSobrestock: esSobrestock(
      diasStock,
      params.diasCoberturaObjetivo,
      params.umbralSobrestockDias
    ),
  }
}
