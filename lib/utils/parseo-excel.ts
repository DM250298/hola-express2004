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

// ─── Tipos del flujo de importación ─────────────────────────────────

export interface FilaExcel {
  fila_origen: number // número de fila en el Excel (para reportar errores)
  producto: string
  precio_costo: number
  precio_venta: number
  stock_actual: number
  tipo: string | null
  unidad: string | null
  categoria: string | null
  codigo_barras: string | null
  proveedor: string | null
}

export interface FilaProcesada extends FilaExcel {
  errores: string[]
  saltada: boolean // reservado para futuras reglas; los combos ya se importan
}

const HEADERS_ESPERADOS: Record<keyof Omit<FilaExcel, 'fila_origen'>, RegExp[]> = {
  producto: [/^producto/i, /^nombre/i],
  precio_costo: [/precio.*costo/i, /^costo/i],
  precio_venta: [/precio.*venta/i, /^venta/i, /^precio$/i],
  stock_actual: [/stock.*actual/i, /^stock$/i, /existencia/i],
  tipo: [/tipo.*producto/i, /^tipo$/i],
  unidad: [/^unidad$/i, /^unidades$/i, /medida/i],
  categoria: [/categor[ií]a/i],
  codigo_barras: [/^c[oó]digo$/i, /c[oó]digo.*barras/i, /barcode/i],
  proveedor: [/proveedor/i, /c[oó]digo.*secundario/i],
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
    const tipo = normalizarTipo(parsearTextoOpcional(fila[mapeo.tipo]))
    const unidad =
      mapeo.unidad >= 0
        ? normalizarUnidad(parsearTextoOpcional(fila[mapeo.unidad]))
        : null
    const categoria = parsearTextoOpcional(fila[mapeo.categoria])
    const codigo_barras = parsearCodigoBarras(fila[mapeo.codigo_barras])
    const proveedor = parsearTextoOpcional(fila[mapeo.proveedor])

    if (precio_venta <= 0) errores.push('Precio de venta inválido')
    if (precio_costo < 0) errores.push('Precio de costo negativo')

    const saltada = false // los combos también se importan ahora

    resultado.push({
      fila_origen: filaOrigen,
      producto,
      precio_costo,
      precio_venta,
      stock_actual,
      tipo,
      unidad,
      categoria,
      codigo_barras,
      proveedor,
      errores,
      saltada,
    })
  })
  return resultado
}
