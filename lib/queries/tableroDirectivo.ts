import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
import { getResumenPorCobrar } from '@/lib/queries/acreditaciones'

export interface PosicionCaja {
  efectivo: number
  banco: number
  billetera: number
  total: number
}

export interface DeudaCortoPlazo {
  total_pendiente: number
  vence_7: number
  vence_15: number
  vence_30: number
  vencidas: number
}

export interface ArqueosResumen {
  cantidad: number
  con_diferencia: number
  diferencia_total: number
}

export interface TableroDirectivo {
  capital_inventario: number
  posicion_caja: PosicionCaja
  por_pagar: DeudaCortoPlazo
  por_cobrar_neto: number
  por_cobrar_pendientes: number
  comisiones_periodo: number
  arqueos: ArqueosResumen
}

function diasHasta(fechaIso: string): number {
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const f = new Date(`${fechaIso}T00:00:00`)
  return Math.round((f.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
}

export async function getTableroDirectivo(
  desde: string,
  hasta: string
): Promise<TableroDirectivo> {
  const supabase = createClient()

  // Capital inmovilizado en inventario (a costo)
  const productos = await traerTodo<{
    stock_actual: number
    precio_costo: number
  }>(() =>
    supabase
      .from('productos')
      .select('stock_actual, precio_costo')
      .eq('activo', true)
  )
  const capital_inventario = productos.reduce(
    (acc, p) => acc + (Number(p.stock_actual) || 0) * (Number(p.precio_costo) || 0),
    0
  )

  const [
    cuentasRes,
    pagarRes,
    comisionesRes,
    arqueosRes,
    porCobrar,
  ] = await Promise.all([
    supabase.from('cuentas').select('tipo, saldo_actual').eq('activo', true),
    supabase
      .from('cuentas_a_pagar')
      .select('monto, fecha_vencimiento')
      .eq('estado', 'pendiente'),
    supabase
      .from('movimientos_cuenta')
      .select('monto')
      .eq('categoria', 'comisiones')
      .eq('tipo', 'egreso')
      .gte('fecha', desde)
      .lte('fecha', hasta),
    supabase
      .from('arqueos_tesoreria')
      .select('diferencia, estado')
      .gte('fecha', desde)
      .lte('fecha', hasta),
    getResumenPorCobrar(),
  ])

  // Posición de caja
  const posicion_caja: PosicionCaja = {
    efectivo: 0,
    banco: 0,
    billetera: 0,
    total: 0,
  }
  for (const c of cuentasRes.data ?? []) {
    const saldo = Number(c.saldo_actual) || 0
    posicion_caja.total += saldo
    if (c.tipo === 'caja') posicion_caja.efectivo += saldo
    else if (c.tipo === 'banco') posicion_caja.banco += saldo
    else if (c.tipo === 'billetera_virtual') posicion_caja.billetera += saldo
  }

  // Deudas a corto plazo
  const por_pagar: DeudaCortoPlazo = {
    total_pendiente: 0,
    vence_7: 0,
    vence_15: 0,
    vence_30: 0,
    vencidas: 0,
  }
  for (const d of pagarRes.data ?? []) {
    const monto = Number(d.monto) || 0
    por_pagar.total_pendiente += monto
    const dias = d.fecha_vencimiento ? diasHasta(d.fecha_vencimiento) : 999
    if (dias < 0) por_pagar.vencidas += monto
    else if (dias <= 7) por_pagar.vence_7 += monto
    else if (dias <= 15) por_pagar.vence_15 += monto
    else if (dias <= 30) por_pagar.vence_30 += monto
  }

  const comisiones_periodo = (comisionesRes.data ?? []).reduce(
    (acc, m) => acc + (Number(m.monto) || 0),
    0
  )

  const arqueos: ArqueosResumen = {
    cantidad: (arqueosRes.data ?? []).length,
    con_diferencia: (arqueosRes.data ?? []).filter(
      (a) => a.estado === 'con_diferencia'
    ).length,
    diferencia_total: (arqueosRes.data ?? []).reduce(
      (acc, a) => acc + (Number(a.diferencia) || 0),
      0
    ),
  }

  return {
    capital_inventario,
    posicion_caja,
    por_pagar,
    por_cobrar_neto: porCobrar.monto_neto,
    por_cobrar_pendientes: porCobrar.pendientes,
    comisiones_periodo,
    arqueos,
  }
}
