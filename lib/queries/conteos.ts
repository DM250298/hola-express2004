import { createClient } from '@/lib/supabase/client'
import { costoDesdeEmbed, type CostoEmbed } from '@/lib/queries/productos'
import type { ConteoItemRow, ConteoRow } from '@/types/database'

export interface UsuarioSimple {
  id: string
  nombre: string
  rol: string
}

/** Lista de usuarios activos — para asignar conteos. */
export async function getUsuariosActivos(): Promise<UsuarioSimple[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('usuarios')
    .select('id, nombre, rol')
    .eq('activo', true)
    .order('nombre', { ascending: true })
  if (error) throw error
  return (data ?? []) as UsuarioSimple[]
}

export interface NuevoConteoPayload {
  nombre: string
  usuario_asignado: string
  usuario_creador: string
  categoria_ids: number[]
  producto_ids: number[]
}

/**
 * Crea un conteo asignado a un empleado. La lista de productos a contar se
 * arma a partir de las categorías elegidas (todos sus productos activos) más
 * los productos sueltos. Se guarda un snapshot del stock del sistema.
 */
export async function crearConteo(
  payload: NuevoConteoPayload
): Promise<ConteoRow> {
  const supabase = createClient()

  const idsSet = new Set<number>(payload.producto_ids)

  if (payload.categoria_ids.length > 0) {
    const { data: prods, error } = await supabase
      .from('productos')
      .select('id')
      .eq('activo', true)
      .in('categoria_id', payload.categoria_ids)
    if (error) throw error
    for (const p of prods ?? []) idsSet.add(p.id)
  }

  const ids = [...idsSet]
  if (ids.length === 0) {
    throw new Error(
      'El conteo no tiene productos. Elegí al menos una categoría o producto.'
    )
  }

  // Snapshot del stock actual
  const { data: prodsStock, error: errStock } = await supabase
    .from('productos')
    .select('id, stock_actual')
    .in('id', ids)
  if (errStock) throw errStock

  const stockMap = new Map<number, number>()
  for (const p of prodsStock ?? []) stockMap.set(p.id, Number(p.stock_actual))

  // Cabecera
  const { data: conteo, error: errConteo } = await supabase
    .from('conteos')
    .insert({
      nombre: payload.nombre,
      usuario_asignado: payload.usuario_asignado,
      usuario_creador: payload.usuario_creador,
      estado: 'pendiente',
    })
    .select()
    .single<ConteoRow>()
  if (errConteo) throw errConteo

  // Items
  const items = ids.map((pid) => ({
    conteo_id: conteo.id,
    producto_id: pid,
    stock_sistema: stockMap.get(pid) ?? 0,
    contado: false,
  }))
  const { error: errItems } = await supabase
    .from('conteos_items')
    .insert(items)
  if (errItems) throw errItems

  return conteo
}

export interface ConteoListado extends ConteoRow {
  asignado_nombre: string | null
  creador_nombre: string | null
  total_items: number
}

export async function getConteos(): Promise<ConteoListado[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('conteos')
    .select(
      '*, asignado:usuario_asignado(nombre), creador:usuario_creador(nombre), conteos_items(count)'
    )
    .order('fecha_creacion', { ascending: false })
  if (error) throw error

  type Fila = ConteoRow & {
    asignado: { nombre: string } | null
    creador: { nombre: string } | null
    conteos_items: Array<{ count: number }>
  }
  return ((data ?? []) as unknown as Fila[]).map(
    ({ asignado, creador, conteos_items, ...resto }) => ({
      ...resto,
      asignado_nombre: asignado?.nombre ?? null,
      creador_nombre: creador?.nombre ?? null,
      total_items: conteos_items?.[0]?.count ?? 0,
    })
  )
}

export interface ConteoItemDetalle extends ConteoItemRow {
  producto_nombre: string
  producto_codigo: string | null
  precio_costo: number
}

export interface ConteoDetalle {
  conteo: ConteoRow
  items: ConteoItemDetalle[]
}

export async function getConteoDetalle(
  id: number
): Promise<ConteoDetalle | null> {
  const supabase = createClient()

  const [resConteo, resItems] = await Promise.all([
    supabase.from('conteos').select('*').eq('id', id).maybeSingle<ConteoRow>(),
    supabase
      .from('conteos_items')
      .select('*, productos(nombre, codigo_barras, costos_producto(precio_costo))')
      .eq('conteo_id', id)
      .order('id', { ascending: true }),
  ])

  if (resConteo.error) throw resConteo.error
  if (resItems.error) throw resItems.error
  if (!resConteo.data) return null

  type FilaItem = ConteoItemRow & {
    productos: {
      nombre: string
      codigo_barras: string | null
      costos_producto: CostoEmbed
    } | null
  }

  const items: ConteoItemDetalle[] = (
    (resItems.data ?? []) as unknown as FilaItem[]
  ).map(({ productos, ...resto }) => ({
    ...resto,
    producto_nombre: productos?.nombre ?? 'Producto eliminado',
    producto_codigo: productos?.codigo_barras ?? null,
    precio_costo: costoDesdeEmbed(productos?.costos_producto ?? null),
  }))

  return { conteo: resConteo.data, items }
}

/**
 * Guarda las cantidades contadas por el empleado y marca el conteo como
 * 'contado'. Los items sin valor cargado quedan en 0.
 */
export async function guardarConteoEmpleado(
  conteoId: number,
  conteos: Array<{ itemId: number; cantidad: number }>
): Promise<void> {
  const supabase = createClient()

  for (const c of conteos) {
    const { error } = await supabase
      .from('conteos_items')
      .update({ cantidad_contada: c.cantidad, contado: true })
      .eq('id', c.itemId)
    if (error) throw error
  }

  const { error: errConteo } = await supabase
    .from('conteos')
    .update({ estado: 'contado', fecha_conteo: new Date().toISOString() })
    .eq('id', conteoId)
  if (errConteo) throw errConteo
}

/**
 * Aprueba un conteo: ajusta el stock de cada producto al valor contado por el
 * empleado, registrando el movimiento de ajuste por la diferencia.
 */
/**
 * Aprueba un conteo de mercadería, de forma atómica (`fn_aprobar_conteo`):
 * ajusta el stock de cada producto al valor contado, registra los
 * movimientos y marca el conteo como aprobado — todo en una transacción.
 */
export async function aprobarConteo(
  conteoId: number,
  aprobadorId: string
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_aprobar_conteo', {
    p_conteo_id: conteoId,
    p_aprobador_id: aprobadorId,
  })
  if (error) throw error
}
