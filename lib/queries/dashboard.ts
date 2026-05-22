import { createClient } from '@/lib/supabase/client'

function inicioDeHoy(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function finDeHoy(): Date {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d
}

function hace7Dias(): { inicio: Date; fin: Date } {
  const inicio = inicioDeHoy()
  inicio.setDate(inicio.getDate() - 7)
  const fin = finDeHoy()
  fin.setDate(fin.getDate() - 7)
  return { inicio, fin }
}

// ─── KPIs del día ────────────────────────────────────────────────────────────

export interface KPIsDia {
  ventas_total: number
  cantidad_tickets: number
  ticket_promedio: number
  turno_activo: {
    id: number
    cajero_nombre: string | null
    fecha_apertura: string
  } | null
}

export async function getKPIsDia(): Promise<KPIsDia> {
  const supabase = createClient()
  const desde = inicioDeHoy().toISOString()
  const hasta = finDeHoy().toISOString()

  const [resultadoVentas, resultadoTurno] = await Promise.all([
    supabase
      .from('ventas')
      .select('total')
      .eq('estado', 'completada')
      .gte('fecha', desde)
      .lte('fecha', hasta),
    supabase
      .from('caja_turnos')
      .select('id, fecha_apertura, usuarios(nombre)')
      .eq('estado', 'abierto')
      .order('fecha_apertura', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (resultadoVentas.error) throw resultadoVentas.error
  if (resultadoTurno.error) throw resultadoTurno.error

  const ventas = resultadoVentas.data ?? []
  const ventas_total = ventas.reduce((acc, v) => acc + Number(v.total), 0)
  const cantidad_tickets = ventas.length
  const ticket_promedio =
    cantidad_tickets > 0 ? ventas_total / cantidad_tickets : 0

  type TurnoCrudo = {
    id: number
    fecha_apertura: string
    usuarios: { nombre: string } | null
  } | null

  const t = resultadoTurno.data as unknown as TurnoCrudo

  return {
    ventas_total,
    cantidad_tickets,
    ticket_promedio,
    turno_activo: t
      ? {
          id: t.id,
          cajero_nombre: t.usuarios?.nombre ?? null,
          fecha_apertura: t.fecha_apertura,
        }
      : null,
  }
}

// ─── Resumen de alertas ──────────────────────────────────────────────────────

export interface AlertasResumen {
  productos_bajo_stock: number
  lotes_por_vencer: number // < 3 días, con stock
  cuentas_vencidas: number
}

export async function getAlertasResumen(): Promise<AlertasResumen> {
  const supabase = createClient()
  const hoyIso = inicioDeHoy().toISOString().slice(0, 10)

  // 3 días desde hoy
  const tresDias = new Date()
  tresDias.setDate(tresDias.getDate() + 3)
  tresDias.setHours(23, 59, 59, 999)
  const tresDiasIso = tresDias.toISOString().slice(0, 10)

  const [productos, lotes, cuentas] = await Promise.all([
    supabase
      .from('productos')
      .select('stock_actual, stock_minimo')
      .eq('activo', true),
    supabase
      .from('lotes')
      .select('id, fecha_vencimiento, cantidad_actual, estado')
      .in('estado', ['activo', 'vencido'])
      .gt('cantidad_actual', 0)
      .lte('fecha_vencimiento', tresDiasIso),
    supabase
      .from('cuentas_a_pagar')
      .select('id, fecha_vencimiento')
      .eq('estado', 'pendiente')
      .lt('fecha_vencimiento', hoyIso),
  ])

  if (productos.error) throw productos.error
  if (lotes.error) throw lotes.error
  if (cuentas.error) throw cuentas.error

  const productos_bajo_stock = (productos.data ?? []).filter(
    (p) => p.stock_actual < p.stock_minimo
  ).length

  return {
    productos_bajo_stock,
    lotes_por_vencer: (lotes.data ?? []).length,
    cuentas_vencidas: (cuentas.data ?? []).length,
  }
}

// ─── Ventas por hora del día (hoy vs hace 7 días) ────────────────────────────

export interface PuntoHora {
  hora: number // 0-23
  hoy: number | null // null si esa hora todavía no llegó
  hace_7_dias: number
}

export async function getVentasPorHora(): Promise<PuntoHora[]> {
  const supabase = createClient()
  const inicioHoy = inicioDeHoy()
  const finHoy = finDeHoy()
  const { inicio: inicio7d, fin: fin7d } = hace7Dias()

  const [hoy, anterior] = await Promise.all([
    supabase
      .from('ventas')
      .select('fecha, total')
      .eq('estado', 'completada')
      .gte('fecha', inicioHoy.toISOString())
      .lte('fecha', finHoy.toISOString()),
    supabase
      .from('ventas')
      .select('fecha, total')
      .eq('estado', 'completada')
      .gte('fecha', inicio7d.toISOString())
      .lte('fecha', fin7d.toISOString()),
  ])

  if (hoy.error) throw hoy.error
  if (anterior.error) throw anterior.error

  const horaActual = new Date().getHours()

  const acumHoy = new Array(24).fill(0) as number[]
  const acumAnt = new Array(24).fill(0) as number[]

  for (const v of hoy.data ?? []) {
    const h = new Date(v.fecha).getHours()
    acumHoy[h] += Number(v.total)
  }
  for (const v of anterior.data ?? []) {
    const h = new Date(v.fecha).getHours()
    acumAnt[h] += Number(v.total)
  }

  return Array.from({ length: 24 }, (_, hora) => ({
    hora,
    hoy: hora > horaActual ? null : acumHoy[hora],
    hace_7_dias: acumAnt[hora],
  }))
}

// ─── Top 5 productos del día ─────────────────────────────────────────────────

export interface TopProductoDia {
  producto_id: number
  nombre: string
  unidades: number
  total_vendido: number
}

export async function getTopProductosDia(
  limite = 5
): Promise<TopProductoDia[]> {
  const supabase = createClient()
  const desde = inicioDeHoy().toISOString()
  const hasta = finDeHoy().toISOString()

  const { data, error } = await supabase
    .from('items_venta')
    .select(
      'cantidad, subtotal, ventas!inner(fecha, estado), productos!inner(id, nombre)'
    )
    .gte('ventas.fecha', desde)
    .lte('ventas.fecha', hasta)
    .eq('ventas.estado', 'completada')

  if (error) throw error

  type Fila = {
    cantidad: number
    subtotal: number
    productos: { id: number; nombre: string }
  }

  const acumulado = new Map<number, TopProductoDia>()
  for (const fila of (data ?? []) as unknown as Fila[]) {
    const previo = acumulado.get(fila.productos.id)
    if (previo) {
      previo.unidades += fila.cantidad
      previo.total_vendido += Number(fila.subtotal)
    } else {
      acumulado.set(fila.productos.id, {
        producto_id: fila.productos.id,
        nombre: fila.productos.nombre,
        unidades: fila.cantidad,
        total_vendido: Number(fila.subtotal),
      })
    }
  }

  return [...acumulado.values()]
    .sort((a, b) => b.unidades - a.unidades)
    .slice(0, limite)
}

// ─── Turnos del día ──────────────────────────────────────────────────────────

export interface TurnoDelDia {
  id: number
  cajero_nombre: string | null
  fecha_apertura: string
  fecha_cierre: string | null
  estado: 'abierto' | 'cerrado'
  monto_apertura: number
  diferencia: number | null
  ventas_total: number
  cantidad_ventas: number
}

export async function getTurnosDelDia(): Promise<TurnoDelDia[]> {
  const supabase = createClient()
  const desde = inicioDeHoy().toISOString()
  const hasta = finDeHoy().toISOString()

  const [turnos, ventas] = await Promise.all([
    supabase
      .from('caja_turnos')
      .select(
        'id, fecha_apertura, fecha_cierre, estado, monto_apertura, diferencia, usuarios(nombre)'
      )
      .gte('fecha_apertura', desde)
      .lte('fecha_apertura', hasta)
      .order('fecha_apertura', { ascending: false }),
    supabase
      .from('ventas')
      .select('turno_id, total')
      .eq('estado', 'completada')
      .gte('fecha', desde)
      .lte('fecha', hasta),
  ])

  if (turnos.error) throw turnos.error
  if (ventas.error) throw ventas.error

  // Agrupar ventas por turno
  const ventasPorTurno = new Map<number, { total: number; count: number }>()
  for (const v of ventas.data ?? []) {
    const prev = ventasPorTurno.get(v.turno_id) ?? { total: 0, count: 0 }
    prev.total += Number(v.total)
    prev.count += 1
    ventasPorTurno.set(v.turno_id, prev)
  }

  type TurnoCrudo = {
    id: number
    fecha_apertura: string
    fecha_cierre: string | null
    estado: 'abierto' | 'cerrado'
    monto_apertura: number
    diferencia: number | null
    usuarios: { nombre: string } | null
  }

  return ((turnos.data ?? []) as unknown as TurnoCrudo[]).map((t) => {
    const v = ventasPorTurno.get(t.id) ?? { total: 0, count: 0 }
    return {
      id: t.id,
      cajero_nombre: t.usuarios?.nombre ?? null,
      fecha_apertura: t.fecha_apertura,
      fecha_cierre: t.fecha_cierre,
      estado: t.estado,
      monto_apertura: t.monto_apertura,
      diferencia: t.diferencia,
      ventas_total: v.total,
      cantidad_ventas: v.count,
    }
  })
}
