import { createClient } from '@/lib/supabase/client'
import { costoDesdeEmbed, type CostoEmbed } from '@/lib/queries/productos'
import { traerTodo } from '@/lib/supabase/paginacion'
import { fechaLocal } from '@/lib/utils/periodos'
import type { MedioPago } from '@/types/database'

// ─── Reporte de ventas ───────────────────────────────────────────────────────

export type FranjaHoraria = 'manana' | 'tarde' | 'noche'

export function clasificarFranja(fecha: string): FranjaHoraria {
  const h = new Date(fecha).getHours()
  if (h >= 6 && h < 12) return 'manana'
  if (h >= 12 && h < 19) return 'tarde'
  return 'noche'
}

export interface PuntoVentaDia {
  fecha: string // ISO yyyy-MM-dd
  total: number
  cantidad: number
}

export interface ReporteVentas {
  total: number
  cantidad: number
  ticket_promedio: number
  por_dia: PuntoVentaDia[]
  por_medio_pago: Record<MedioPago, { total: number; cantidad: number }>
  por_franja: Record<FranjaHoraria, { total: number; cantidad: number }>
}

export async function getReporteVentas(
  desde: string,
  hasta: string
): Promise<ReporteVentas> {
  const supabase = createClient()

  type VentaFila = { total: number; fecha: string; medio_pago: MedioPago }

  // Paginado: con más de 1000 ventas en el período el Max Rows de PostgREST
  // truncaba el reporte entero en silencio (KPIs, gráfico y PDF salían de las
  // 1000 ventas más viejas). Desempate por id: dos ventas pueden compartir
  // `fecha` y sin orden único la paginación duplica/saltea filas.
  const ventas = await traerTodo<VentaFila>(() =>
    supabase
      .from('ventas')
      .select('total, fecha, medio_pago')
      .eq('estado', 'completada')
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha', { ascending: true })
      .order('id', { ascending: true })
  )

  const total = ventas.reduce((acc, v) => acc + Number(v.total), 0)
  const cantidad = ventas.length

  // Por día. `ventas.fecha` es timestamptz y llega en UTC: agrupar por
  // fecha.slice(0,10) metía las ventas de 21:00 en adelante (UTC-3) en el día
  // siguiente. En un 24/7 con la mitad de la facturación de noche, cada barra
  // del gráfico se comía las últimas 3 horas del día anterior.
  const porDiaMap = new Map<string, PuntoVentaDia>()
  for (const v of ventas) {
    const dia = fechaLocal(v.fecha)
    const previo = porDiaMap.get(dia)
    if (previo) {
      previo.total += Number(v.total)
      previo.cantidad += 1
    } else {
      porDiaMap.set(dia, { fecha: dia, total: Number(v.total), cantidad: 1 })
    }
  }

  // Por medio de pago (dinámico — los medios ya no son fijos)
  const por_medio_pago: ReporteVentas['por_medio_pago'] = {}
  for (const v of ventas) {
    const k = v.medio_pago
    if (!por_medio_pago[k]) por_medio_pago[k] = { total: 0, cantidad: 0 }
    por_medio_pago[k].total += Number(v.total)
    por_medio_pago[k].cantidad += 1
  }

  // Por franja horaria
  const por_franja: ReporteVentas['por_franja'] = {
    manana: { total: 0, cantidad: 0 },
    tarde: { total: 0, cantidad: 0 },
    noche: { total: 0, cantidad: 0 },
  }
  for (const v of ventas) {
    const franja = clasificarFranja(v.fecha)
    por_franja[franja].total += Number(v.total)
    por_franja[franja].cantidad += 1
  }

  return {
    total,
    cantidad,
    ticket_promedio: cantidad > 0 ? total / cantidad : 0,
    por_dia: [...porDiaMap.values()].sort((a, b) =>
      a.fecha.localeCompare(b.fecha)
    ),
    por_medio_pago,
    por_franja,
  }
}

// ─── Top 20 productos ────────────────────────────────────────────────────────

export interface TopProductoReporte {
  producto_id: number
  nombre: string
  categoria_nombre: string | null
  unidades: number
  total_vendido: number
  porcentaje_unidades: number
  porcentaje_monto: number
}

export async function getTopProductos(
  desde: string,
  hasta: string,
  limite = 20
): Promise<TopProductoReporte[]> {
  const supabase = createClient()

  type Fila = {
    cantidad: number
    subtotal: number
    productos: {
      id: number
      nombre: string
      categorias: { nombre: string } | null
    }
  }

  // Paginado (mismo patrón que clasificacionAbc.ts): cada ticket tiene varios
  // items, así que 1000 filas son apenas ~300 ventas. Sin esto el ranking y los
  // porcentajes se calculaban sobre una muestra arbitraria del período.
  const filas = await traerTodo<Fila>(() =>
    supabase
      .from('items_venta')
      .select(
        'cantidad, subtotal, ventas!inner(fecha, estado), productos!inner(id, nombre, categorias(nombre))'
      )
      .gte('ventas.fecha', desde)
      .lte('ventas.fecha', hasta)
      .eq('ventas.estado', 'completada')
      .order('id', { ascending: true })
  )

  const acumulado = new Map<number, TopProductoReporte>()
  let totalUnidades = 0
  let totalMonto = 0

  for (const fila of filas) {
    const p = fila.productos
    totalUnidades += fila.cantidad
    totalMonto += Number(fila.subtotal)
    const previo = acumulado.get(p.id)
    if (previo) {
      previo.unidades += fila.cantidad
      previo.total_vendido += Number(fila.subtotal)
    } else {
      acumulado.set(p.id, {
        producto_id: p.id,
        nombre: p.nombre,
        categoria_nombre: p.categorias?.nombre ?? null,
        unidades: fila.cantidad,
        total_vendido: Number(fila.subtotal),
        porcentaje_unidades: 0,
        porcentaje_monto: 0,
      })
    }
  }

  return [...acumulado.values()]
    .map((p) => ({
      ...p,
      porcentaje_unidades:
        totalUnidades > 0 ? (p.unidades / totalUnidades) * 100 : 0,
      porcentaje_monto:
        totalMonto > 0 ? (p.total_vendido / totalMonto) * 100 : 0,
    }))
    .sort((a, b) => b.unidades - a.unidades)
    .slice(0, limite)
}

// ─── Rotación de inventario ──────────────────────────────────────────────────

export interface RotacionProducto {
  producto_id: number
  nombre: string
  categoria_nombre: string | null
  stock_actual: number
  unidades_vendidas: number
  dias_rotacion: number | null // null = sin ventas (dead stock candidate)
  ultimo_movimiento: string | null
}

/** Días de historia que mira el fallback cuando la RPC todavía no existe. */
const DIAS_FALLBACK_ULTIMO_MOV = 180

/**
 * Fecha del último movimiento de stock de cada producto.
 *
 * Vía RPC agregada (migración 160): una fila por producto con max(created_at).
 * Antes se bajaba `movimientos_stock` entera ordenada por fecha, así que el Max
 * Rows de PostgREST dejaba ver solo los 1000 movimientos más recientes de toda
 * la historia — en un 24/7 eso son días, y casi todo producto quedaba como
 * "sin movimientos" (dead stock con falsos positivos). Paginar la tabla entera
 * tampoco sirve: crece sin techo.
 *
 * La RPC igual se pagina porque el Max Rows corta también a las funciones que
 * devuelven set (mismo caso que fn_productos_a_reponer); el orden estable lo
 * pone el ORDER BY producto_id de la propia función.
 */
async function getUltimoMovimientoPorProducto(
  supabase: ReturnType<typeof createClient>
): Promise<Map<number, string>> {
  type FilaRPC = { producto_id: number; ultimo_movimiento: string }

  try {
    const filas = await traerTodo<FilaRPC>(() =>
      supabase.rpc('fn_ultimo_movimiento_por_producto')
    )
    return new Map(filas.map((f) => [f.producto_id, f.ultimo_movimiento]))
  } catch (e) {
    // PGRST202: la función no está en el schema cache (migración sin correr).
    if ((e as { code?: string })?.code !== 'PGRST202') throw e
  }

  // Fallback degradado: ventana acotada de historia, paginada. Un producto sin
  // movimientos en esa ventana figura como "sin movimientos" (dead stock lo
  // incluye igual, que es lo correcto), pero nunca se baja la tabla completa.
  const corte = new Date()
  corte.setDate(corte.getDate() - DIAS_FALLBACK_ULTIMO_MOV)

  type MovFila = { producto_id: number; created_at: string }
  const movs = await traerTodo<MovFila>(() =>
    supabase
      .from('movimientos_stock')
      .select('producto_id, created_at')
      .gte('created_at', corte.toISOString())
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
  )

  const mapa = new Map<number, string>()
  for (const m of movs) {
    if (!mapa.has(m.producto_id)) mapa.set(m.producto_id, m.created_at)
  }
  return mapa
}

export async function getRotacionInventario(
  desde: string,
  hasta: string
): Promise<RotacionProducto[]> {
  const supabase = createClient()

  type ProductoFila = {
    id: number
    nombre: string
    stock_actual: number
    categorias: { nombre: string } | null
  }

  // 1. Productos activos (paginado: el catálogo pasa las 1000 filas)
  const productos = await traerTodo<ProductoFila>(() =>
    supabase
      .from('productos')
      .select('id, nombre, stock_actual, categorias(nombre)')
      .eq('activo', true)
      .order('id', { ascending: true })
  )

  // 2. Ventas del período por producto (paginado: varios items por ticket)
  type ItemFila = { cantidad: number; producto_id: number }
  const items = await traerTodo<ItemFila>(() =>
    supabase
      .from('items_venta')
      .select('cantidad, producto_id, ventas!inner(fecha, estado)')
      .gte('ventas.fecha', desde)
      .lte('ventas.fecha', hasta)
      .eq('ventas.estado', 'completada')
      .order('id', { ascending: true })
  )

  const ventasPorProducto = new Map<number, number>()
  for (const it of items) {
    ventasPorProducto.set(
      it.producto_id,
      (ventasPorProducto.get(it.producto_id) ?? 0) + it.cantidad
    )
  }

  // 3. Último movimiento por producto (cualquier tipo)
  const ultimoMovPorProducto = await getUltimoMovimientoPorProducto(supabase)

  // Días del período
  const msPeriodo =
    new Date(hasta).getTime() - new Date(desde).getTime()
  const diasPeriodo = Math.max(1, Math.round(msPeriodo / (1000 * 60 * 60 * 24)))

  return productos
    .map((p) => {
      const vendidas = ventasPorProducto.get(p.id) ?? 0
      const dias_rotacion =
        vendidas > 0 && p.stock_actual > 0
          ? (p.stock_actual * diasPeriodo) / vendidas
          : vendidas > 0
          ? 0 // tiene ventas pero sin stock = se vendió todo
          : null
      return {
        producto_id: p.id,
        nombre: p.nombre,
        categoria_nombre: p.categorias?.nombre ?? null,
        stock_actual: p.stock_actual,
        unidades_vendidas: vendidas,
        dias_rotacion,
        ultimo_movimiento: ultimoMovPorProducto.get(p.id) ?? null,
      }
    })
    .sort((a, b) => {
      // null al final (sin ventas), después por más días primero (rotación lenta)
      if (a.dias_rotacion == null && b.dias_rotacion == null) return 0
      if (a.dias_rotacion == null) return 1
      if (b.dias_rotacion == null) return -1
      return b.dias_rotacion - a.dias_rotacion
    })
}

export interface DeadStockProducto {
  producto_id: number
  nombre: string
  categoria_nombre: string | null
  stock_actual: number
  precio_costo: number
  ultimo_movimiento: string | null
  dias_sin_movimiento: number | null
  valor_inmovilizado: number
}

/**
 * Dead stock: productos activos con stock>0 cuyo último movimiento fue hace
 * más de `diasUmbral` días (o que nunca tuvieron movimientos).
 */
export async function getDeadStock(
  diasUmbral = 30
): Promise<DeadStockProducto[]> {
  const supabase = createClient()

  type ProductoFila = {
    id: number
    nombre: string
    stock_actual: number
    costos_producto: CostoEmbed
    categorias: { nombre: string } | null
  }

  // Productos activos con stock > 0 (paginado: el catálogo pasa las 1000 filas)
  const productos = await traerTodo<ProductoFila>(() =>
    supabase
      .from('productos')
      .select('id, nombre, stock_actual, categorias(nombre), costos_producto(precio_costo)')
      .eq('activo', true)
      .gt('stock_actual', 0)
      .order('id', { ascending: true })
  )

  // Último movimiento por producto
  const ultimoMov = await getUltimoMovimientoPorProducto(supabase)

  const ahora = Date.now()
  return productos
    .map((p) => {
      const ultimo = ultimoMov.get(p.id) ?? null
      const diasSin = ultimo
        ? Math.round((ahora - new Date(ultimo).getTime()) / (1000 * 60 * 60 * 24))
        : null
      const costo = costoDesdeEmbed(p.costos_producto)
      return {
        producto_id: p.id,
        nombre: p.nombre,
        categoria_nombre: p.categorias?.nombre ?? null,
        stock_actual: p.stock_actual,
        precio_costo: costo,
        ultimo_movimiento: ultimo,
        dias_sin_movimiento: diasSin,
        valor_inmovilizado: p.stock_actual * costo,
      }
    })
    .filter((p) => p.dias_sin_movimiento === null || p.dias_sin_movimiento > diasUmbral)
    .sort((a, b) => b.valor_inmovilizado - a.valor_inmovilizado)
}

// ─── Mermas por categoría ────────────────────────────────────────────────────

export interface MermaPorCategoria {
  categoria_nombre: string
  unidades: number
  monto: number
}

export interface ReporteMermas {
  total_unidades: number
  total_monto: number
  por_categoria: MermaPorCategoria[]
}

export async function getMermasPorCategoria(
  desde: string,
  hasta: string
): Promise<ReporteMermas> {
  const supabase = createClient()

  type FilaMerma = {
    cantidad: number
    productos: {
      costos_producto: CostoEmbed
      categorias: { nombre: string } | null
    } | null
  }

  // Paginado: en períodos largos las mermas superan las 1000 filas y el total
  // quedaba subcontado en silencio.
  const filas = await traerTodo<FilaMerma>(() =>
    supabase
      .from('movimientos_stock')
      .select(
        'cantidad, productos(costos_producto(precio_costo), categorias(nombre))'
      )
      .eq('tipo', 'merma')
      .gte('created_at', desde)
      .lte('created_at', hasta)
      .order('id', { ascending: true })
  )

  let total_unidades = 0
  let total_monto = 0
  const porCat = new Map<string, MermaPorCategoria>()

  for (const m of filas) {
    const costo = costoDesdeEmbed(m.productos?.costos_producto ?? null)
    const cat = m.productos?.categorias?.nombre ?? 'Sin categoría'
    const monto = m.cantidad * costo

    total_unidades += m.cantidad
    total_monto += monto

    const previo = porCat.get(cat)
    if (previo) {
      previo.unidades += m.cantidad
      previo.monto += monto
    } else {
      porCat.set(cat, {
        categoria_nombre: cat,
        unidades: m.cantidad,
        monto,
      })
    }
  }

  return {
    total_unidades,
    total_monto,
    por_categoria: [...porCat.values()].sort((a, b) => b.monto - a.monto),
  }
}
