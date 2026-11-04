/**
 * Snapshot del catálogo de productos para el POS offline.
 *
 * Mientras hay conexión, cada lectura exitosa de la lista completa de
 * productos se vuelca a IndexedDB. Si después se cae internet, el buscador
 * del POS lee de ese snapshot y filtra en memoria.
 */

import {
  STORE_CATALOGO,
  idbGuardarLote,
  idbObtenerTodo,
  idbVaciar,
  metaGuardar,
  metaObtener,
} from './db'
import {
  elegirProductoEscaneado,
  parsearCodigoBalanza,
} from '@/lib/pos/codigoBalanza'
import type {
  FiltrosProducto,
  ProductoConRelaciones,
  ProductoEscaneado,
} from '@/lib/queries/productos'

const META_FECHA_CATALOGO = 'catalogo_actualizado_en'

/** Reemplaza el snapshot local con el catálogo recibido. */
export async function guardarCatalogo(
  productos: ProductoConRelaciones[]
): Promise<void> {
  await idbVaciar(STORE_CATALOGO)
  await idbGuardarLote(STORE_CATALOGO, productos)
  await metaGuardar(META_FECHA_CATALOGO, new Date().toISOString())
}

/** Devuelve el catálogo completo guardado offline. */
export async function leerCatalogo(): Promise<ProductoConRelaciones[]> {
  return idbObtenerTodo<ProductoConRelaciones>(STORE_CATALOGO)
}

/** Fecha ISO de la última vez que se guardó el catálogo, o null. */
export async function fechaCatalogo(): Promise<string | null> {
  return metaObtener<string>(META_FECHA_CATALOGO)
}

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/**
 * Aplica los mismos filtros que `getProductos` pero en memoria, sobre el
 * snapshot offline. Mantiene el orden por nombre.
 */
export function filtrarProductosLocal(
  productos: ProductoConRelaciones[],
  filtros: FiltrosProducto = {}
): ProductoConRelaciones[] {
  const busqueda = filtros.busqueda?.trim()
    ? normalizar(filtros.busqueda.trim())
    : null

  return productos
    .filter((p) => {
      if (busqueda) {
        const enNombre = normalizar(p.nombre).includes(busqueda)
        const enCodigo = (p.codigo_barras ?? '')
          .toLowerCase()
          .includes(busqueda)
        if (!enNombre && !enCodigo) return false
      }
      if (filtros.categoria_id != null && p.categoria_id !== filtros.categoria_id)
        return false
      if (filtros.proveedor_id != null && p.proveedor_id !== filtros.proveedor_id)
        return false
      if (filtros.tipo && p.tipo !== filtros.tipo) return false
      if (filtros.unidad && p.unidad !== filtros.unidad) return false
      if (filtros.activo !== undefined && p.activo !== filtros.activo)
        return false
      if (filtros.solo_vendibles && p.no_ofrecer_ventas) return false
      return true
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

/**
 * Resuelve un escaneo en el snapshot offline: código fijo (principal o
 * secundario) o etiqueta de balanza por PLU (mig 326), con la misma
 * preferencia que `buscarProductoEscaneado` (el código fijo exacto gana).
 * Un snapshot guardado antes de la 326 no tiene `plu_balanza`: la etiqueta
 * no resuelve hasta que el POS vuelva a cachear el catálogo con conexión.
 */
export async function buscarEscaneadoLocal(
  codigo: string,
  soloVendible = false
): Promise<ProductoEscaneado | null> {
  const productos = await leerCatalogo()
  const limpio = codigo.trim()
  const etiqueta = parsearCodigoBalanza(limpio)
  const candidatos = productos.filter(
    (p) =>
      (!soloVendible || !p.no_ofrecer_ventas) &&
      (p.codigo_barras === limpio ||
        p.codigo_barras_2 === limpio ||
        (etiqueta !== null && p.plu_balanza === etiqueta.plu))
  )
  return elegirProductoEscaneado(candidatos, limpio, etiqueta)
}
