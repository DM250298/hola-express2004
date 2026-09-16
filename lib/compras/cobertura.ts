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

/** Tope por defecto de la corrección por quiebres (config_compras, mig 195). */
export const FACTOR_MAXIMO_QUIEBRE_DEFAULT = 3

/**
 * Días de la ventana en que el producto REALMENTE se pudo vender: 30 menos
 * los que estuvo sin stock, con piso para no multiplicar al infinito la
 * velocidad de algo que estuvo quebrado casi todo el mes.
 * Espejo de la mig 196.
 */
export function diasConStock(
  diasSinStock: number | null | undefined,
  factorMaximo?: number | null
): number {
  const tope = Math.max(factorMaximo ?? FACTOR_MAXIMO_QUIEBRE_DEFAULT, 1)
  const sin = Math.min(Math.max(diasSinStock ?? 0, 0), DIAS_VENTANA_VENTAS)
  return Math.max(DIAS_VENTANA_VENTAS - sin, DIAS_VENTANA_VENTAS / tope)
}

/**
 * Venta diaria corregida por quiebres: lo vendido dividido por los días en
 * que hubo stock. Un producto que vendió 30 unidades en 18 días vende 1,7
 * por día, no 1: comprarle por 1 es garantizar que se vuelva a quebrar.
 */
export function calcularVentaDiariaCorregida(
  venta30d: number,
  diasSinStock: number | null | undefined,
  factorMaximo?: number | null
): number {
  return redondear3(Math.max(venta30d, 0) / diasConStock(diasSinStock, factorMaximo))
}

/** Cuánto se multiplicó la velocidad por los días sin stock (1 = nada). */
export function calcularFactorQuiebre(
  diasSinStock: number | null | undefined,
  factorMaximo?: number | null
): number {
  return (
    Math.round((DIAS_VENTANA_VENTAS / diasConStock(diasSinStock, factorMaximo)) * 100) / 100
  )
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

// ─── Calendario del proveedor (espejo de fn_dias_hasta_entrega, mig 152) ──

/**
 * Días hasta la próxima entrega posible según el calendario semanal del
 * proveedor (0 = domingo … 6 = sábado, convención de Date.getDay() y de
 * extract(dow) en Postgres). Busca el primer día de toma de pedido desde
 * `desde` (inclusive) y después la primera entrega ESTRICTAMENTE posterior.
 * null si el calendario no está cargado — el llamador cae a la frecuencia
 * fija, igual que el SQL.
 */
export function calcularDiasHastaEntrega(
  diasToma: readonly number[] | null | undefined,
  diasEntrega: readonly number[] | null | undefined,
  desde: Date
): number | null {
  if (!diasToma || diasToma.length === 0) return null
  if (!diasEntrega || diasEntrega.length === 0) return null
  const dowDesde = desde.getDay()
  let offsetPedido = -1
  for (let o = 0; o <= 6; o++) {
    if (diasToma.includes((dowDesde + o) % 7)) {
      offsetPedido = o
      break
    }
  }
  if (offsetPedido < 0) return null
  for (let e = offsetPedido + 1; e <= offsetPedido + 7; e++) {
    if (diasEntrega.includes((dowDesde + e) % 7)) return e
  }
  return null
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
  const ventaDiariaBase = calcularVentaDiaria(input.venta30d)
  // v3 (mig 196): la velocidad se mide sobre los días en que hubo stock.
  const ventaDiaria = calcularVentaDiariaCorregida(
    input.venta30d,
    input.diasSinStock30d,
    params.factorMaximoCorreccionQuiebre
  )
  const factorQuiebre = calcularFactorQuiebre(
    input.diasSinStock30d,
    params.factorMaximoCorreccionQuiebre
  )
  const diasStock = calcularDiasStock(input.stockActual, ventaDiaria)
  const puntoReposicion = calcularPuntoReposicion(
    ventaDiaria,
    params.frecuenciaReposicionDias,
    params.diasSeguridad
  )
  // El objetivo nunca queda debajo del punto: con una config incoherente
  // (cobertura < frecuencia + seguridad) la fila diría "requiere compra"
  // con sugerido 0. Mismo clamp que fn_sugerencias_compra (mig 151).
  // El piso manual de exhibición (mig 195) también levanta el objetivo.
  const objetivoManual = input.stockObjetivoManual ?? 0
  const stockObjetivo = Math.max(
    calcularStockObjetivo(ventaDiaria, params.diasCoberturaObjetivo),
    puntoReposicion,
    objetivoManual
  )
  const disponible = input.stockActual + input.stockEnTransito

  const stockMinimo = input.stockMinimo ?? 0
  const requiereCompra =
    ventaDiaria > 0
      ? disponible <= puntoReposicion + TOLERANCIA
      : objetivoManual > 0
        ? disponible < objetivoManual - TOLERANCIA
        : (input.esCritico === true || input.productoNuevo === true) &&
          stockMinimo > 0 &&
          disponible < stockMinimo - TOLERANCIA

  const cantidadSugerida = !requiereCompra
    ? 0
    : ventaDiaria > 0
      ? redondear3(Math.max(stockObjetivo - disponible, 0))
      : redondear3(Math.max(Math.max(stockMinimo, objetivoManual) - disponible, 0))

  const { cantidadFinal, paquetes } = redondearPorPresentacion(
    cantidadSugerida,
    input.multiploCompra,
    input.ventaPorPeso
  )

  return {
    ventaDiaria,
    ventaDiariaBase,
    factorQuiebre,
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
