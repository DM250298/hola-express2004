// Generación de Excel de exportación, round-trip con el import: los encabezados
// son las `etiqueta` de cada columna de la entidad, y los valores se serializan
// con `col.exportar` cuando existe. Reutiliza el patrón SheetJS de
// lib/utils/cotizacion.ts.

import * as XLSX from 'xlsx'
import type { ColumnaDef, DefinicionEntidad } from './tipos'
import type { FilaExport } from '@/lib/queries/exportar-maestros'
import { ENTIDAD_CATEGORIAS } from './entidades/categorias'
import { ENTIDAD_PROVEEDORES } from './entidades/proveedores'
import {
  getCategoriasExport,
  getClientesExport,
  getProductosExport,
  getProveedoresExport,
} from '@/lib/queries/exportar-maestros'

/** Columnas en orden de PRESENTACIÓN (obligatorios primero); el array de la
 *  entidad está en orden de detección. */
function columnasOrdenadas(def: DefinicionEntidad): ColumnaDef[] {
  return [...def.columnas].sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999))
}

/** Construye el array-of-arrays (encabezado + filas) para una entidad. */
function construirAoa(def: DefinicionEntidad, filas: FilaExport[]): (string | number)[][] {
  const cols = columnasOrdenadas(def)
  const header = cols.map((c) => c.etiqueta)
  const cuerpo = filas.map((fila) =>
    cols.map((c) => {
      const v = fila[c.campo]
      if (c.exportar) return c.exportar(v)
      if (v === null || v === undefined) return ''
      return v as string | number
    })
  )
  return [header, ...cuerpo]
}

/** Ancho de columnas razonable según la etiqueta. */
function anchosDesde(cols: ColumnaDef[]) {
  return cols.map((c) => ({ wch: Math.max(12, Math.min(40, c.etiqueta.length + 4)) }))
}

interface HojaExport {
  nombre: string
  def: DefinicionEntidad
  filas: FilaExport[]
}

function descargar(hojas: HojaExport[], nombreArchivo: string) {
  const wb = XLSX.utils.book_new()
  for (const h of hojas) {
    const ws = XLSX.utils.aoa_to_sheet(construirAoa(h.def, h.filas))
    ws['!cols'] = anchosDesde(columnasOrdenadas(h.def))
    XLSX.utils.book_append_sheet(wb, ws, h.nombre)
  }
  const fecha = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `${nombreArchivo}-${fecha}.xlsx`)
}

// ── Productos: incluye hojas auxiliares de categorías y proveedores ──
export async function exportarProductos(incluirCosto: boolean): Promise<void> {
  const { ENTIDAD_PRODUCTOS } = await import('./entidades/productos')
  const [productos, categorias, proveedores] = await Promise.all([
    getProductosExport(incluirCosto),
    getCategoriasExport(),
    getProveedoresExport(),
  ])
  descargar(
    [
      { nombre: 'productos', def: ENTIDAD_PRODUCTOS, filas: productos },
      { nombre: 'categorias', def: ENTIDAD_CATEGORIAS, filas: categorias },
      { nombre: 'proveedores', def: ENTIDAD_PROVEEDORES, filas: proveedores },
    ],
    ENTIDAD_PRODUCTOS.nombreArchivo
  )
}

export async function exportarEntidadSimple(def: DefinicionEntidad): Promise<void> {
  let filas: FilaExport[]
  if (def.clave === 'clientes') filas = await getClientesExport()
  else if (def.clave === 'categorias') filas = await getCategoriasExport()
  else if (def.clave === 'proveedores') filas = await getProveedoresExport()
  else throw new Error(`Export no implementado para ${def.clave}`)
  descargar([{ nombre: def.clave, def, filas }], def.nombreArchivo)
}

/**
 * Descarga una plantilla para la carga inicial:
 * - Hoja "Instrucciones": campos obligatorios destacados + observación de cada
 *   columna (qué poner).
 * - Hoja de datos (nombre de la entidad): encabezados en orden lógico +
 *   filas de ejemplo. El importador prioriza esta hoja por su nombre.
 */
export function descargarPlantilla(def: DefinicionEntidad): void {
  const cols = columnasOrdenadas(def)

  // ── Hoja de datos: encabezados + ejemplos ──
  const header = cols.map((c) => c.etiqueta)
  const ejemplos = (def.ejemplos ?? []).map((e) =>
    cols.map((c) => {
      const v = e[c.campo]
      return v === undefined || v === null ? '' : v
    })
  )
  const wsDatos = XLSX.utils.aoa_to_sheet([header, ...ejemplos])
  wsDatos['!cols'] = anchosDesde(cols)

  // ── Hoja de instrucciones ──
  const obligatorias = cols.filter((c) => c.requerida).map((c) => c.etiqueta)
  const instr: string[][] = [
    [`Plantilla de ${def.etiqueta} — ¡Hola! Express`],
    [def.descripcion],
    [],
    ['CAMPOS OBLIGATORIOS:', obligatorias.join('   ·   ')],
    [],
    ['Columna', 'Obligatorio', 'Qué poner en esta columna'],
    ...cols.map((c) => [c.etiqueta, c.requerida ? '★ SÍ' : '—', c.ayuda ?? '']),
    [],
    ['Cómo cargar:'],
    [`• Completá la hoja "${def.clave}" desde la fila 2 (una fila por registro).`],
    ['• No cambies los nombres de la fila de encabezado.'],
    ['• Las columnas que no uses, dejalas vacías.'],
    ['• Las filas de ejemplo son ilustrativas: reemplazalas por tus datos o borralas.'],
  ]
  const wsInstr = XLSX.utils.aoa_to_sheet(instr)
  wsInstr['!cols'] = [{ wch: 22 }, { wch: 13 }, { wch: 66 }]

  const wb = XLSX.utils.book_new()
  // Instrucciones primero (para que se lea al abrir); la hoja de datos lleva el
  // nombre de la entidad y el importador la detecta por nombre, no por posición.
  XLSX.utils.book_append_sheet(wb, wsInstr, 'Instrucciones')
  XLSX.utils.book_append_sheet(wb, wsDatos, def.clave)
  XLSX.writeFile(wb, `plantilla-${def.nombreArchivo}.xlsx`)
}
