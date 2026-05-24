import { createClient } from '@/lib/supabase/client'
import type {
  EstadoPedido,
  ItemPedidoRow,
  Json,
  PedidoRow,
  ProveedorRow,
} from '@/types/database'

export interface PedidoConProveedor extends PedidoRow {
  proveedor: { id: number; nombre: string } | null
}

export interface ItemPedidoConProducto extends ItemPedidoRow {
  producto: {
    id: number
    nombre: string
    codigo_barras: string | null
    stock_actual: number
    dias_vencimiento_minimo: number | null
  } | null
}

export interface PedidoCompleto extends PedidoConProveedor {
  proveedor_completo: ProveedorRow | null
  items: ItemPedidoConProducto[]
}

/** Parsea el primer número entero de la condición de pago, e.g. "30 días" → 30 */
export function parsearDiasCondicionPago(
  condicion: string | null | undefined
): number {
  if (!condicion) return 0
  const match = condicion.match(/\d+/)
  return match ? Number(match[0]) : 0
}

export interface FiltrosPedidos {
  estado?: EstadoPedido | null
}

export async function getPedidos(
  filtros: FiltrosPedidos = {}
): Promise<PedidoConProveedor[]> {
  const supabase = createClient()
  let query = supabase
    .from('pedidos')
    .select('*, proveedores(id, nombre)')
    .order('fecha_pedido', { ascending: false })

  if (filtros.estado) {
    query = query.eq('estado', filtros.estado)
  }

  const { data, error } = await query
  if (error) throw error

  type FilaCruda = PedidoRow & {
    proveedores: { id: number; nombre: string } | null
  }

  return ((data ?? []) as unknown as FilaCruda[]).map(
    ({ proveedores, ...resto }) => ({
      ...resto,
      proveedor: proveedores,
    })
  )
}

export async function getPedidoDetalle(
  id: number
): Promise<PedidoCompleto | null> {
  const supabase = createClient()

  const { data: pedido, error: errPedido } = await supabase
    .from('pedidos')
    .select('*, proveedores(*)')
    .eq('id', id)
    .maybeSingle()

  if (errPedido) throw errPedido
  if (!pedido) return null

  type PedidoCrudo = PedidoRow & { proveedores: ProveedorRow | null }
  const pedidoData = pedido as unknown as PedidoCrudo

  const { data: items, error: errItems } = await supabase
    .from('items_pedido')
    .select(
      '*, productos(id, nombre, codigo_barras, stock_actual, dias_vencimiento_minimo)'
    )
    .eq('pedido_id', id)
    .order('id', { ascending: true })

  if (errItems) throw errItems

  type ItemCrudo = ItemPedidoRow & {
    productos: {
      id: number
      nombre: string
      codigo_barras: string | null
      stock_actual: number
      dias_vencimiento_minimo: number | null
    } | null
  }

  const itemsList: ItemPedidoConProducto[] = (
    (items ?? []) as unknown as ItemCrudo[]
  ).map(({ productos, ...resto }) => ({
    ...resto,
    producto: productos,
  }))

  return {
    ...pedidoData,
    proveedor: pedidoData.proveedores
      ? { id: pedidoData.proveedores.id, nombre: pedidoData.proveedores.nombre }
      : null,
    proveedor_completo: pedidoData.proveedores,
    items: itemsList,
  }
}

export interface ProductoSugerido {
  id: number
  nombre: string
  codigo_barras: string | null
  precio_costo: number
  stock_actual: number
  stock_minimo: number
  cantidad_sugerida: number
}

/** Productos del proveedor con stock < mínimo. Sugiere cantidad para llegar al mínimo (×2 para colchón). */
export async function getProductosSugeridos(
  proveedor_id: number
): Promise<ProductoSugerido[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('productos')
    .select(
      'id, nombre, codigo_barras, precio_costo, stock_actual, stock_minimo'
    )
    .eq('proveedor_id', proveedor_id)
    .eq('activo', true)

  if (error) throw error

  type Fila = {
    id: number
    nombre: string
    codigo_barras: string | null
    precio_costo: number
    stock_actual: number
    stock_minimo: number
  }

  return ((data ?? []) as Fila[])
    .filter((p) => p.stock_actual < p.stock_minimo)
    .map((p) => ({
      ...p,
      // Cantidad sugerida: llevar al doble del mínimo (colchón). Mínimo 1.
      cantidad_sugerida: Math.max(p.stock_minimo * 2 - p.stock_actual, 1),
    }))
}

export interface ItemNuevoPedido {
  producto_id: number
  cantidad_pedida: number
  precio_costo: number
}

export interface NuevoPedidoPayload {
  proveedor_id: number
  usuario_id: string
  fecha_entrega_esperada: string | null
  estado: 'borrador' | 'enviado'
  items: ItemNuevoPedido[]
}

export async function crearPedido(
  payload: NuevoPedidoPayload
): Promise<PedidoRow> {
  const supabase = createClient()

  const total = payload.items.reduce(
    (acc, it) => acc + it.cantidad_pedida * it.precio_costo,
    0
  )

  const { data: pedido, error } = await supabase
    .from('pedidos')
    .insert({
      proveedor_id: payload.proveedor_id,
      usuario_id: payload.usuario_id,
      fecha_entrega_esperada: payload.fecha_entrega_esperada,
      estado: payload.estado,
      total,
    })
    .select()
    .single<PedidoRow>()

  if (error) throw error

  if (payload.items.length === 0) return pedido

  const itemsInsert = payload.items.map((it) => ({
    pedido_id: pedido.id,
    producto_id: it.producto_id,
    cantidad_pedida: it.cantidad_pedida,
    cantidad_recibida: null,
    precio_costo: it.precio_costo,
    subtotal: it.cantidad_pedida * it.precio_costo,
  }))

  const { error: errItems } = await supabase
    .from('items_pedido')
    .insert(itemsInsert)

  if (errItems) {
    throw new Error(
      `Pedido #${pedido.id} creado pero faltan items: ${errItems.message}`
    )
  }

  return pedido
}

export async function actualizarEstadoPedido(
  id: number,
  estado: EstadoPedido
): Promise<PedidoRow> {
  const supabase = createClient()
  const ahora = new Date().toISOString()
  const { data, error } = await supabase
    .from('pedidos')
    .update({ estado, updated_at: ahora })
    .eq('id', id)
    .select()
    .single<PedidoRow>()

  if (error) throw error
  return data
}

export interface ItemRecepcion {
  item_id: number
  producto_id: number
  cantidad_recibida: number
  precio_costo: number
  fecha_vencimiento: string | null
}

export interface RecibirPedidoPayload {
  pedido_id: number
  proveedor_id: number
  usuario_id: string
  condicion_pago_dias: number
  items: ItemRecepcion[]
}

/**
 * Registra la recepción de un pedido, de forma atómica (`fn_recibir_pedido`):
 *  1. Actualiza la cantidad recibida de cada item.
 *  2. Suma el stock, registra los movimientos y crea los lotes con vencimiento.
 *  3. Marca el pedido como `recibido`.
 *  4. Crea la cuenta a pagar al proveedor.
 *
 * Todo dentro de una única transacción Postgres: o se registra todo, o nada.
 */
export async function recibirPedido(
  payload: RecibirPedidoPayload
): Promise<{ cuenta_a_pagar_id: number; total_recibido: number }> {
  const supabase = createClient()

  const { data, error } = await supabase.rpc('fn_recibir_pedido', {
    p_pedido_id: payload.pedido_id,
    p_proveedor_id: payload.proveedor_id,
    p_usuario_id: payload.usuario_id,
    p_condicion_pago_dias: payload.condicion_pago_dias,
    p_items: payload.items.map((it) => ({
      item_id: it.item_id,
      producto_id: it.producto_id,
      cantidad_recibida: it.cantidad_recibida,
      precio_costo: it.precio_costo,
      fecha_vencimiento: it.fecha_vencimiento,
    })) as unknown as Json,
  })

  if (error) throw error
  if (!data) throw new Error('No se pudo registrar la recepción.')
  return data as { cuenta_a_pagar_id: number; total_recibido: number }
}

// ─── Lotes del pedido (para reimprimir etiquetas) ─────────────────────

export interface LoteDePedido {
  id: number
  producto_id: number
  producto_nombre: string
  codigo_barras: string | null
  fecha_vencimiento: string
  cantidad_inicial: number
}

export async function getLotesPorPedido(
  pedido_id: number
): Promise<LoteDePedido[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('lotes')
    .select(
      'id, producto_id, fecha_vencimiento, cantidad_inicial, productos(nombre, codigo_barras)'
    )
    .eq('pedido_origen_id', pedido_id)
    .order('id', { ascending: true })

  if (error) throw error

  type FilaCruda = {
    id: number
    producto_id: number
    fecha_vencimiento: string
    cantidad_inicial: number
    productos: { nombre: string; codigo_barras: string | null } | null
  }

  return ((data ?? []) as unknown as FilaCruda[]).map((l) => ({
    id: l.id,
    producto_id: l.producto_id,
    producto_nombre: l.productos?.nombre ?? 'Producto eliminado',
    codigo_barras: l.productos?.codigo_barras ?? null,
    fecha_vencimiento: l.fecha_vencimiento,
    cantidad_inicial: l.cantidad_inicial,
  }))
}
