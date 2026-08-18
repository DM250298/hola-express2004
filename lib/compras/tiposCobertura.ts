// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Tipos del motor de cobertura de compras                               ║
// ║                                                                        ║
// ║  Compartidos entre el motor puro (cobertura.ts), las queries que       ║
// ║  llaman a fn_sugerencias_compra y la UI del Centro de Compras.         ║
// ╚══════════════════════════════════════════════════════════════════════╝

/**
 * Estado visual de una fila de sugerencia:
 *  · rojo    → necesita compra / riesgo de quiebre
 *  · naranja → cerca del punto de reposición
 *  · verde   → cobertura suficiente
 *  · gris    → sin ventas recientes (no se calcula automáticamente)
 * El sobrestock es un flag aparte (un producto verde puede estar pasado).
 */
export type EstadoCobertura = 'rojo' | 'naranja' | 'verde' | 'gris'

/** Parámetros efectivos de reposición (proveedor con fallback a config global). */
export interface ParametrosReposicion {
  /** Días de venta que se busca dejar cubiertos al reponer. */
  diasCoberturaObjetivo: number
  /** Colchón en días para el punto de reposición. */
  diasSeguridad: number
  /** Cada cuántos días se le pide habitualmente al proveedor. */
  frecuenciaReposicionDias: number
  /** Umbral fijo de sobrestock en días. null/undefined = 2 × cobertura objetivo. */
  umbralSobrestockDias?: number | null
}

/** Datos de un producto que entran al cálculo de cobertura. */
export interface InputCobertura {
  stockActual: number
  /** Unidades físicas vendidas en los últimos 30 días (kg si es por peso). */
  venta30d: number
  /** Pedido a proveedores y todavía no recibido (neto de parciales). */
  stockEnTransito: number
  ventaPorPeso: boolean
  /** Producto que no puede faltar: sugiere aun sin ventas (piso stock_minimo). */
  esCritico?: boolean
  /** Alta reciente (< 30 días): todavía sin historial confiable. */
  productoNuevo?: boolean
  /** Piso manual para críticos/nuevos sin ventas. */
  stockMinimo?: number
  /** Unidades por bulto del proveedor (caja x6 = 6). null = suelto. */
  multiploCompra?: number | null
}

/** Resultado del redondeo por presentación de compra. */
export interface RedondeoPresentacion {
  /** Cantidad final en unidades (o kg), ya redondeada. */
  cantidadFinal: number
  /** Cantidad de bultos si hay múltiplo (2 cajas); null si se compra suelto. */
  paquetes: number | null
}

/** Resultado completo del cálculo de cobertura para un producto. */
export interface ResultadoCobertura {
  ventaDiaria: number
  /** null = sin ventas recientes (no dividir por cero). */
  diasStock: number | null
  puntoReposicion: number
  stockObjetivo: number
  /** stock_actual + stock_en_transito. */
  disponible: number
  requiereCompra: boolean
  cantidadSugerida: number
  cantidadSugeridaRedondeada: number
  paquetes: number | null
  estado: EstadoCobertura
  esSobrestock: boolean
}
