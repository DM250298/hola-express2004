// Parsers tolerantes para datos exportados de hojas de cálculo en formato AR.
// El export de "Productos - Hola! Express" usa: precios "$ 1.234,56", stock
// "12 Unid." (con sufijo) o "PC" para productos compuestos.

const RE_NUMERO = /-?\d+([.,]\d+)?/

/**
 * Convierte "$ 1.234,56" → 1234.56. También acepta:
 * - números nativos (xlsx puede devolverlos directo)
 * - "1234.56" o "1,234.56" (formato US)
 * - vacío, null, "-" → 0
 */
export function parsearPrecio(valor: unknown): number {
  if (valor === null || valor === undefined || valor === '') return 0
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0

  const limpio = String(valor)
    .replace(/[$\s]/g, '')
    .replace(/^-$/, '0')

  // Si tiene coma decimal AR ("1.234,56") quitar puntos de miles y cambiar coma por punto
  if (limpio.includes(',') && limpio.lastIndexOf(',') > limpio.lastIndexOf('.')) {
    const sinMiles = limpio.replace(/\./g, '').replace(',', '.')
    const n = Number(sinMiles)
    return Number.isFinite(n) ? n : 0
  }

  // Si solo punto, asumir decimal US ("1234.56")
  const n = Number(limpio.replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * Convierte "12 Unid." → 12, "-4 Unid." → -4, "PC" → 0, "-" → 0.
 * Si no parsea, devuelve 0.
 */
export function parsearStock(valor: unknown): number {
  if (valor === null || valor === undefined || valor === '') return 0
  if (typeof valor === 'number') return Math.trunc(valor)

  const str = String(valor).trim()
  if (str === '-' || /^PC$/i.test(str)) return 0

  const match = str.match(RE_NUMERO)
  if (!match) return 0
  return Math.trunc(parsearPrecio(match[0]))
}

/**
 * Normaliza el código de barras: xlsx puede devolverlo como number (EAN-13)
 * o string. Limpiamos espacios y convertimos a string preservando precisión.
 */
export function parsearCodigoBarras(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === '') return null
  if (typeof valor === 'number') return String(Math.trunc(valor))
  const s = String(valor).trim()
  if (!s || s === '-') return null
  return s
}

/** "Galletas " → "Galletas" · null/-"-" → null */
export function parsearTextoOpcional(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null
  const s = String(valor).trim()
  if (!s || s === '-') return null
  return s
}

/**
 * Interpreta un valor como booleano tolerante al castellano y a planillas:
 * "sí", "si", "x", "true", "verdadero", "1", "kg" → true.
 * vacío, "no", "false", "0", "-" → false.
 */
export function parsearBooleano(valor: unknown): boolean {
  if (valor === null || valor === undefined || valor === '') return false
  if (typeof valor === 'boolean') return valor
  if (typeof valor === 'number') return valor !== 0
  const s = String(valor).trim().toLowerCase()
  return ['sí', 'si', 'x', 'true', 'verdadero', '1', 'kg', 'peso'].includes(s)
}

/** Entero opcional ≥ 0 ("20 días" → 20, vacío/"-" → null). */
export function parsearEnteroOpcional(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null
  if (typeof valor === 'number') {
    return Number.isFinite(valor) ? Math.max(0, Math.trunc(valor)) : null
  }
  const s = String(valor).trim()
  if (!s || s === '-') return null
  const match = s.match(RE_NUMERO)
  if (!match) return null
  return Math.max(0, Math.trunc(parsearPrecio(match[0])))
}

/**
 * Normaliza una alícuota de IVA a porcentaje.
 * - Fracción ≤ 1 ("0.21", "0,21") → 21
 * - Porcentaje ("21", "21%") → 21
 * - vacío / inválido → 21 (default RI)
 */
export function parsearIva(valor: unknown): number {
  if (valor === null || valor === undefined || valor === '') return 21
  const n = parsearPrecio(valor)
  if (!Number.isFinite(n) || n <= 0) return 21
  return n <= 1 ? Math.round(n * 100) : Math.round(n)
}

/**
 * Normaliza un documento (CUIT/DNI): deja solo dígitos.
 * "20-12.345.678-9" → "20123456789". vacío/"-" → null.
 */
export function parsearDocumento(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === '') return null
  if (typeof valor === 'number') return String(Math.trunc(valor))
  const soloDigitos = String(valor).replace(/\D/g, '')
  return soloDigitos.length > 0 ? soloDigitos : null
}

/**
 * Convierte una fecha de planilla a ISO "yyyy-MM-dd".
 * Acepta Date (cellDates de SheetJS), "dd/mm/aaaa", "aaaa-mm-dd". vacío → null.
 */
export function parsearFecha(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === '') return null
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return valor.toISOString().slice(0, 10)
  }
  const s = String(valor).trim()
  if (!s || s === '-') return null
  // dd/mm/aaaa o dd-mm-aaaa
  const m = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/)
  if (m) {
    const [, d, mes, a] = m
    const anio = a.length === 2 ? `20${a}` : a
    return `${anio}-${mes.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  // aaaa-mm-dd ya viene bien
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return null
}

// ─── Tipos del flujo de importación ─────────────────────────────────

export interface FilaExcel {
  fila_origen: number // número de fila en el Excel (para reportar errores)
  producto: string
  precio_costo: number
  precio_venta: number
  stock_actual: number
  stock_minimo: number
  tipo: string | null
  unidad: string | null
  categoria: string | null
  codigo_barras: string | null
  proveedor: string | null
  venta_por_peso: boolean
  dias_vencimiento_minimo: number | null
}

/** Stock mínimo por defecto cuando la columna está ausente o vacía. */
export const STOCK_MINIMO_DEFAULT = 5

export interface FilaProcesada extends FilaExcel {
  errores: string[]
  saltada: boolean // reservado para futuras reglas; los combos ya se importan
}

// El orden importa: detectarColumnas evalúa campo por campo y findIndex toma
// el PRIMER header que matchee. Para evitar que "Stock mínimo" caiga en
// stock_actual o "Venta por peso" en precio_venta, los patrones son
// específicos y en la plantilla "Precio venta" siempre va antes que el resto.
const HEADERS_ESPERADOS: Record<keyof Omit<FilaExcel, 'fila_origen'>, RegExp[]> = {
  producto: [/^producto/i, /^nombre/i],
  precio_costo: [/precio.*costo/i, /^costo/i],
  precio_venta: [/precio.*venta/i, /^venta$/i, /^precio$/i],
  stock_actual: [/stock.*actual/i, /^stock$/i, /existencia/i],
  stock_minimo: [/stock.*m[ií]nimo/i, /stock.*min/i, /^m[ií]nimo$/i],
  tipo: [/tipo.*producto/i, /^tipo$/i],
  unidad: [/^unidad$/i, /^unidades$/i, /medida/i],
  categoria: [/categor[ií]a/i],
  codigo_barras: [/^c[oó]digo$/i, /c[oó]digo.*barras/i, /barcode/i],
  proveedor: [/proveedor/i, /c[oó]digo.*secundario/i],
  venta_por_peso: [/venta.*peso/i, /por.*peso/i, /pesable/i, /vende.*peso/i],
  dias_vencimiento_minimo: [
    /vencimiento.*m[ií]nimo/i,
    /venc.*min/i,
    /d[ií]as.*vencimiento/i,
  ],
}

/**
 * Encuentra el índice de cada columna en la fila de encabezados.
 * Tolera variaciones de mayúsculas, espacios, acentos y nombres alternativos.
 * Devuelve null si falta una columna requerida (producto, precio_venta).
 */
export function detectarColumnas(
  headers: unknown[]
): Record<keyof Omit<FilaExcel, 'fila_origen'>, number> | null {
  const limpios = headers.map((h) =>
    String(h ?? '')
      .replace(/ /g, ' ')
      .trim()
  )

  const mapeo = {} as Record<keyof Omit<FilaExcel, 'fila_origen'>, number>
  for (const [campo, patrones] of Object.entries(HEADERS_ESPERADOS) as Array<
    [keyof typeof HEADERS_ESPERADOS, RegExp[]]
  >) {
    const idx = limpios.findIndex((h) => patrones.some((re) => re.test(h)))
    mapeo[campo] = idx
  }

  // Requeridos para considerar válido el header
  if (mapeo.producto === -1 || mapeo.precio_venta === -1) return null
  return mapeo
}

function normalizarTipo(t: string | null): string | null {
  if (!t) return null
  const lower = t.toLowerCase().trim()
  if (/combo/.test(lower)) return 'combo'
  if (/variante|variant/.test(lower)) return 'variante'
  return 'simple'
}

function normalizarUnidad(u: string | null): string | null {
  if (!u) return null
  return u.toLowerCase().trim()
}

export function procesarFilas(
  filas: unknown[][],
  mapeo: Record<keyof Omit<FilaExcel, 'fila_origen'>, number>,
  filaInicio: number
): FilaProcesada[] {
  const resultado: FilaProcesada[] = []
  filas.forEach((fila, i) => {
    const filaOrigen = filaInicio + i
    const producto = parsearTextoOpcional(fila[mapeo.producto])
    if (!producto) return // fila vacía → se ignora silenciosamente

    const errores: string[] = []
    const precio_venta = parsearPrecio(fila[mapeo.precio_venta])
    const precio_costo = parsearPrecio(fila[mapeo.precio_costo])
    const stock_actual = parsearStock(fila[mapeo.stock_actual])

    // Stock mínimo: si la columna falta o la celda está vacía, usar el default.
    // Un 0 explícito sí se respeta (producto que no se repone).
    const rawMin = mapeo.stock_minimo >= 0 ? fila[mapeo.stock_minimo] : undefined
    const stock_minimo =
      rawMin === undefined || rawMin === null || String(rawMin).trim() === ''
        ? STOCK_MINIMO_DEFAULT
        : parsearStock(rawMin)

    const tipo = normalizarTipo(parsearTextoOpcional(fila[mapeo.tipo]))
    const unidad =
      mapeo.unidad >= 0
        ? normalizarUnidad(parsearTextoOpcional(fila[mapeo.unidad]))
        : null
    const categoria = parsearTextoOpcional(fila[mapeo.categoria])
    const codigo_barras = parsearCodigoBarras(fila[mapeo.codigo_barras])
    const proveedor = parsearTextoOpcional(fila[mapeo.proveedor])
    const venta_por_peso =
      mapeo.venta_por_peso >= 0
        ? parsearBooleano(fila[mapeo.venta_por_peso])
        : false
    const dias_vencimiento_minimo =
      mapeo.dias_vencimiento_minimo >= 0
        ? parsearEnteroOpcional(fila[mapeo.dias_vencimiento_minimo])
        : null

    if (precio_venta <= 0) errores.push('Precio de venta inválido')
    if (precio_costo < 0) errores.push('Precio de costo negativo')

    const saltada = false // los combos también se importan ahora

    resultado.push({
      fila_origen: filaOrigen,
      producto,
      precio_costo,
      precio_venta,
      stock_actual,
      stock_minimo,
      tipo,
      unidad,
      categoria,
      codigo_barras,
      proveedor,
      venta_por_peso,
      dias_vencimiento_minimo,
      errores,
      saltada,
    })
  })
  return resultado
}
