// Contratos del motor de importación/exportación genérico.
// Cada entidad (productos, clientes, categorías…) se declara con una
// DefinicionEntidad; el motor (motor.ts) hace toda la mecánica común:
// detección de columnas por encabezado, preview y ejecución.

import type { Database } from '@/types/database'

/** Nombre de una tabla real del esquema (para el lookup del preview). */
export type TablaDB = keyof Database['public']['Tables']

/** Una columna del maestro: cómo se detecta, cómo se parsea, cómo se exporta. */
export interface ColumnaDef {
  /** Nombre del campo en el payload (la key que leen los RPC / upserts). */
  campo: string
  /** Encabezado canónico usado al EXPORTAR. */
  etiqueta: string
  /** Patrones que detectan esta columna en el encabezado del Excel. */
  aliases: RegExp[]
  /** Convierte el valor crudo de la celda al valor final del payload. */
  parser: (valor: unknown) => unknown
  /** Si true, el header DEBE detectarse para considerar válido el archivo. */
  requerida?: boolean
  /**
   * Si true, la validación `validar` de esta columna SOLO aplica a filas
   * NUEVAS (altas). Cuando la clave ya existe en la base (actualización), se
   * omite: el RPC conserva el valor actual si la columna no viene (update
   * conservador con coalesce). Ej: el precio de venta es obligatorio al crear
   * un producto, pero no al actualizar uno existente.
   */
  soloRequeridaEnAlta?: boolean
  /** Validación por celda; devuelve mensaje de error o null si está OK. */
  validar?: (valor: unknown, datos: Record<string, unknown>) => string | null
  /** Cómo serializar el valor al exportar (default: String(valor)). */
  exportar?: (valor: unknown) => string | number
  /**
   * Posición de la columna en la plantilla/export (orden de PRESENTACIÓN,
   * distinto del orden del array, que es de DETECCIÓN). Menor = más a la izq.
   */
  orden?: number
  /** Observación de qué poner en la columna (se muestra en la hoja Guía). */
  ayuda?: string
}

/** Estrategia de escritura en la base (todas las entidades usan RPC atómico). */
export type EstrategiaEscritura = { tipo: 'rpc'; nombre: string }

/** Clave única que identifica una fila contra la base (para el preview). */
export interface ClaveUnica {
  /** Campo del payload que actúa de clave. */
  campo: string
  /** Columna y tabla donde buscar existentes (lectura del preview). */
  columna: string
  tabla: TablaDB
}

export interface DefinicionEntidad {
  clave: string
  etiqueta: string
  descripcion: string
  columnas: ColumnaDef[]
  /** Campos cuyo header debe detectarse para aceptar el archivo. */
  requeridasHeader: string[]
  claveUnica: ClaveUnica
  escritura: EstrategiaEscritura
  permisoImport: string
  permisoExport: string
  /** Nombre de archivo base para el export (sin fecha ni extensión). */
  nombreArchivo: string
  /**
   * Ajuste de la fila completa tras parsear cada columna (derivaciones que
   * dependen de varios campos, ej. es_perecedero ⇒ dias_vencimiento).
   */
  posProcesar?: (datos: Record<string, unknown>) => void
  /** Filas de ejemplo (keys = `campo`) para la plantilla descargable. */
  ejemplos?: Record<string, string | number>[]
}

export interface FilaProcesadaGen {
  fila_origen: number
  datos: Record<string, unknown>
  errores: string[]
}

export interface ResumenImport {
  total_filas: number
  validas: number
  con_errores: number
  a_crear: number
  a_actualizar: number
  /** Claves repetidas dentro del mismo archivo (gana la última fila). */
  duplicados_archivo: string[]
  /** Campos del encabezado que NO se detectaron (informativo). */
  columnas_no_detectadas: string[]
}

export interface ResultadoImport {
  creados: number
  actualizados: number
  errores: Array<{ fila: number; codigo: string; mensaje: string }>
}
