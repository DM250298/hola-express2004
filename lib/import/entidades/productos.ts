// Definición de la entidad "Productos" para el motor de importación.
// El array `columnas` está ORDENADO de más específico a más genérico para que
// la detección por encabezado no confunda (ej. "codigo_barras_2" con
// "codigo_barras"). El campo `orden` define la presentación en la plantilla/
// export (obligatorios primero), independiente del orden de detección.

import {
  parsearBooleano,
  parsearCodigoBarras,
  parsearEnteroOpcional,
  parsearIva,
  parsearPrecio,
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
  // ── Identificadores (específicos primero para la DETECCIÓN) ──
  {
    campo: 'codigo_barras_2',
    etiqueta: 'codigo_barras_2',
    aliases: [/c[oó]digo.*barras.*2/i, /barras.*2/i, /c[oó]digo.*secundario/i],
    parser: parsearCodigoBarras,
    orden: 18,
    ayuda: 'Código de barras adicional (ej. EAN de fábrica). Se reconoce al escanear en el POS. Opcional.',
  },
  {
    campo: 'codigo_interno',
    etiqueta: 'Codigo Interno',
    aliases: [/c[oó]digo.*interno/i],
    parser: parsearTextoOpcional,
    orden: 19,
    ayuda: 'Código interno propio del negocio. Opcional.',
  },
  {
    campo: 'codigo_proveedor',
    etiqueta: 'codigo_proveedor',
    aliases: [/c[oó]digo.*proveedor/i],
    parser: parsearTextoOpcional,
    orden: 10,
    ayuda: 'Código del producto en el catálogo del proveedor. Opcional.',
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
    orden: 1,
    ayuda: 'Código único del producto (SKU o código de barras). Si lo dejás VACÍO, el sistema genera uno automático (HEX-000001…).',
  },
  // ── Texto descriptivo ──
  {
    campo: 'subcategoria',
    etiqueta: 'subcategoria',
    aliases: [/subcategor[ií]a/i],
    parser: parsearTextoOpcional,
    orden: 7,
    ayuda: 'Sub-rubro (texto libre). Opcional.',
  },
  {
    campo: 'categoria',
    etiqueta: 'categoria',
    aliases: [/^categor[ií]a/i],
    parser: parsearTextoOpcional,
    orden: 6,
    ayuda: 'Rubro del producto. Si no existe, se crea automáticamente.',
  },
  {
    campo: 'marca',
    etiqueta: 'marca',
    aliases: [/^marca$/i],
    parser: parsearTextoOpcional,
    orden: 8,
    ayuda: 'Marca del producto. Opcional.',
  },
  {
    campo: 'nombre',
    etiqueta: 'nombre',
    aliases: [/^nombre/i, /^producto/i, /descripci[oó]n/i],
    parser: parsearTextoOpcional,
    requerida: true,
    orden: 2,
    ayuda: 'OBLIGATORIO. Nombre del producto como se ve en el punto de venta.',
  },
  {
    campo: 'proveedor',
    etiqueta: 'proveedor',
    aliases: [/^proveedor/i],
    parser: parsearTextoOpcional,
    orden: 9,
    ayuda: 'Proveedor principal. Si no existe, se crea automáticamente.',
  },
  {
    campo: 'unidad',
    etiqueta: 'unidad_medida',
    aliases: [/unidad.*medida/i, /^unidad$/i, /^unidades$/i, /medida/i],
    parser: normalizarUnidad,
    orden: 11,
    ayuda: 'unidad, kg, g, lt, ml, docena o caja. Vacío = unidad.',
  },
  {
    campo: 'venta_por_peso',
    etiqueta: 'es_fraccionado',
    aliases: [/es.*fraccionad/i, /fraccionad/i, /venta.*peso/i, /por.*peso/i, /pesable/i],
    // Tri-estado: vacío → null (el RPC conserva el valor actual al actualizar;
    // usa false por defecto al crear). No pisar la config de peso en updates.
    parser: boolTriestado,
    exportar: (v) => (v ? 'true' : 'false'),
    orden: 12,
    ayuda: 'true si se vende por peso (fiambres, verdura). Vacío = conserva el valor actual (false en productos nuevos).',
  },
  // ── Números ──
  {
    campo: 'precio_costo',
    etiqueta: 'precio_costo',
    aliases: [/precio.*costo/i, /^costo$/i],
    parser: (v) => (v == null || String(v).trim() === '' ? null : parsearPrecio(v)),
    orden: 4,
    ayuda: 'Costo neto sin IVA. No se muestra a cajeros. Opcional.',
  },
  {
    campo: 'iva',
    etiqueta: 'alicuota_iva',
    aliases: [/al[ií]cuota.*iva/i, /al[ií]cuota/i, /^iva$/i],
    // Vacío → null: en una actualización el RPC conserva la alícuota actual
    // (coalesce); en un alta usa 21% por defecto. Si viene un valor, parsearIva
    // lo normaliza (0.21 → 21, "21%" → 21).
    parser: (v) => (v == null || String(v).trim() === '' ? null : parsearIva(v)),
    // Round-trip: el sistema guarda 21, el Excel del usuario usa 0.21
    exportar: (v) => Number(v ?? 21) / 100,
    orden: 5,
    ayuda: 'Alícuota de IVA: podés poner 0.21 (= 21%) o 21. Vacío = conserva la actual (21% en productos nuevos).',
  },
  {
    campo: 'precio_venta',
    etiqueta: 'precio_venta',
    aliases: [/precio.*venta/i, /^venta$/i, /^precio$/i],
    // Vacío → null (NO 0): en una actualización el RPC hace coalesce(precio, actual),
    // así un precio en blanco conserva el vigente en vez de pisarlo con 0.
    parser: (v) => (v == null || String(v).trim() === '' ? null : parsearPrecio(v)),
    requerida: true,
    // El FALTANTE solo se exige al CREAR: si el producto ya existe (misma SKU),
    // el precio puede venir vacío y el RPC conserva el actual (coalesce). Pero un
    // precio PRESENTE inválido (≤ 0) se rechaza siempre, para no pisar el precio
    // vigente con 0 y dejar el producto vendible a $0.
    soloRequeridaEnAlta: true,
    validar: (v) =>
      v == null
        ? 'Falta el precio de venta (obligatorio)'
        : typeof v === 'number' && v > 0
          ? null
          : 'El precio de venta debe ser mayor a 0',
    orden: 3,
    ayuda: 'Precio final de venta, mayor a 0. Obligatorio solo para productos NUEVOS; si el producto ya existe, podés dejarlo vacío y se conserva el precio actual.',
  },
  {
    campo: 'stock_actual',
    etiqueta: 'stock_inicial',
    aliases: [/stock.*inicial/i, /stock.*actual/i, /^stock$/i, /existencia/i],
    // Vacío → null: en una actualización el RPC conserva el stock actual (coalesce)
    // en vez de ponerlo en 0. En un alta, el RPC usa 0 por defecto. numeric(12,3):
    // preserva decimales de fraccionados cuando sí viene un valor.
    parser: (v) => (v == null || String(v).trim() === '' ? null : parsearPrecio(v)),
    orden: 13,
    ayuda: 'Unidades que tenés hoy. Acepta decimales si es por peso. Vacío = conserva el stock actual (0 en productos nuevos).',
  },
  {
    campo: 'stock_minimo',
    etiqueta: 'stock_minimo',
    aliases: [/stock.*m[ií]nimo/i, /stock.*min/i, /^m[ií]nimo$/i],
    parser: parsearEnteroOpcional, // null si vacío → el RPC conserva / pone 5
    orden: 14,
    ayuda: 'Cantidad mínima para alertar reposición. Vacío = 5.',
  },
  {
    campo: 'ubicacion',
    etiqueta: 'ubicacion',
    aliases: [/ubicaci[oó]n/i, /g[oó]ndola/i, /pasillo/i],
    parser: parsearTextoOpcional,
    orden: 15,
    ayuda: 'Góndola, heladera o pasillo donde está el producto. Opcional.',
  },
  {
    campo: 'es_perecedero',
    etiqueta: 'es_perecedero',
    aliases: [/perecedero/i],
    parser: boolTriestado,
    exportar: (v) => (v ? 'true' : 'false'),
    orden: 16,
    ayuda: 'true si el producto vence. Si es false, no se controla vencimiento.',
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
    orden: 17,
    ayuda: 'Días para alertar antes de vencer (solo si es perecedero). Opcional.',
  },
  {
    campo: 'activo',
    etiqueta: 'activo',
    aliases: [/^activo$/i, /habilitado/i],
    // Vacío → null: en una actualización el RPC conserva el estado actual (no
    // reactiva un producto dado de baja); en un alta usa true por defecto.
    parser: (v) => (v == null || String(v).trim() === '' ? null : parsearBooleano(v)),
    exportar: (v) => (v ? 'true' : 'false'),
    orden: 20,
    ayuda: 'true o false. Vacío = conserva el estado actual (activo en productos nuevos).',
  },
]

export const ENTIDAD_PRODUCTOS: DefinicionEntidad = {
  clave: 'productos',
  etiqueta: 'Productos',
  descripcion:
    'Maestro de productos. La columna SKU es el código único; si falta, se genera uno (HEX-…).',
  columnas,
  // Solo 'nombre' es header obligatorio: un archivo que únicamente ACTUALIZA
  // productos existentes puede no traer la columna de precio. El precio se sigue
  // exigiendo por celda al CREAR (ver soloRequeridaEnAlta en precio_venta).
  requeridasHeader: ['nombre'],
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
