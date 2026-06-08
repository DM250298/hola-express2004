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
