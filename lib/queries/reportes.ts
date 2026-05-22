import { createClient } from '@/lib/supabase/client'
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
  const { data, error } = await supabase
    .from('ventas')
    .select('total, fecha, medio_pago')
    .eq('estado', 'completada')
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: true })

  if (error) throw error

  const ventas = data ?? []
  const total = ventas.reduce((acc, v) => acc + Number(v.total), 0)
  const cantidad = ventas.length

  // Por día
  const porDiaMap = new Map<string, PuntoVentaDia>()
  for (const v of ventas) {
    const dia = v.fecha.slice(0, 10)
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
  const { data, error } = await supabase
    .from('items_venta')
    .select(
      'cantidad, subtotal, ventas!inner(fecha, estado), productos!inner(id, nombre, categorias(nombre))'
    )
    .gte('ventas.fecha', desde)
    .lte('ventas.fecha', hasta)
    .eq('ventas.estado', 'completada')

  if (error) throw error

  type Fila = {
    cantidad: number
    subtotal: number
    productos: {
      id: number
      nombre: string
      categorias: { nombre: string } | null
    }
  }

  const acumulado = new Map<number, TopProductoReporte>()
  let totalUnidades = 0
  let totalMonto = 0

  for (const fila of (data ?? []) as unknown as Fila[]) {
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

export async function getRotacionInventario(
  desde: string,
  hasta: string
): Promise<RotacionProducto[]> {
  const supabase = createClient()

  // 1. Productos activos
  const { data: productosData, error: errProd } = await supabase
    .from('productos')
    .select('id, nombre, stock_actual, categorias(nombre)')
    .eq('activo', true)

  if (errProd) throw errProd

  type ProductoFila = {
    id: number
    nombre: string
    stock_actual: number
    categorias: { nombre: string } | null
  }
  const productos = (productosData ?? []) as unknown as ProductoFila[]

  // 2. Ventas del período por producto
  const { data: items, error: errItems } = await supabase
    .from('items_venta')
    .select('cantidad, producto_id, ventas!inner(fecha, estado)')
    .gte('ventas.fecha', desde)
    .lte('ventas.fecha', hasta)
    .eq('ventas.estado', 'completada')

  if (errItems) throw errItems

  type ItemFila = { cantidad: number; producto_id: number }
  const ventasPorProducto = new Map<number, number>()
  for (const it of (items ?? []) as unknown as ItemFila[]) {
    ventasPorProducto.set(
      it.producto_id,
      (ventasPorProducto.get(it.producto_id) ?? 0) + it.cantidad
    )
  }

  // 3. Último movimiento por producto (cualquier tipo)
  const { data: movs, error: errMov } = await supabase
    .from('movimientos_stock')
    .select('producto_id, created_at')
    .order('created_at', { ascending: false })

  if (errMov) throw errMov

  type MovFila = { producto_id: number; created_at: string }
  const ultimoMovPorProducto = new Map<number, string>()
  for (const m of (movs ?? []) as unknown as MovFila[]) {
    if (!ultimoMovPorProducto.has(m.producto_id)) {
      ultimoMovPorProducto.set(m.producto_id, m.created_at)
    }
  }

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

  // Productos activos con stock > 0
  const { data: productosData, error: errProd } = await supabase
    .from('productos')
    .select('id, nombre, stock_actual, precio_costo, categorias(nombre)')
    .eq('activo', true)
    .gt('stock_actual', 0)

  if (errProd) throw errProd

  type ProductoFila = {
    id: number
    nombre: string
    stock_actual: number
    precio_costo: number
    categorias: { nombre: string } | null
  }
  const productos = (productosData ?? []) as unknown as ProductoFila[]

  // Último movimiento por producto
  const { data: movs, error: errMov } = await supabase
    .from('movimientos_stock')
    .select('producto_id, created_at')
    .order('created_at', { ascending: false })

  if (errMov) throw errMov

  type MovFila = { producto_id: number; created_at: string }
  const ultimoMov = new Map<number, string>()
  for (const m of (movs ?? []) as unknown as MovFila[]) {
    if (!ultimoMov.has(m.producto_id)) {
      ultimoMov.set(m.producto_id, m.created_at)
    }
  }

  const ahora = Date.now()
  return productos
    .map((p) => {
      const ultimo = ultimoMov.get(p.id) ?? null
      const diasSin = ultimo
        ? Math.round((ahora - new Date(ultimo).getTime()) / (1000 * 60 * 60 * 24))
        : null
      return {
        producto_id: p.id,
        nombre: p.nombre,
        categoria_nombre: p.categorias?.nombre ?? null,
        stock_actual: p.stock_actual,
        precio_costo: p.precio_costo,
        ultimo_movimiento: ultimo,
        dias_sin_movimiento: diasSin,
        valor_inmovilizado: p.stock_actual * p.precio_costo,
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

  const { data, error } = await supabase
    .from('movimientos_stock')
    .select(
      'cantidad, productos(precio_costo, categorias(nombre))'
    )
    .eq('tipo', 'merma')
    .gte('created_at', desde)
    .lte('created_at', hasta)

  if (error) throw error

  type FilaMerma = {
    cantidad: number
    productos: {
      precio_costo: number
      categorias: { nombre: string } | null
    } | null
  }

  let total_unidades = 0
  let total_monto = 0
  const porCat = new Map<string, MermaPorCategoria>()

  for (const m of (data ?? []) as unknown as FilaMerma[]) {
    const costo = m.productos?.precio_costo ?? 0
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
