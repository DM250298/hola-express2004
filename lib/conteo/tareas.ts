import type {
  ClaseConteo,
  ConteoZonaRow,
  CriteriosConteo,
  TipoConteoZona,
} from '@/types/database'
import type { TareaNueva } from '@/lib/queries/conteoFisico'

/**
 * Armado de tareas de conteo (migs 222 a 228): lo que la pantalla necesita
 * para nombrar, describir y mandar las tareas. Puro: sin red ni estado.
 * Cuántos productos le tocan a cada una NO se calcula acá: lo dice la base
 * (fn_conteo_previsualizar_tareas), con las mismas reglas que la creación.
 */

/** Una tarea todavía sin crear, como la arma el encargado. */
export interface TareaBorrador {
  /** Identificador local, solo para la lista de la pantalla. */
  clave: string
  nombre: string
  responsables: string[]
  /** null = zona libre (sin lista). */
  criterios: CriteriosConteo | null
}

export const CLASES_CONTEO: { clave: ClaseConteo; etiqueta: string; ayuda: string }[] = [
  { clave: 'A', etiqueta: 'A', ayuda: 'Los que más facturan (80 % de la venta)' },
  { clave: 'B', etiqueta: 'B', ayuda: 'Los del medio (siguiente 15 %)' },
  { clave: 'C', etiqueta: 'C', ayuda: 'Los que menos facturan (último 5 %)' },
  { clave: 'N', etiqueta: 'Sin ventas', ayuda: 'No se vendieron en los últimos 30 días' },
]

/**
 * Reglas de alerta que hablan del stock: son las que tiene sentido salir a
 * contar. Códigos de las migs 183 y 190; las demás (margen, vencimientos,
 * datos faltantes) no se arreglan contando.
 */
export const REGLAS_ALERTA_STOCK: { codigo: string; etiqueta: string }[] = [
  { codigo: 'stock_desfasado', etiqueta: 'El stock no coincide con la góndola' },
  { codigo: 'quiebre_clave', etiqueta: 'Productos clave sin stock' },
  { codigo: 'por_quebrar', etiqueta: 'Se quedan sin stock pronto' },
  { codigo: 'sobrestock', etiqueta: 'Stock de más' },
  { codigo: 'inmovilizado', etiqueta: 'Mercadería sin vender' },
]

/** Saca del criterio lo que no filtra nada (listas vacías, flags apagados). */
export function limpiarCriterios(c: CriteriosConteo): CriteriosConteo {
  const limpio: CriteriosConteo = {}
  if (c.ubicacion_ids?.length) limpio.ubicacion_ids = c.ubicacion_ids
  if (c.proveedor_ids?.length) limpio.proveedor_ids = c.proveedor_ids
  if (c.categoria_ids?.length) limpio.categoria_ids = c.categoria_ids
  if (c.marca_ids?.length) limpio.marca_ids = c.marca_ids
  if (c.clases_abc?.length) limpio.clases_abc = c.clases_abc
  if (c.reglas_alerta?.length) limpio.reglas_alerta = c.reglas_alerta
  if (c.sin_ubicar) limpio.sin_ubicar = true
  return limpio
}

export function criteriosVacios(c: CriteriosConteo | null): boolean {
  return c === null || Object.keys(limpiarCriterios(c)).length === 0
}

/**
 * Cómo se va a contar. Con un área se cuenta lo que se ve en ese lugar; sin
 * área, el total del producto en todo el local. Espejo de la mig 224.
 */
export function tipoDeCriterios(c: CriteriosConteo | null): TipoConteoZona | 'libre' {
  if (criteriosVacios(c)) return 'libre'
  return c?.ubicacion_ids?.length ? 'area' : 'lista'
}

/**
 * Tipo de una tarea ya creada. Tolera filas de una base sin la mig 222 (sin
 * las columnas nuevas): ahí toda zona es una zona libre.
 */
export function tipoDeZona(
  zona: Pick<ConteoZonaRow, 'tipo' | 'criterios'>
): TipoConteoZona | 'libre' {
  if (!zona.criterios) return 'libre'
  return zona.tipo === 'lista' ? 'lista' : 'area'
}

export const ETIQUETA_TIPO_TAREA: Record<TipoConteoZona | 'libre', string> = {
  area: 'Por área',
  lista: 'Lista',
  libre: 'Zona libre',
}

export const AYUDA_TIPO_TAREA: Record<TipoConteoZona | 'libre', string> = {
  area: 'Se cuenta lo que se ve en ese lugar.',
  lista: 'Se cuenta el total de cada producto en todo el local.',
  libre: 'Sin lista: se escanea lo que haya.',
}

/** Nombres para traducir los ids de un criterio a texto. */
export interface NombresCriterios {
  ubicaciones: Map<number, string>
  proveedores: Map<number, string>
  categorias: Map<number, string>
  marcas: Map<number, string>
}

function nombrar(ids: number[] | undefined, nombres: Map<number, string>): string[] {
  return (ids ?? []).map((id) => nombres.get(id) ?? `#${id}`)
}

/** Junta nombres sin hacer un título eterno: "Arcor, Bagley y 3 más". */
function resumir(partes: string[], maximo = 2): string {
  if (partes.length <= maximo) return partes.join(', ')
  return `${partes.slice(0, maximo).join(', ')} y ${partes.length - maximo} más`
}

/** Una etiqueta corta por cada criterio activo, para mostrar en la tarea. */
export function etiquetasCriterios(
  c: CriteriosConteo | null,
  nombres: NombresCriterios
): string[] {
  if (criteriosVacios(c) || !c) return []
  const etiquetas: string[] = []
  const areas = nombrar(c.ubicacion_ids, nombres.ubicaciones)
  if (areas.length) etiquetas.push(resumir(areas))
  const proveedores = nombrar(c.proveedor_ids, nombres.proveedores)
  if (proveedores.length) etiquetas.push(resumir(proveedores))
  const categorias = nombrar(c.categoria_ids, nombres.categorias)
  if (categorias.length) etiquetas.push(resumir(categorias))
  const marcas = nombrar(c.marca_ids, nombres.marcas)
  if (marcas.length) etiquetas.push(resumir(marcas))
  if (c.clases_abc?.length) {
    const clases = CLASES_CONTEO.filter((k) => c.clases_abc?.includes(k.clave))
    const letras = clases.filter((k) => k.clave !== 'N').map((k) => k.etiqueta)
    if (letras.length) etiquetas.push(`Clase ${letras.join(' y ')}`)
    if (c.clases_abc.includes('N')) etiquetas.push('Sin ventas')
  }
  if (c.reglas_alerta?.length) {
    etiquetas.push(
      c.reglas_alerta.length === 1
        ? (REGLAS_ALERTA_STOCK.find((r) => r.codigo === c.reglas_alerta?.[0])
            ?.etiqueta ?? 'Con alerta')
        : 'Con alerta'
    )
  }
  if (c.sin_ubicar) etiquetas.push('Sin ubicar en el mapa')
  return etiquetas
}

/** Nombre que se le propone a la tarea; el encargado lo puede cambiar. */
export function nombreSugerido(
  c: CriteriosConteo | null,
  nombres: NombresCriterios
): string {
  return etiquetasCriterios(c, nombres).join(' · ')
}

export function aTareasNuevas(borradores: TareaBorrador[]): TareaNueva[] {
  return borradores.map((b) => ({
    nombre: b.nombre.trim(),
    responsables: b.responsables,
    criterios: criteriosVacios(b.criterios)
      ? null
      : limpiarCriterios(b.criterios ?? {}),
  }))
}

let contador = 0
/** Clave local para un borrador (no viaja a la base). */
export function nuevaClave(): string {
  contador += 1
  return `tarea-${Date.now().toString(36)}-${contador}`
}

/** Agrupa una lista ya ordenada por lugar, conservando el orden de recorrido. */
export function agruparPorLugar<T extends { donde: string | null }>(
  lista: T[]
): { lugar: string; items: T[] }[] {
  const grupos: { lugar: string; items: T[] }[] = []
  const porLugar = new Map<string, { lugar: string; items: T[] }>()
  for (const item of lista) {
    const lugar = item.donde ?? 'Sin ubicar en el mapa'
    let grupo = porLugar.get(lugar)
    if (!grupo) {
      grupo = { lugar, items: [] }
      porLugar.set(lugar, grupo)
      grupos.push(grupo)
    }
    grupo.items.push(item)
  }
  return grupos
}
