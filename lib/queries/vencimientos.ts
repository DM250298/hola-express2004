import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
import { costoDesdeEmbed, type CostoEmbed } from '@/lib/queries/productos'
import type { EstadoLote, LoteRow } from '@/types/database'

export type ClaseVencimiento = 'vencido' | 'rojo' | 'amarillo' | 'verde'

export interface LoteConProducto extends LoteRow {
  producto: {
    id: number
    nombre: string
    codigo_barras: string | null
    precio_costo: number
    stock_actual: number
  }
  dias_restantes: number
  clase: ClaseVencimiento
}

/**
 * Días entre hoy (00:00 local) y la fecha de vencimiento (00:00 local).
 * Negativo = ya vencido.
 */
export function diasHastaVencimiento(fechaVenc: string): number {
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const venc = new Date(fechaVenc)
  venc.setHours(0, 0, 0, 0)
  const ms = venc.getTime() - hoy.getTime()
  return Math.round(ms / (1000 * 60 * 60 * 24))
}

export function clasificarVencimiento(dias: number): ClaseVencimiento {
  if (dias < 0) return 'vencido'
  if (dias < 3) return 'rojo'
  if (dias <= 7) return 'amarillo'
  return 'verde'
}

export async function getLotesActivos(): Promise<LoteConProducto[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('lotes')
    .select(
      `*, productos(id, nombre, codigo_barras, stock_actual, costos_producto(precio_costo))`
    )
    .in('estado', ['activo', 'vencido'])
    .gt('cantidad_actual', 0)
    .order('fecha_vencimiento', { ascending: true })

  if (error) throw error

  type FilaCruda = LoteRow & {
    productos: {
      id: number
      nombre: string
      codigo_barras: string | null
      stock_actual: number
      costos_producto: CostoEmbed
    } | null
  }

  return ((data ?? []) as unknown as FilaCruda[])
    .filter((l) => l.productos !== null)
    .map((l) => {
      const dias = diasHastaVencimiento(l.fecha_vencimiento)
      const { costos_producto, ...prod } = l.productos!
      return {
        ...l,
        producto: { ...prod, precio_costo: costoDesdeEmbed(costos_producto) },
        dias_restantes: dias,
        clase: clasificarVencimiento(dias),
      }
    })
}

export interface ResumenVencimientos {
  unidades_por_vencer: number // total cantidad_actual de lotes con dias < 7
  mermas_mes_unidades: number
  mermas_mes_monto: number
}

export async function getResumenVencimientos(): Promise<ResumenVencimientos> {
  const supabase = createClient()

  // Lotes próximos a vencer (<7 días, todavía con stock)
  const lotes = await getLotesActivos()
  const unidades_por_vencer = lotes
    .filter((l) => l.dias_restantes < 7)
    .reduce((acc, l) => acc + l.cantidad_actual, 0)

  // Mermas del mes corriente
  const inicioMes = new Date()
  inicioMes.setDate(1)
  inicioMes.setHours(0, 0, 0, 0)

  const { data: mermas, error } = await supabase
    .from('movimientos_stock')
    .select('cantidad, productos(costos_producto(precio_costo))')
    .eq('tipo', 'merma')
    .gte('created_at', inicioMes.toISOString())

  if (error) throw error

  type FilaMerma = {
    cantidad: number
    productos: { costos_producto: CostoEmbed } | null
  }

  const lista = (mermas ?? []) as unknown as FilaMerma[]
  const mermas_mes_unidades = lista.reduce((acc, m) => acc + m.cantidad, 0)
  const mermas_mes_monto = lista.reduce(
    (acc, m) => acc + m.cantidad * costoDesdeEmbed(m.productos?.costos_producto ?? null),
    0
  )

  return {
    unidades_por_vencer,
    mermas_mes_unidades,
    mermas_mes_monto,
  }
}

export interface NuevoLotePayload {
  producto_id: number
  fecha_vencimiento: string // ISO yyyy-MM-dd
  cantidad: number
  usuario_id: string
}

/**
 * Crea un lote nuevo y suma su cantidad al stock del producto.
 * Registra un movimiento tipo 'entrada' que referencia al lote.
 *
 * Nota técnica: idealmente sería una transacción en BD. El orden importa:
 * 1) crear lote (es el "ancla")
 * 2) actualizar stock
 * 3) registrar movimiento
 */
export async function crearLote(
  payload: NuevoLotePayload
): Promise<LoteRow> {
  const supabase = createClient()

  // 1. Obtener stock actual del producto
  const { data: producto, error: errProd } = await supabase
    .from('productos')
    .select('stock_actual')
    .eq('id', payload.producto_id)
    .single<{ stock_actual: number }>()

  if (errProd) throw errProd

  const stockAnterior = producto.stock_actual
  const stockNuevo = stockAnterior + payload.cantidad

  // 2. INSERT lote
  const { data: lote, error: errLote } = await supabase
    .from('lotes')
    .insert({
      producto_id: payload.producto_id,
      fecha_vencimiento: payload.fecha_vencimiento,
      cantidad_inicial: payload.cantidad,
      cantidad_actual: payload.cantidad,
      estado: 'activo',
    })
    .select()
    .single<LoteRow>()

  if (errLote) throw errLote

  // 3. UPDATE stock del producto
  const ahora = new Date().toISOString()
  const { error: errUpdate } = await supabase
    .from('productos')
    .update({ stock_actual: stockNuevo, updated_at: ahora })
    .eq('id', payload.producto_id)

  if (errUpdate) {
    throw new Error(
      `Lote #${lote.id} creado pero no se pudo actualizar stock: ${errUpdate.message}`
    )
  }

  // 4. INSERT movimiento
  const { error: errMov } = await supabase.from('movimientos_stock').insert({
    producto_id: payload.producto_id,
    tipo: 'entrada',
    cantidad: payload.cantidad,
    stock_anterior: stockAnterior,
    stock_nuevo: stockNuevo,
    referencia_id: lote.id,
    usuario_id: payload.usuario_id,
    nota: `Ingreso de lote #${lote.id} (vence ${payload.fecha_vencimiento})`,
  })

  if (errMov) {
    throw new Error(
      `Lote y stock OK pero falló registrar movimiento: ${errMov.message}`
    )
  }

  return lote
}

export interface DarDeBajaLotePayload {
  lote_id: number
  cantidad: number
  usuario_id: string
}

/**
 * Da de baja parcial o total un lote.
 * - Resta del lote.cantidad_actual
 * - Si el lote queda en 0: estado='dado_de_baja'
 * - Resta del producto.stock_actual
 * - Registra movimiento tipo 'merma' (la pérdida se calcula desde acá en
 *   reportes de finanzas, no se duplica en egresos)
 */
export async function darDeBajaLote(
  payload: DarDeBajaLotePayload
): Promise<void> {
  const supabase = createClient()

  // 1. Obtener lote + producto
  const { data: lote, error: errLote } = await supabase
    .from('lotes')
    .select(
      'id, producto_id, cantidad_actual, estado, fecha_vencimiento, productos(stock_actual, nombre)'
    )
    .eq('id', payload.lote_id)
    .single()

  if (errLote) throw errLote

  type LoteCargado = {
    id: number
    producto_id: number
    cantidad_actual: number
    estado: EstadoLote
    fecha_vencimiento: string
    productos: { stock_actual: number; nombre: string } | null
  }
  const loteData = lote as unknown as LoteCargado

  if (!loteData.productos) {
    throw new Error('No se encontró el producto del lote.')
  }
  if (payload.cantidad <= 0) {
    throw new Error('La cantidad a dar de baja debe ser mayor a 0.')
  }
  if (payload.cantidad > loteData.cantidad_actual) {
    throw new Error(
      `El lote tiene ${loteData.cantidad_actual} unidades, no se pueden dar de baja ${payload.cantidad}.`
    )
  }
  if (payload.cantidad > loteData.productos.stock_actual) {
    throw new Error(
      `El stock del producto (${loteData.productos.stock_actual}) es menor que la cantidad a dar de baja.`
    )
  }

  const nuevaCantidadLote = loteData.cantidad_actual - payload.cantidad
  const nuevoEstadoLote = nuevaCantidadLote === 0 ? 'dado_de_baja' : loteData.estado
  const stockAnterior = loteData.productos.stock_actual
  const stockNuevo = stockAnterior - payload.cantidad

  // 2. UPDATE lote
  const { error: errUpdateLote } = await supabase
    .from('lotes')
    .update({
      cantidad_actual: nuevaCantidadLote,
      estado: nuevoEstadoLote,
    })
    .eq('id', loteData.id)

  if (errUpdateLote) throw errUpdateLote

  // 3. UPDATE stock del producto
  const ahora = new Date().toISOString()
  const { error: errUpdateProd } = await supabase
    .from('productos')
    .update({ stock_actual: stockNuevo, updated_at: ahora })
    .eq('id', loteData.producto_id)

  if (errUpdateProd) {
    throw new Error(
      `Lote actualizado pero falló el descuento de stock: ${errUpdateProd.message}`
    )
  }

  // 4. INSERT movimiento tipo merma
  const { error: errMov } = await supabase.from('movimientos_stock').insert({
    producto_id: loteData.producto_id,
    tipo: 'merma',
    cantidad: payload.cantidad,
    stock_anterior: stockAnterior,
    stock_nuevo: stockNuevo,
    referencia_id: loteData.id,
    usuario_id: payload.usuario_id,
    nota: `Baja por vencimiento — Lote #${loteData.id} (vence ${loteData.fecha_vencimiento})`,
  })

  if (errMov) {
    throw new Error(
      `Stock descontado pero no se registró movimiento: ${errMov.message}`
    )
  }
}

// ─── Sincronización inicial: stock huérfano → lotes ────────────────────────

export interface PlanSincronizacion {
  productos: Array<{
    producto_id: number
    nombre: string
    stock_actual: number
    cubierto_por_lotes: number
    faltante: number
  }>
  total_productos: number
  total_unidades: number
}

/**
 * Detecta productos con stock no asociado a ningún lote activo.
 * Útil para migrar el stock inicial al sistema cuando los productos ya
 * existían antes de empezar a controlar vencimientos.
 *
 * Por cada producto con `stock_actual > 0`:
 *   faltante = stock_actual − suma(cantidad_actual de lotes activos)
 * Si faltante > 0, se incluye en el plan.
 */
export async function obtenerPlanSincronizacionStock(): Promise<PlanSincronizacion> {
  const supabase = createClient()

  const [productos, lotes] = await Promise.all([
    traerTodo<{ id: number; nombre: string; stock_actual: number }>(() =>
      supabase
        .from('productos')
        .select('id, nombre, stock_actual')
        .eq('activo', true)
        .gt('stock_actual', 0)
    ),
    traerTodo<{ producto_id: number; cantidad_actual: number }>(() =>
      supabase
        .from('lotes')
        .select('producto_id, cantidad_actual')
        .eq('estado', 'activo')
    ),
  ])

  // Suma de cantidades en lotes activos, por producto
  const cubiertoPorLote = new Map<number, number>()
  for (const l of lotes) {
    cubiertoPorLote.set(
      l.producto_id,
      (cubiertoPorLote.get(l.producto_id) ?? 0) + l.cantidad_actual
    )
  }

  const planItems = productos
    .map((p) => {
      const cubierto = cubiertoPorLote.get(p.id) ?? 0
      const faltante = p.stock_actual - cubierto
      return {
        producto_id: p.id,
        nombre: p.nombre,
        stock_actual: p.stock_actual,
        cubierto_por_lotes: cubierto,
        faltante,
      }
    })
    .filter((p) => p.faltante > 0)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-AR'))

  return {
    productos: planItems,
    total_productos: planItems.length,
    total_unidades: planItems.reduce((s, p) => s + p.faltante, 0),
  }
}

export interface ResultadoSincronizacion {
  lotes_creados: number
  unidades_cubiertas: number
}

/**
 * Crea lotes para cubrir el stock huérfano, con la fecha de vencimiento
 * indicada. Los lotes quedan sin `pedido_origen_id` porque no vienen de
 * ningún pedido — son el stock inicial.
 */
export async function sincronizarStockConLotes(
  fechaVencimiento: string
): Promise<ResultadoSincronizacion> {
  const supabase = createClient()
  const plan = await obtenerPlanSincronizacionStock()

  if (plan.productos.length === 0) {
    return { lotes_creados: 0, unidades_cubiertas: 0 }
  }

  const inserts = plan.productos.map((p) => ({
    producto_id: p.producto_id,
    fecha_vencimiento: fechaVencimiento,
    cantidad_inicial: p.faltante,
    cantidad_actual: p.faltante,
    estado: 'activo' as const,
    pedido_origen_id: null,
  }))

  // Bulk en chunks de 100 para no chocar con límites de Supabase
  for (let i = 0; i < inserts.length; i += 100) {
    const chunk = inserts.slice(i, i + 100)
    const { error } = await supabase.from('lotes').insert(chunk)
    if (error) throw error
  }

  return {
    lotes_creados: inserts.length,
    unidades_cubiertas: plan.total_unidades,
  }
}
