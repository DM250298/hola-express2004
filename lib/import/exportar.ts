// Generación de Excel de exportación, round-trip con el import: los encabezados
// son las `etiqueta` de cada columna de la entidad, y los valores se serializan
// con `col.exportar` cuando existe. Reutiliza el patrón SheetJS de
// lib/utils/cotizacion.ts.

import * as XLSX from 'xlsx'
import type { DefinicionEntidad } from './tipos'
import type { FilaExport } from '@/lib/queries/exportar-maestros'
import { ENTIDAD_CATEGORIAS } from './entidades/categorias'
import { ENTIDAD_PROVEEDORES } from './entidades/proveedores'
import {
  getCategoriasExport,
  getClientesExport,
  getProductosExport,
  getProveedoresExport,
} from '@/lib/queries/exportar-maestros'

/** Construye el array-of-arrays (encabezado + filas) para una entidad. */
function construirAoa(def: DefinicionEntidad, filas: FilaExport[]): (string | number)[][] {
  const header = def.columnas.map((c) => c.etiqueta)
  const cuerpo = filas.map((fila) =>
    def.columnas.map((c) => {
      const v = fila[c.campo]
      if (c.exportar) return c.exportar(v)
      if (v === null || v === undefined) return ''
      return v as string | number
    })
  )
  return [header, ...cuerpo]
}

/** Ancho de columnas razonable según la etiqueta. */
function anchos(def: DefinicionEntidad) {
  return def.columnas.map((c) => ({ wch: Math.max(12, Math.min(40, c.etiqueta.length + 4)) }))
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
    ws['!cols'] = anchos(h.def)
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
 * Descarga una plantilla vacía (encabezados + filas de ejemplo + hoja de
 * instrucciones) para la carga inicial. No requiere datos en la base.
 */
export function descargarPlantilla(def: DefinicionEntidad): void {
  const header = def.columnas.map((c) => c.etiqueta)
  const ejemplos = (def.ejemplos ?? []).map((e) =>
    def.columnas.map((c) => {
      const v = e[c.campo]
      return v === undefined || v === null ? '' : v
    })
  )
  const wsDatos = XLSX.utils.aoa_to_sheet([header, ...ejemplos])
  wsDatos['!cols'] = def.columnas.map((c) => ({
    wch: Math.max(12, Math.min(40, c.etiqueta.length + 4)),
  }))

  const instr: (string | number)[][] = [
    [`Plantilla de ${def.etiqueta} — ¡Hola! Express`],
    [def.descripcion],
    [],
    ['Columna', '¿Obligatoria?'],
    ...def.columnas.map((c) => [c.etiqueta, c.requerida ? 'Sí' : 'No']),
    [],
    ['Las filas de ejemplo son ilustrativas: reemplazalas por tus datos.'],
    ['No cambies los nombres del encabezado; las columnas que no uses podés dejarlas vacías.'],
  ]
  const wsInstr = XLSX.utils.aoa_to_sheet(instr)
  wsInstr['!cols'] = [{ wch: 28 }, { wch: 14 }]

  const wb = XLSX.utils.book_new()
  // La hoja de datos va primera y con el nombre de la entidad (el importador
  // la prioriza por nombre al volver a subir el archivo).
  XLSX.utils.book_append_sheet(wb, wsDatos, def.clave)
  XLSX.utils.book_append_sheet(wb, wsInstr, 'Instrucciones')
  XLSX.writeFile(wb, `plantilla-${def.nombreArchivo}.xlsx`)
}
