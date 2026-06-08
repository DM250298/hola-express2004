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
  /** Validación por celda; devuelve mensaje de error o null si está OK. */
  validar?: (valor: unknown, datos: Record<string, unknown>) => string | null
  /** Cómo serializar el valor al exportar (default: String(valor)). */
  exportar?: (valor: unknown) => string | number
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
