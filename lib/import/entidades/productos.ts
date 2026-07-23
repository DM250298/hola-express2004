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

/**
 * Margen de ganancia en PORCENTAJE: "30", "30%", "30,5" → 30. Vacío → null
 * (el RPC entonces usa el precio de venta manual, o conserva el actual). Es un
 * porcentaje directo sobre el costo (30 = 30%), no una fracción — a diferencia
 * del IVA, un margen chico tipo 0,3 es rarísimo, así que no se auto-escala.
 */
function parsearMargen(valor: unknown): number | null {
  if (valor === null || valor === undefined || String(valor).trim() === '') return null
  const n = parsearPrecio(String(valor).replace('%', '').trim())
  return Number.isFinite(n) ? n : null
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
    orden: 3,
    ayuda: 'Costo neto SIN IVA. Es la base para calcular el precio con el margen. No se muestra a cajeros.',
  },
  {
    campo: 'margen',
    etiqueta: 'margen',
    aliases: [/^margen/i, /ganancia/i, /markup/i],
    parser: parsearMargen,
    orden: 4,
    validar: (v) =>
      v == null
        ? null
        : typeof v === 'number' && v >= 0
          ? null
          : 'El margen debe ser un número ≥ 0 (ej. 30 para 30%)',
    ayuda:
      'Margen de ganancia deseado, en %. Poné 30 para 30%: es la ganancia LIMPIA sobre el costo, ya descontadas IIBB, imp. créd/déb y comisión Mercado Pago. Con costo + margen el sistema calcula el precio de venta solo. Dejá vacío si vas a cargar el precio a mano.',
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
    // El precio dejó de ser obligatorio: el modelo nuevo es costo + margen y el
    // sistema lo calcula (fn_precio_venta). Solo se exige al CREAR cuando NO hay
    // con qué calcularlo (ni margen ni costo). Un precio PRESENTE inválido (≤ 0)
    // se rechaza siempre, para no dejar el producto vendible a $0.
    soloRequeridaEnAlta: true,
    validar: (v, datos) => {
      if (v != null) {
        return typeof v === 'number' && v > 0
          ? null
          : 'El precio de venta debe ser mayor a 0'
      }
      // Precio vacío en un alta: se acepta si hay con qué calcularlo.
      const tieneMargen = datos.margen != null
      const tieneCosto = datos.precio_costo != null
      if (tieneMargen && tieneCosto) return null
      if (tieneMargen && !tieneCosto)
        return 'Hay margen pero falta el costo: sin costo no puedo calcular el precio.'
      return 'Falta el precio de venta, o cargá costo + margen para que el sistema lo calcule.'
    },
    orden: 5.5,
    ayuda: 'Precio final de venta. OPCIONAL si cargás costo + margen (el sistema lo calcula). Si lo ponés a mano, manda el precio manual. Al actualizar, vacío conserva el precio actual.',
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
    'Maestro de productos. La columna SKU es el código único; si falta, se genera uno (HEX-…). Cargá costo (sin IVA) + margen y el sistema calcula el precio de venta con el motor de márgenes; o poné el precio a mano.',
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
      // Modelo recomendado: costo + margen → el sistema calcula el precio.
      codigo_barras: '7790895000123',
      nombre: 'Coca-Cola 500ml',
      marca: 'Coca-Cola',
      categoria: 'Bebidas sin alcohol',
      proveedor: 'Distribuidora La Rioja',
      unidad: 'unidad',
      venta_por_peso: 'false',
      precio_costo: 800,
      margen: 35,
      iva: 0.21,
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
      margen: 40,
      iva: 0.21,
      stock_actual: 8,
      stock_minimo: 3,
      ubicacion: 'Heladera 2',
      es_perecedero: 'true',
      dias_vencimiento_minimo: 20,
      activo: 'true',
    },
    {
      // Precio a mano (sin margen): el sistema respeta el precio cargado.
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
