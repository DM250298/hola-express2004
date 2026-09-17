import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
import type {
  TipoMueble,
  TipoUbicacion,
  UbicacionInsert,
  UbicacionRow,
  UbicacionUpdate,
} from '@/types/database'

/**
 * Mapa del local (mig 170): árbol de ubicaciones + asignación de productos.
 * Convención de fallbacks: si la migración 170 no corrió, las lecturas
 * devuelven `null` (PGRST205 = tabla fuera del schema cache) y la UI
 * muestra el aviso de migración pendiente, patrón del Centro de Compras.
 */

/** Tipos de hijo válidos por tipo de nodo (espejo del trigger de la 170). */
export const TIPOS_HIJO: Record<TipoUbicacion, TipoUbicacion[]> = {
  sucursal: ['sector'],
  sector: ['gondola'],
  // Góndola › módulo (divisor) › estante, o estantes directos si no tiene divisores.
  gondola: ['modulo', 'estante'],
  modulo: ['estante'],
  estante: [],
}

export const ETIQUETA_TIPO: Record<TipoUbicacion, string> = {
  sucursal: 'Sucursal',
  sector: 'Sector',
  gondola: 'Góndola',
  modulo: 'Módulo',
  estante: 'Estante',
}

export const ETIQUETA_MUEBLE: Record<TipoMueble, string> = {
  gondola: 'Góndola',
  isla: 'Isla',
  heladera: 'Heladera',
  freezer: 'Freezer',
  mostrador: 'Mostrador',
  exhibidor: 'Exhibidor',
  estanteria: 'Estantería',
  mesa: 'Mesa',
}

/** Frío = heladeras y freezers (para el filtro del mapa). */
export function esFrio(m: TipoMueble | null | undefined): boolean {
  return m === 'heladera' || m === 'freezer'
}

/**
 * Valor efectivo de un campo heredable (categoría, marca, responsable): el
 * del nodo, o el del ancestro más cercano que lo tenga.
 */
export function heredado<K extends 'categoria_id' | 'marca_exclusiva_id' | 'responsable_id'>(
  id: number,
  planas: UbicacionRow[],
  campo: K
): UbicacionRow[K] | null {
  const porId = new Map(planas.map((u) => [u.id, u]))
  let actual = porId.get(id)
  let guarda = 0
  while (actual && guarda < 10) {
    if (actual[campo] != null) return actual[campo]
    actual = actual.parent_id != null ? porId.get(actual.parent_id) : undefined
    guarda++
  }
  return null
}

export interface NodoUbicacion extends UbicacionRow {
  hijos: NodoUbicacion[]
  /** Productos con ubicación PRINCIPAL exactamente en este nodo. */
  productos_directos: number
  /** Productos directos + los de todos los descendientes. */
  productos_total: number
}

export interface ArbolUbicaciones {
  raices: NodoUbicacion[]
  /** Todas las filas planas, para selects. */
  planas: UbicacionRow[]
  /** Productos activos con ubicación principal asignada. */
  productos_ubicados: number
  /** Total de productos activos. */
  productos_activos: number
}

function esTablaFaltante(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code
  return code === 'PGRST205' || code === '42P01'
}

/** Árbol completo + conteo de productos por nodo + avance del mapeo. */
export async function getArbolUbicaciones(): Promise<ArbolUbicaciones | null> {
  const supabase = createClient()
  try {
    const [filas, asignaciones, activos] = await Promise.all([
      traerTodo<UbicacionRow>(() =>
        supabase
          .from('ubicaciones')
          .select('*')
          .order('orden')
          .order('nombre')
          .order('id')
      ),
      traerTodo<{ ubicacion_id: number; producto_id: number }>(() =>
        supabase
          .from('producto_ubicacion')
          .select('ubicacion_id, producto_id, productos!inner(activo)')
          .eq('es_principal', true)
          .eq('productos.activo', true)
          .order('id')
      ),
      supabase
        .from('productos')
        .select('id', { count: 'exact', head: true })
        .eq('activo', true),
    ])
    if (activos.error) throw new Error(activos.error.message)

    const directos = new Map<number, number>()
    for (const a of asignaciones) {
      directos.set(a.ubicacion_id, (directos.get(a.ubicacion_id) ?? 0) + 1)
    }

    const nodos = new Map<number, NodoUbicacion>()
    for (const f of filas) {
      nodos.set(f.id, {
        ...f,
        hijos: [],
        productos_directos: directos.get(f.id) ?? 0,
        productos_total: 0,
      })
    }
    const raices: NodoUbicacion[] = []
    for (const n of nodos.values()) {
      if (n.parent_id != null && nodos.has(n.parent_id)) {
        nodos.get(n.parent_id)!.hijos.push(n)
      } else {
        raices.push(n)
      }
    }
    const acumular = (n: NodoUbicacion): number => {
      n.productos_total =
        n.productos_directos + n.hijos.reduce((s, h) => s + acumular(h), 0)
      return n.productos_total
    }
    raices.forEach(acumular)

    return {
      raices,
      planas: filas,
      productos_ubicados: asignaciones.length,
      productos_activos: activos.count ?? 0,
    }
  } catch (e) {
    if (esTablaFaltante(e)) return null
    throw e
  }
}

/** Ruta legible de un nodo ("Salón › Góndola 4 › Estante 2"). */
export function rutaUbicacion(
  id: number,
  planas: UbicacionRow[],
  separador = ' › '
): string {
  const porId = new Map(planas.map((u) => [u.id, u]))
  const partes: string[] = []
  let actual = porId.get(id)
  let guarda = 0
  while (actual && guarda < 10) {
    // La sucursal raíz no aporta al nombre en mono-local.
    if (actual.tipo !== 'sucursal') partes.unshift(actual.nombre)
    actual = actual.parent_id != null ? porId.get(actual.parent_id) : undefined
    guarda++
  }
  return partes.join(separador)
}

export async function crearUbicacion(datos: UbicacionInsert): Promise<UbicacionRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('ubicaciones')
    .insert(datos)
    .select('*')
    .single<UbicacionRow>()
  if (error) throw new Error(error.message)
  return data
}

export async function actualizarUbicacion(
  id: number,
  datos: UbicacionUpdate
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('ubicaciones').update(datos).eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Elimina un nodo. Falla con mensaje claro si tiene hijos (FK restrict);
 * las asignaciones producto↔nodo se borran en cascada.
 */
export async function eliminarUbicacion(id: number): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('ubicaciones').delete().eq('id', id)
  if (error) {
    if (error.code === '23503') {
      throw new Error(
        'Esta ubicación tiene ubicaciones adentro: movelas o eliminalas primero.'
      )
    }
    throw new Error(error.message)
  }
}

// ─── Ubicaciones de un producto ──────────────────────────────────────────────

export interface UbicacionDeProducto {
  id: number
  ubicacion_id: number
  es_principal: boolean
  orden: number
}

export async function getUbicacionesProducto(
  productoId: number
): Promise<UbicacionDeProducto[] | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('producto_ubicacion')
    .select('id, ubicacion_id, es_principal, orden')
    .eq('producto_id', productoId)
    .order('es_principal', { ascending: false })
    .order('id')
  if (error) {
    if (esTablaFaltante(error)) return null
    throw new Error(error.message)
  }
  return (data ?? []) as UbicacionDeProducto[]
}

/**
 * Fija la ubicación PRINCIPAL de un producto (la de venta, a la que se
 * atribuye el análisis por góndola). Dos pasos: baja la principal anterior
 * y sube la nueva (upsert por si el producto ya estaba en ese nodo como
 * secundaria). El índice único parcial de la 170 garantiza que nunca
 * queden dos principales aunque este flujo se corte en el medio.
 */
export async function asignarUbicacionPrincipal(
  productoId: number,
  ubicacionId: number
): Promise<void> {
  const supabase = createClient()
  const { error: e1 } = await supabase
    .from('producto_ubicacion')
    .update({ es_principal: false })
    .eq('producto_id', productoId)
    .eq('es_principal', true)
  if (e1) throw new Error(e1.message)

  const { error: e2 } = await supabase
    .from('producto_ubicacion')
    .upsert(
      { producto_id: productoId, ubicacion_id: ubicacionId, es_principal: true },
      { onConflict: 'producto_id,ubicacion_id' }
    )
  if (e2) throw new Error(e2.message)
}

/** Agrega una ubicación SECUNDARIA (depósito, heladera de apoyo, etc.). */
export async function agregarUbicacionSecundaria(
  productoId: number,
  ubicacionId: number
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('producto_ubicacion').upsert(
    { producto_id: productoId, ubicacion_id: ubicacionId, es_principal: false },
    { onConflict: 'producto_id,ubicacion_id', ignoreDuplicates: true }
  )
  if (error) throw new Error(error.message)
}

export async function quitarUbicacionProducto(filaId: number): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('producto_ubicacion')
    .delete()
    .eq('id', filaId)
  if (error) throw new Error(error.message)
}

// ─── Asignar desde el mapa (escritorio) ──────────────────────────────────────

export interface ProductoUbicable {
  id: number
  nombre: string
  codigo_barras: string | null
}

/** Buscador del modal "Asignar productos": nombre o código, activos, top 10. */
export async function buscarProductosUbicables(
  termino: string
): Promise<ProductoUbicable[]> {
  const t = termino.trim().replace(/[,()]/g, ' ')
  if (t.length < 2) return []
  const supabase = createClient()
  const { data, error } = await supabase
    .from('productos')
    .select('id, nombre, codigo_barras')
    .eq('activo', true)
    .or(`nombre.ilike.%${t}%,codigo_barras.ilike.%${t}%`)
    .order('nombre')
    .limit(10)
  if (error) throw new Error(error.message)
  return (data ?? []) as ProductoUbicable[]
}

/**
 * Ubica un producto en un nodo con la misma regla que el escaneo móvil:
 * PRINCIPAL si no tenía ninguna ubicación, si no SECUNDARIA.
 */
export async function asignarAUbicacion(
  productoId: number,
  ubicacionId: number
): Promise<'principal' | 'secundaria' | 'ya estaba'> {
  const filas = (await getUbicacionesProducto(productoId)) ?? []
  if (filas.some((f) => f.ubicacion_id === ubicacionId)) return 'ya estaba'
  if (!filas.some((f) => f.es_principal)) {
    await asignarUbicacionPrincipal(productoId, ubicacionId)
    return 'principal'
  }
  await agregarUbicacionSecundaria(productoId, ubicacionId)
  return 'secundaria'
}

/** Saca un producto de una ubicación puntual. */
export async function quitarProductoDeUbicacion(
  productoId: number,
  ubicacionId: number
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('producto_ubicacion')
    .delete()
    .eq('producto_id', productoId)
    .eq('ubicacion_id', ubicacionId)
  if (error) throw new Error(error.message)
}
