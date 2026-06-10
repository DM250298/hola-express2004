import { createClient } from '@/lib/supabase/client'
import { costoDesdeEmbed, type CostoEmbed } from '@/lib/queries/productos'
import { convertir, esUnidadCanonica, type UnidadCanonica } from '@/lib/utils/unidades'
import type {
  EstadoOrdenProduccion,
  ItemOrdenProdRow,
  Json,
  OrdenProduccionRow,
  RecetaIngredienteRow,
  RecetaRow,
} from '@/types/database'

// ─── Tipos de retorno ──────────────────────────────────────────────────────────

export interface ProductoMini {
  id: number
  nombre: string
  unidad: string
}

export interface IngredienteConInsumo extends RecetaIngredienteRow {
  insumo: {
    id: number
    nombre: string
    unidad: string
    tipo: string
  } | null
}

export interface RecetaConProducto extends RecetaRow {
  producto: ProductoMini | null
}

export interface RecetaCompleta extends RecetaConProducto {
  ingredientes: IngredienteConInsumo[]
}

export interface OrdenConProducto extends OrdenProduccionRow {
  producto: ProductoMini | null
}

export interface ItemOrdenConInsumo extends ItemOrdenProdRow {
  insumo: ProductoMini | null
}

export interface OrdenCompleta extends OrdenConProducto {
  receta: RecetaRow | null
  items: ItemOrdenConInsumo[]
}

// ─── Productos para los selects/buscadores del módulo ───────────────────────────

export interface ProductoProduccion {
  id: number
  nombre: string
  codigo_barras: string | null
  unidad: string
  dimension: string
  tipo: string
  stock_actual: number
  precio_venta: number
  precio_costo: number
}

/**
 * Productos filtrados por tipo, para el buscador de insumos (insumo/semi) y el
 * selector de producto a elaborar (semi/elaborado). Trae costo vía embed gateado.
 */
export async function getProductosProduccion(
  tipos: string[],
  busqueda?: string
): Promise<ProductoProduccion[]> {
  const supabase = createClient()
  let query = supabase
    .from('productos')
    .select(
      'id, nombre, codigo_barras, unidad, dimension, tipo, stock_actual, precio_venta, costos_producto(precio_costo)'
    )
    .in('tipo', tipos)
    .eq('activo', true)
    .order('nombre', { ascending: true })

  if (busqueda && busqueda.trim()) {
    query = query.ilike('nombre', `%${busqueda.trim()}%`)
  }

  const { data, error } = await query
  if (error) throw error

  type Fila = {
    id: number
    nombre: string
    codigo_barras: string | null
    unidad: string
    dimension: string
    tipo: string
    stock_actual: number
    precio_venta: number
    costos_producto: CostoEmbed
  }

  return ((data ?? []) as unknown as Fila[]).map(({ costos_producto, ...p }) => ({
    ...p,
    precio_costo: costoDesdeEmbed(costos_producto),
  }))
}

// ─── Recetas ────────────────────────────────────────────────────────────────────

export async function getRecetas(): Promise<RecetaConProducto[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('recetas')
    .select('*, productos(id, nombre, unidad)')
    .eq('activa', true)
    .order('id', { ascending: false })

  if (error) throw error

  type Fila = RecetaRow & { productos: ProductoMini | null }
  return ((data ?? []) as unknown as Fila[]).map(({ productos, ...resto }) => ({
    ...resto,
    producto: productos,
  }))
}

export async function getRecetaDeProducto(
  productoId: number
): Promise<RecetaCompleta | null> {
  const supabase = createClient()

  const { data: receta, error } = await supabase
    .from('recetas')
    .select('*, productos(id, nombre, unidad)')
    .eq('producto_id', productoId)
    .maybeSingle()

  if (error) throw error
  if (!receta) return null

  type RecetaCruda = RecetaRow & { productos: ProductoMini | null }
  const r = receta as unknown as RecetaCruda

  const { data: ings, error: errIngs } = await supabase
    .from('receta_ingredientes')
    .select('*, productos:insumo_id(id, nombre, unidad, tipo)')
    .eq('receta_id', r.id)
    .order('id', { ascending: true })

  if (errIngs) throw errIngs

  type IngCrudo = RecetaIngredienteRow & {
    productos: { id: number; nombre: string; unidad: string; tipo: string } | null
  }

  const ingredientes: IngredienteConInsumo[] = (
    (ings ?? []) as unknown as IngCrudo[]
  ).map(({ productos, ...resto }) => ({ ...resto, insumo: productos }))

  const { productos, ...resto } = r
  return { ...resto, producto: productos, ingredientes }
}

export interface IngredientePayload {
  insumo_id: number
  cantidad: number
  unidad: string
  merma_pct: number
}

export interface GuardarRecetaPayload {
  producto_id: number
  rendimiento: number
  unidad_rendimiento: string
  vida_util_dias: number
  activa?: boolean
  ingredientes: IngredientePayload[]
}

/** Insumos directos de la receta de un producto (o [] si no tiene receta activa). */
async function insumosDeReceta(
  supabase: ReturnType<typeof createClient>,
  productoId: number
): Promise<number[]> {
  const { data: receta } = await supabase
    .from('recetas')
    .select('id')
    .eq('producto_id', productoId)
    .eq('activa', true)
    .maybeSingle()
  if (!receta) return []
  const { data: ings } = await supabase
    .from('receta_ingredientes')
    .select('insumo_id')
    .eq('receta_id', (receta as { id: number }).id)
  return ((ings ?? []) as { insumo_id: number }[]).map((i) => i.insumo_id)
}

/** True si la receta de `desde` alcanza (transitivamente) a `objetivo`: habría ciclo. */
async function recetaAlcanza(
  supabase: ReturnType<typeof createClient>,
  desde: number,
  objetivo: number,
  visto: Set<number> = new Set()
): Promise<boolean> {
  if (desde === objetivo) return true
  if (visto.has(desde)) return false
  visto.add(desde)
  const hijos = await insumosDeReceta(supabase, desde)
  for (const h of hijos) {
    if (await recetaAlcanza(supabase, h, objetivo, visto)) return true
  }
  return false
}

/**
 * Crea o reemplaza la receta de un producto (una receta viva por producto).
 * Valida anti-ciclo (ningún ingrediente puede usar, directa o transitivamente,
 * al producto que se está editando). El trigger del servidor valida además que
 * unidad_rendimiento == productos.unidad del producido.
 */
export async function guardarReceta(
  payload: GuardarRecetaPayload
): Promise<RecetaRow> {
  const supabase = createClient()

  if (payload.ingredientes.length === 0) {
    throw new Error('La receta necesita al menos un ingrediente.')
  }

  // Validación anti-ciclo (antes de escribir nada).
  for (const ing of payload.ingredientes) {
    if (ing.insumo_id === payload.producto_id) {
      throw new Error('Un producto no puede ser ingrediente de su propia receta.')
    }
    if (await recetaAlcanza(supabase, ing.insumo_id, payload.producto_id)) {
      throw new Error(
        'Receta circular: uno de los ingredientes usa (directa o indirectamente) al producto que estás elaborando.'
      )
    }
  }

  const { data: receta, error } = await supabase
    .from('recetas')
    .upsert(
      {
        producto_id: payload.producto_id,
        rendimiento: payload.rendimiento,
        unidad_rendimiento: payload.unidad_rendimiento,
        vida_util_dias: payload.vida_util_dias,
        activa: payload.activa ?? true,
      },
      { onConflict: 'producto_id' }
    )
    .select()
    .single<RecetaRow>()

  if (error) throw error

  // Reemplaza los ingredientes (borra y reinserta).
  const { error: errDel } = await supabase
    .from('receta_ingredientes')
    .delete()
    .eq('receta_id', receta.id)
  if (errDel) throw errDel

  const insert = payload.ingredientes.map((ing) => ({
    receta_id: receta.id,
    insumo_id: ing.insumo_id,
    cantidad: ing.cantidad,
    unidad: ing.unidad,
    merma_pct: ing.merma_pct,
  }))
  const { error: errIns } = await supabase
    .from('receta_ingredientes')
    .insert(insert)
  if (errIns) {
    throw new Error(
      `Receta #${receta.id} guardada pero faltan ingredientes: ${errIns.message}`
    )
  }

  return receta
}

/** Costo unitario teórico de la receta (recursivo) vía fn_costo_receta. */
export async function previewCostoReceta(productoId: number): Promise<number> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_costo_receta', {
    p_producto_id: productoId,
  })
  if (error) throw error
  return Number(data ?? 0)
}

// ─── Disponibilidad de insumos (preview de una orden) ───────────────────────────

export interface DisponibilidadInsumo {
  insumo_id: number
  nombre: string
  unidad_receta: string
  unidad_stock: string
  necesario: number
  stock_actual: number
  alcanza: boolean
}

/** Convierte la cantidad de receta a la unidad de stock del insumo (best-effort). */
function aUnidadStock(cantidad: number, desde: string, hacia: string): number {
  if (desde === hacia) return cantidad
  if (esUnidadCanonica(desde) && esUnidadCanonica(hacia)) {
    try {
      return convertir(cantidad, desde as UnidadCanonica, hacia as UnidadCanonica)
    } catch {
      return cantidad
    }
  }
  return cantidad
}

/**
 * Explota la receta para una cantidad planificada y compara lo necesario contra
 * el stock de cada insumo. Sirve para la tabla de disponibilidad del asistente.
 */
export async function getDisponibilidadInsumos(
  recetaId: number,
  cantidadPlanificada: number
): Promise<DisponibilidadInsumo[]> {
  const supabase = createClient()

  const { data: receta, error: errR } = await supabase
    .from('recetas')
    .select('rendimiento')
    .eq('id', recetaId)
    .maybeSingle()
  if (errR) throw errR
  if (!receta) return []

  const rendimiento = (receta as { rendimiento: number }).rendimiento
  const factor = rendimiento > 0 ? cantidadPlanificada / rendimiento : 0

  const { data: ings, error: errI } = await supabase
    .from('receta_ingredientes')
    .select('insumo_id, cantidad, unidad, merma_pct, productos:insumo_id(nombre, unidad, stock_actual)')
    .eq('receta_id', recetaId)
  if (errI) throw errI

  type Fila = {
    insumo_id: number
    cantidad: number
    unidad: string
    merma_pct: number
    productos: { nombre: string; unidad: string; stock_actual: number } | null
  }

  return ((ings ?? []) as unknown as Fila[]).map((ing) => {
    const unidadStock = ing.productos?.unidad ?? ing.unidad
    const stock = ing.productos?.stock_actual ?? 0
    const necesarioReceta = ing.cantidad * factor * (1 + ing.merma_pct / 100)
    const necesario = aUnidadStock(necesarioReceta, ing.unidad, unidadStock)
    return {
      insumo_id: ing.insumo_id,
      nombre: ing.productos?.nombre ?? 'Insumo eliminado',
      unidad_receta: ing.unidad,
      unidad_stock: unidadStock,
      necesario,
      stock_actual: stock,
      alcanza: stock >= necesario,
    }
  })
}

// ─── Órdenes de producción ──────────────────────────────────────────────────────

export interface FiltrosOrdenes {
  estado?: EstadoOrdenProduccion | null
}

export async function getOrdenes(
  filtros: FiltrosOrdenes = {}
): Promise<OrdenConProducto[]> {
  const supabase = createClient()
  let query = supabase
    .from('ordenes_produccion')
    .select('*, productos(id, nombre, unidad)')
    .order('id', { ascending: false })

  if (filtros.estado) query = query.eq('estado', filtros.estado)

  const { data, error } = await query
  if (error) throw error

  type Fila = OrdenProduccionRow & { productos: ProductoMini | null }
  return ((data ?? []) as unknown as Fila[]).map(({ productos, ...resto }) => ({
    ...resto,
    producto: productos,
  }))
}

export async function getOrdenDetalle(id: number): Promise<OrdenCompleta | null> {
  const supabase = createClient()

  const { data: orden, error } = await supabase
    .from('ordenes_produccion')
    .select('*, productos(id, nombre, unidad), recetas(*)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!orden) return null

  type OrdenCruda = OrdenProduccionRow & {
    productos: ProductoMini | null
    recetas: RecetaRow | null
  }
  const o = orden as unknown as OrdenCruda

  const { data: items, error: errItems } = await supabase
    .from('items_orden_prod')
    .select('*, productos:insumo_id(id, nombre, unidad)')
    .eq('orden_id', id)
    .order('id', { ascending: true })
  if (errItems) throw errItems

  type ItemCrudo = ItemOrdenProdRow & { productos: ProductoMini | null }
  const itemsList: ItemOrdenConInsumo[] = (
    (items ?? []) as unknown as ItemCrudo[]
  ).map(({ productos, ...resto }) => ({ ...resto, insumo: productos }))

  const { productos, recetas, ...resto } = o
  return {
    ...resto,
    producto: productos,
    receta: recetas,
    items: itemsList,
  }
}

export interface NuevaOrdenPayload {
  producto_id: number
  receta_id: number
  cantidad_planificada: number
  usuario_id: string
  nota?: string | null
}

export async function crearOrden(
  payload: NuevaOrdenPayload
): Promise<OrdenProduccionRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('ordenes_produccion')
    .insert({
      producto_id: payload.producto_id,
      receta_id: payload.receta_id,
      cantidad_planificada: payload.cantidad_planificada,
      usuario_id: payload.usuario_id,
      estado: 'borrador',
      nota: payload.nota ?? null,
    })
    .select()
    .single<OrdenProduccionRow>()

  if (error) throw error
  return data
}

export interface ResultadoIniciar {
  orden_id: number
  costo_total: number
}

export async function iniciarOrden(
  orden_id: number,
  usuario_id: string
): Promise<ResultadoIniciar> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_iniciar_orden_produccion', {
    p_orden_id: orden_id,
    p_usuario_id: usuario_id,
  })
  if (error) throw error
  if (!data) throw new Error('No se pudo iniciar la orden.')
  return data as unknown as ResultadoIniciar
}

export interface ResultadoCerrar {
  orden_id: number
  lote_id: number | null
  costo_unitario: number
  merma: number
}

export async function cerrarOrden(
  orden_id: number,
  cantidad_producida: number,
  usuario_id: string
): Promise<ResultadoCerrar> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_cerrar_orden_produccion', {
    p_orden_id: orden_id,
    p_cantidad_producida: cantidad_producida,
    p_usuario_id: usuario_id,
  })
  if (error) throw error
  if (!data) throw new Error('No se pudo cerrar la orden.')
  return data as unknown as ResultadoCerrar
}

export interface ResultadoCancelar {
  orden_id: number
  estado: string
}

export async function cancelarOrden(
  orden_id: number,
  usuario_id: string
): Promise<ResultadoCancelar> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_cancelar_orden_produccion', {
    p_orden_id: orden_id,
    p_usuario_id: usuario_id,
  })
  if (error) throw error
  if (!data) throw new Error('No se pudo cancelar la orden.')
  return data as unknown as ResultadoCancelar
}

/** Genera órdenes en borrador para los elaborados/semi bajo el mínimo. Devuelve cuántas creó. */
export async function generarReposicion(): Promise<number> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_generar_ordenes_reposicion')
  if (error) throw error
  return Number(data ?? 0)
}
