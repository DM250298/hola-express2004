import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
import type {
  ConteoAvanceRow,
  ConteoCoberturaRow,
  ConteoDetalleRow,
  ConteoDiferenciaRow,
  ConteoSesionRow,
  ConteoTareaResultado,
  ConteoVistaPrevia,
  ConteoZonaRow,
  CriteriosConteo,
  Json,
  ResumenCierreConteo,
} from '@/types/database'

// ─── Lecturas ────────────────────────────────────────────────────────────────

export async function getSesionesConteo(): Promise<ConteoSesionRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('conteo_sesiones')
    .select('*')
    .order('ts_apertura', { ascending: false })
    .limit(30)
  if (error) throw error
  return data ?? []
}

/** Sesión viva (abierta o en revisión). Null si no hay conteo en curso. */
export async function getSesionConteoActiva(): Promise<ConteoSesionRow | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('conteo_sesiones')
    .select('*')
    .neq('estado', 'cerrada')
    .maybeSingle()
  if (error) throw error
  return data
}

export async function getSesionConteo(
  sesionId: number
): Promise<ConteoSesionRow | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('conteo_sesiones')
    .select('*')
    .eq('id', sesionId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function getZonasSesion(
  sesionId: number
): Promise<ConteoZonaRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('conteo_zonas')
    .select('*')
    .eq('sesion_id', sesionId)
    .order('orden', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw error
  return data ?? []
}

export interface ZonaConSesion {
  zona: ConteoZonaRow
  sesion: ConteoSesionRow | null
}

/**
 * Zona + su sesión. Para un empleado la sesión viene null si ya está cerrada
 * (la RLS solo le muestra sesiones vivas) — la UI lo trata como "terminada".
 */
export async function getZonaConteo(zonaId: number): Promise<ZonaConSesion | null> {
  const supabase = createClient()
  const { data: zona, error } = await supabase
    .from('conteo_zonas')
    .select('*')
    .eq('id', zonaId)
    .maybeSingle()
  if (error) throw error
  if (!zona) return null
  const { data: sesion, error: errorSesion } = await supabase
    .from('conteo_sesiones')
    .select('*')
    .eq('id', zona.sesion_id)
    .maybeSingle()
  if (errorSesion) throw errorSesion
  return { zona, sesion }
}

export type ConteoDetalleConProducto = ConteoDetalleRow & {
  productos: { nombre: string; venta_por_peso: boolean } | null
}

export async function getConteosZona(
  zonaId: number
): Promise<ConteoDetalleConProducto[]> {
  const supabase = createClient()
  // Paginado: una zona grande puede superar el corte de 1000 filas de
  // PostgREST. Orden secundario por id para que las páginas sean estables.
  const PAGINA = 1000
  const filas: ConteoDetalleConProducto[] = []
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await supabase
      .from('conteo_detalle')
      .select('*, productos(nombre, venta_por_peso)')
      .eq('zona_id', zonaId)
      .order('ts', { ascending: false })
      .order('id', { ascending: false })
      .range(desde, desde + PAGINA - 1)
    if (error) throw error
    const pagina = (data ?? []) as ConteoDetalleConProducto[]
    filas.push(...pagina)
    if (pagina.length < PAGINA) break
  }
  return filas
}

/** Cantidad de renglones contados por zona (para el avance del dashboard). */
export async function getItemsPorZona(
  sesionId: number
): Promise<Record<number, number>> {
  const supabase = createClient()
  const { data: zonas, error: errorZonas } = await supabase
    .from('conteo_zonas')
    .select('id')
    .eq('sesion_id', sesionId)
  if (errorZonas) throw errorZonas
  const ids = (zonas ?? []).map((z) => z.id)
  if (ids.length === 0) return {}
  // count head por zona: no trae filas (inmune al corte de 1000 de PostgREST)
  // y las zonas de una sesión son pocas.
  const conteos = await Promise.all(
    ids.map(async (zonaId) => {
      const { count, error } = await supabase
        .from('conteo_detalle')
        .select('id', { count: 'exact', head: true })
        .eq('zona_id', zonaId)
        .eq('es_reconteo', false)
      if (error) throw error
      return [zonaId, count ?? 0] as const
    })
  )
  return Object.fromEntries(conteos)
}

// ─── Búsqueda de productos para la pantalla de conteo ────────────────────────
// Selección mínima a propósito: la pantalla del empleado es CIEGA, acá no se
// pide stock ni precios — solo lo necesario para identificar el producto y
// saber en qué unidad se cuenta (kg o unidades).

export interface ProductoConteo {
  id: number
  nombre: string
  codigo_barras: string | null
  /** true = se cuenta en kg: la cantidad admite hasta 3 decimales. */
  venta_por_peso: boolean
}

export async function buscarProductosParaConteo(
  termino: string
): Promise<ProductoConteo[]> {
  const supabase = createClient()
  const q = termino.trim()
  if (!q) return []
  const patron = `%${q.replaceAll(',', ' ')}%`
  const { data, error } = await supabase
    .from('productos')
    .select('id, nombre, codigo_barras, venta_por_peso')
    .eq('activo', true)
    .eq('controlar_stock', true)
    .or(`nombre.ilike.${patron},codigo_barras.ilike.${patron}`)
    .order('nombre', { ascending: true })
    .limit(10)
  if (error) throw error
  return data ?? []
}

export async function getProductoConteoPorCodigo(
  codigo: string
): Promise<ProductoConteo | null> {
  const supabase = createClient()
  const cod = codigo.trim()
  if (!cod) return null
  const { data, error } = await supabase
    .from('productos')
    .select('id, nombre, codigo_barras, venta_por_peso')
    .eq('activo', true)
    .or(`codigo_barras.eq.${cod},codigo_barras_2.eq.${cod}`)
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

// ─── RPCs (todas las escrituras pasan por acá) ───────────────────────────────

/**
 * Una tarea a crear (migs 222 a 228). Con `criterios` lleva lista: por área
 * se cuenta lo que se ve en el lugar; sin área, el total del producto en todo
 * el local. Sin `criterios` es una zona libre: se escanea lo que haya.
 */
export interface TareaNueva {
  nombre: string
  /**
   * Quién cuenta. Con más de uno, la lista se reparte en tramos seguidos del
   * recorrido (una tarea por persona). Vacío = la toma quien la inicie.
   */
  responsables: string[]
  criterios: CriteriosConteo | null
  /**
   * Ancla opcional de una zona libre al árbol físico (migs 170/175/176): al
   * cerrarla, lo contado se ubica ahí. Las tareas por área se anclan solas.
   */
  ubicacion_id?: number | null
}

export interface AbrirSesionPayload {
  nombre: string
  umbral: number
  zonas: TareaNueva[]
  notas?: string | null
}

/**
 * `responsable_user_id` viaja además de `responsables` para que una base sin
 * las migraciones 222+ (que solo conoce el campo único) siga asignando bien.
 */
function aPayloadZonas(zonas: TareaNueva[]): Json {
  return zonas.map((z, i) => ({
    nombre: z.nombre,
    responsables: z.responsables,
    responsable_user_id: z.responsables[0] ?? null,
    criterios: z.criterios,
    ubicacion_id: z.ubicacion_id ?? null,
    orden: i,
  })) as unknown as Json
}

export async function abrirSesionConteo(
  payload: AbrirSesionPayload
): Promise<ConteoSesionRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_abrir_sesion_conteo', {
    p_nombre: payload.nombre,
    p_umbral: payload.umbral,
    p_zonas: aPayloadZonas(payload.zonas),
    p_notas: payload.notas ?? null,
  })
  if (error) throw error
  return data as ConteoSesionRow
}

// ─── Tareas con alcance (migs 222 a 228) ─────────────────────────────────────
// Convención del repo: si la migración no corrió, las lecturas devuelven
// `null` y la pantalla avisa (o cae al comportamiento anterior) en vez de
// romper.

function faltaMigracion(error: { code?: string } | null | undefined): boolean {
  return (
    error?.code === 'PGRST202' ||
    error?.code === 'PGRST205' ||
    error?.code === '42P01' ||
    error?.code === '42883'
  )
}

/**
 * Cuántos productos le tocan a cada tarea, antes de crearlas. La cuenta la
 * hace la base con las mismas reglas que la creación (lo que ya es de otra
 * tarea no entra), así el número es exactamente el que se va a crear.
 */
export async function previsualizarTareas(
  zonas: TareaNueva[]
): Promise<ConteoVistaPrevia | null> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_conteo_previsualizar_tareas', {
    p_zonas: aPayloadZonas(zonas),
  })
  if (error) {
    if (faltaMigracion(error)) return null
    throw new Error(error.message)
  }
  return data as unknown as ConteoVistaPrevia
}

export async function agregarTareasConteo(payload: {
  sesion_id: number
  zonas: TareaNueva[]
}): Promise<ConteoTareaResultado[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_agregar_tareas_conteo', {
    p_sesion_id: payload.sesion_id,
    p_zonas: aPayloadZonas(payload.zonas),
  })
  if (error) throw error
  return (data ?? []) as unknown as ConteoTareaResultado[]
}

export async function reasignarTareaConteo(payload: {
  zona_id: number
  responsable: string | null
}): Promise<ConteoZonaRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_reasignar_tarea_conteo', {
    p_zona_id: payload.zona_id,
    p_responsable: payload.responsable,
  })
  if (error) throw error
  return data as ConteoZonaRow
}

export async function quitarTareaConteo(zonaId: number): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_quitar_tarea_conteo', {
    p_zona_id: zonaId,
  })
  if (error) throw error
}

/** Vuelve una sesión de "en revisión" a "abierta" para seguir contando. */
export async function reabrirSesionConteo(
  sesionId: number
): Promise<ConteoSesionRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_reabrir_sesion_conteo', {
    p_sesion_id: sesionId,
  })
  if (error) throw error
  return data as ConteoSesionRow
}

/** Avance por tarea. `null` = migración 227 pendiente. */
export async function getAvanceConteo(
  sesionId: number
): Promise<Record<number, ConteoAvanceRow> | null> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_conteo_avance', {
    p_sesion_id: sesionId,
  })
  if (error) {
    if (faltaMigracion(error)) return null
    throw new Error(error.message)
  }
  const filas = (data ?? []) as ConteoAvanceRow[]
  return Object.fromEntries(filas.map((f) => [f.zona_id, f]))
}

/**
 * Productos contados a medias: viven en un lugar que nadie contó.
 * `null` = migración 228 pendiente.
 */
export async function getCoberturaConteo(
  sesionId: number
): Promise<ConteoCoberturaRow[] | null> {
  const supabase = createClient()
  try {
    return await traerTodo<ConteoCoberturaRow>(() =>
      supabase.rpc('fn_conteo_cobertura', { p_sesion_id: sesionId })
    )
  } catch (e) {
    if (faltaMigracion(e as { code?: string })) return null
    throw e
  }
}

export interface ProductoDeLista {
  producto_id: number
  orden: number
  /** Dónde está según el mapa. NULL = sin ubicar. */
  donde: string | null
  nombre: string
  codigo_barras: string | null
  venta_por_peso: boolean
}

/**
 * La lista de una tarea, en orden de recorrido. Vacía = zona libre (o
 * migración 222 pendiente): se escanea lo que haya, como siempre. Igual que
 * la búsqueda, no pide stock ni precios: la pantalla del empleado es ciega.
 */
export async function getListaTarea(zonaId: number): Promise<ProductoDeLista[]> {
  const supabase = createClient()
  type Fila = {
    producto_id: number
    orden: number
    donde: string | null
    productos: {
      nombre: string
      codigo_barras: string | null
      venta_por_peso: boolean
    } | null
  }
  try {
    const filas = await traerTodo<Fila>(() =>
      supabase
        .from('conteo_zona_productos')
        .select(
          'producto_id, orden, donde, productos(nombre, codigo_barras, venta_por_peso)'
        )
        .eq('zona_id', zonaId)
        .order('orden', { ascending: true })
        .order('producto_id', { ascending: true })
    )
    return filas.map((f) => ({
      producto_id: f.producto_id,
      orden: f.orden,
      donde: f.donde,
      nombre: f.productos?.nombre ?? `Producto #${f.producto_id}`,
      codigo_barras: f.productos?.codigo_barras ?? null,
      venta_por_peso: f.productos?.venta_por_peso ?? false,
    }))
  } catch (e) {
    if (faltaMigracion(e as { code?: string })) return []
    throw e
  }
}

export async function iniciarZona(zonaId: number): Promise<ConteoZonaRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_iniciar_zona', {
    p_zona_id: zonaId,
  })
  if (error) throw error
  return data as ConteoZonaRow
}

export async function cerrarZona(zonaId: number): Promise<ConteoZonaRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_cerrar_zona', {
    p_zona_id: zonaId,
  })
  if (error) throw error
  return data as ConteoZonaRow
}

export interface RegistrarConteoPayload {
  zona_id: number
  producto_id: number
  cantidad: number
  observacion?: string | null
  es_reconteo?: boolean
  /** Solo para el toast — no viaja a la base. */
  nombre_producto?: string
}

export async function registrarConteo(
  payload: RegistrarConteoPayload
): Promise<ConteoDetalleRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_registrar_conteo', {
    p_zona_id: payload.zona_id,
    p_producto_id: payload.producto_id,
    p_cantidad: payload.cantidad,
    p_observacion: payload.observacion ?? null,
    p_es_reconteo: payload.es_reconteo ?? false,
  })
  if (error) throw error
  return data as ConteoDetalleRow
}

export async function pasarARevision(
  sesionId: number
): Promise<ConteoSesionRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_pasar_a_revision', {
    p_sesion_id: sesionId,
  })
  if (error) throw error
  return data as ConteoSesionRow
}

export interface SolicitarReconteoPayload {
  sesion_id: number
  producto_ids: number[]
  reconteo_user_id?: string | null
}

export async function solicitarReconteo(
  payload: SolicitarReconteoPayload
): Promise<number> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_solicitar_reconteo', {
    p_sesion_id: payload.sesion_id,
    p_producto_ids: payload.producto_ids,
    p_reconteo_user_id: payload.reconteo_user_id ?? null,
  })
  if (error) throw error
  return data as number
}

export async function getDiferenciasConteo(
  sesionId: number
): Promise<ConteoDiferenciaRow[]> {
  const supabase = createClient()
  // PostgREST corta cada respuesta en max-rows (1000 por default en Supabase).
  // Con un catálogo grande el reporte tiene una fila por producto, así que se
  // pagina con .range() hasta la página corta. La función devuelve las filas
  // ordenadas por producto_id (migración 104) para que la paginación sea
  // estable — sin eso podrían repetirse o saltearse filas entre páginas.
  const PAGINA = 1000
  const filas: ConteoDiferenciaRow[] = []
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await supabase
      .rpc('fn_conteo_diferencias', { p_sesion_id: sesionId })
      .range(desde, desde + PAGINA - 1)
    if (error) throw error
    const pagina = (data ?? []) as ConteoDiferenciaRow[]
    filas.push(...pagina)
    if (pagina.length < PAGINA) break
  }
  return filas
}

export async function cerrarSesionConteo(payload: {
  sesion_id: number
  confirmo_sync: boolean
}): Promise<ResumenCierreConteo> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_cerrar_sesion_conteo', {
    p_sesion_id: payload.sesion_id,
    p_confirmo_sync: payload.confirmo_sync,
  })
  if (error) throw error
  return data as unknown as ResumenCierreConteo
}
