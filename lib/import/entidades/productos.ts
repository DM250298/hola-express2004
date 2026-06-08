// Definición de la entidad "Productos" para el motor de importación.
// Las columnas están ORDENADAS de más específica a más genérica para que la
// detección por encabezado (que toma el primer header libre que matchea) no
// confunda, p. ej., "codigo_barras_2" con "codigo_barras", o "subcategoria"
// con "categoria".

import {
  parsearBooleano,
  parsearCodigoBarras,
  parsearEnteroOpcional,
  parsearIva,
  parsearPrecio,
  parsearStock,
  parsearTextoOpcional,
} from '@/lib/utils/parseo-excel'
import type { ColumnaDef, DefinicionEntidad } from '../tipos'

/** "Un" → "unidad", "Kg" → "kg", etc. Conserva lo desconocido en minúsculas. */
function normalizarUnidad(valor: unknown): string | null {
  const s = parsearTextoOpcional(valor)
  if (!s) return null
  const u = s.toLowerCase().trim()
  const mapa: Record<string, string> = {
    un: 'unidad', u: 'unidad', unid: 'unidad', unidad: 'unidad',
    kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg',
    g: 'g', gr: 'g', gramo: 'g', gramos: 'g',
    l: 'lt', lt: 'lt', lts: 'lt', litro: 'lt', litros: 'lt',
    ml: 'ml', cc: 'ml',
    doc: 'docena', docena: 'docena',
    caja: 'caja', cja: 'caja',
  }
  return mapa[u] ?? u
}

/** Booleano tri-estado: vacío → null (no se conoce), sino true/false. */
function boolTriestado(valor: unknown): boolean | null {
  if (valor === null || valor === undefined || String(valor).trim() === '') return null
  return parsearBooleano(valor)
}

const columnas: ColumnaDef[] = [
  // ── Identificadores (específicos primero) ──
  {
    campo: 'codigo_barras_2',
    etiqueta: 'codigo_barras_2',
    aliases: [/c[oó]digo.*barras.*2/i, /barras.*2/i, /c[oó]digo.*secundario/i],
    parser: parsearCodigoBarras,
  },
  {
    campo: 'codigo_interno',
    etiqueta: 'Codigo Interno',
    aliases: [/c[oó]digo.*interno/i],
    parser: parsearTextoOpcional,
  },
  {
    campo: 'codigo_proveedor',
    etiqueta: 'codigo_proveedor',
    aliases: [/c[oó]digo.*proveedor/i],
    parser: parsearTextoOpcional,
  },
  {
    // SKU = código de barras (clave de identidad). Vacío → autogenera el RPC.
    campo: 'codigo_barras',
    etiqueta: 'SKU',
    aliases: [
      /^sku$/i,
      /c[oó]digo.*[uú]nico/i,
      /c[oó]digo.*barras(?!.*2)/i,
      /barcode/i,
      /^c[oó]digo$/i,
    ],
    parser: parsearCodigoBarras,
  },
  // ── Texto descriptivo ──
  {
    campo: 'subcategoria',
    etiqueta: 'subcategoria',
    aliases: [/subcategor[ií]a/i],
    parser: parsearTextoOpcional,
  },
  {
    campo: 'categoria',
    etiqueta: 'categoria',
    aliases: [/^categor[ií]a/i],
    parser: parsearTextoOpcional,
  },
  {
    campo: 'marca',
    etiqueta: 'marca',
    aliases: [/^marca$/i],
    parser: parsearTextoOpcional,
  },
  {
    campo: 'nombre',
    etiqueta: 'nombre',
    aliases: [/^nombre/i, /^producto/i, /descripci[oó]n/i],
    parser: parsearTextoOpcional,
    requerida: true,
  },
  {
    campo: 'proveedor',
    etiqueta: 'proveedor',
    aliases: [/^proveedor/i],
    parser: parsearTextoOpcional,
  },
  {
    campo: 'unidad',
    etiqueta: 'unidad_medida',
    aliases: [/unidad.*medida/i, /^unidad$/i, /^unidades$/i, /medida/i],
    parser: normalizarUnidad,
  },
  {
    campo: 'venta_por_peso',
    etiqueta: 'es_fraccionado',
    aliases: [/es.*fraccionad/i, /fraccionad/i, /venta.*peso/i, /por.*peso/i, /pesable/i],
    parser: parsearBooleano,
    exportar: (v) => (v ? 'true' : 'false'),
  },
  // ── Números ──
  {
    campo: 'precio_costo',
    etiqueta: 'precio_costo',
    aliases: [/precio.*costo/i, /^costo$/i],
    parser: (v) => (v == null || String(v).trim() === '' ? null : parsearPrecio(v)),
  },
  {
    campo: 'iva',
    etiqueta: 'alicuota_iva',
    aliases: [/al[ií]cuota.*iva/i, /al[ií]cuota/i, /^iva$/i],
    parser: parsearIva,
    // Round-trip: el sistema guarda 21, el Excel del usuario usa 0.21
    exportar: (v) => Number(v ?? 21) / 100,
  },
  {
    campo: 'precio_venta',
    etiqueta: 'precio_venta',
    aliases: [/precio.*venta/i, /^venta$/i, /^precio$/i],
    parser: parsearPrecio,
    requerida: true,
    validar: (v) =>
      typeof v === 'number' && v > 0 ? null : 'Precio de venta inválido',
  },
  {
    campo: 'stock_actual',
    etiqueta: 'stock_inicial',
    aliases: [/stock.*inicial/i, /stock.*actual/i, /^stock$/i, /existencia/i],
    parser: parsearPrecio, // numeric(12,3): preserva decimales de fraccionados
  },
  {
    campo: 'stock_minimo',
    etiqueta: 'stock_minimo',
    aliases: [/stock.*m[ií]nimo/i, /stock.*min/i, /^m[ií]nimo$/i],
    parser: parsearEnteroOpcional, // null si vacío → el RPC conserva / pone 5
  },
  {
    campo: 'ubicacion',
    etiqueta: 'ubicacion',
    aliases: [/ubicaci[oó]n/i, /g[oó]ndola/i, /pasillo/i],
    parser: parsearTextoOpcional,
  },
  {
    campo: 'es_perecedero',
    etiqueta: 'es_perecedero',
    aliases: [/perecedero/i],
    parser: boolTriestado,
    exportar: (v) => (v ? 'true' : 'false'),
  },
  {
    campo: 'dias_vencimiento_minimo',
    etiqueta: 'dias_alerta_vto',
    aliases: [
      /d[ií]as.*alerta/i,
      /alerta.*vto/i,
      /vencimiento.*m[ií]nimo/i,
      /venc.*min/i,
      /d[ií]as.*vencimiento/i,
    ],
    parser: parsearEnteroOpcional,
  },
  {
    campo: 'activo',
    etiqueta: 'activo',
    aliases: [/^activo$/i, /habilitado/i],
    parser: (v) => (v == null || String(v).trim() === '' ? true : parsearBooleano(v)),
    exportar: (v) => (v ? 'true' : 'false'),
  },
]

export const ENTIDAD_PRODUCTOS: DefinicionEntidad = {
  clave: 'productos',
  etiqueta: 'Productos',
  descripcion:
    'Maestro de productos. La columna SKU es el código único; si falta, se genera uno (HEX-…).',
  columnas,
  requeridasHeader: ['nombre', 'precio_venta'],
  claveUnica: { campo: 'codigo_barras', columna: 'codigo_barras', tabla: 'productos' },
  escritura: { tipo: 'rpc', nombre: 'fn_importar_productos' },
  permisoImport: 'configuracion',
  permisoExport: 'inventario',
  nombreArchivo: 'maestro-productos',
  posProcesar: (datos) => {
    // Si el producto NO es perecedero, no hay alerta de vencimiento.
    if (datos.es_perecedero === false) datos.dias_vencimiento_minimo = null
  },
  ejemplos: [
    {
      codigo_barras: '7790895000123',
      nombre: 'Coca-Cola 500ml',
      marca: 'Coca-Cola',
      categoria: 'Bebidas sin alcohol',
      proveedor: 'Distribuidora La Rioja',
      unidad: 'unidad',
      venta_por_peso: 'false',
      precio_costo: 800,
      iva: 0.21,
      precio_venta: 1200,
      stock_actual: 48,
      stock_minimo: 12,
      es_perecedero: 'false',
      activo: 'true',
    },
    {
      codigo_barras: '2000000000015',
      nombre: 'Queso cremoso',
      categoria: 'Fiambrería',
      proveedor: 'Lácteos del Valle',
      unidad: 'kg',
      venta_por_peso: 'true',
      precio_costo: 4500,
      iva: 0.21,
      precio_venta: 7900,
      stock_actual: 8,
      stock_minimo: 3,
      ubicacion: 'Heladera 2',
      es_perecedero: 'true',
      dias_vencimiento_minimo: 20,
      activo: 'true',
    },
    {
      nombre: 'Combo Mate (yerba + termo)',
      categoria: 'Almacén',
      precio_venta: 5500,
      stock_actual: 5,
      stock_minimo: 2,
      es_perecedero: 'false',
      activo: 'true',
    },
  ],
}
