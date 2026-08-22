import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
import { getResumenPorCobrar } from '@/lib/queries/acreditaciones'
import { derivarCuotas, type CuotaCruda } from '@/lib/queries/finanzas'
import { costoDesdeEmbed } from '@/lib/queries/productos'
import { getPosicionCaja, type PosicionCaja } from '@/lib/queries/posicionCaja'
import { fechaLocal } from '@/lib/utils/periodos'

export type { PosicionCaja }

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
    costos_producto: { precio_costo: number } | { precio_costo: number }[] | null
  }>(() =>
    supabase
      .from('productos')
      .select('stock_actual, costos_producto(precio_costo)')
      .eq('activo', true)
  )
  const capital_inventario = productos.reduce(
    (acc, p) => acc + (Number(p.stock_actual) || 0) * costoDesdeEmbed(p.costos_producto),
    0
  )

  const [posicion_caja, pagarData, arqueosData, porCobrar] = await Promise.all([
    // Cálculo canónico (cuentas activas; la caja fuerte es saldo real desde
    // el candado de la mig 118), compartido con Cuentas y Flujo proyectado.
    getPosicionCaja(),
    traerTodo<{
      monto: number
      monto_pagado: number | null
      fecha_vencimiento: string | null
      pagos_cuenta: { sobrante: number | null }[] | null
      cuotas_cuenta_pagar: CuotaCruda[] | null
    }>(() =>
      supabase
        .from('cuentas_a_pagar')
        .select(
          'monto, monto_pagado, fecha_vencimiento, pagos_cuenta(sobrante), cuotas_cuenta_pagar(id, numero, monto, fecha_vencimiento)'
        )
        .eq('estado', 'pendiente')
        .order('id')
    ),
    // arqueos_tesoreria.fecha es DATE → comparar contra fecha local
    traerTodo<{ diferencia: number | null; estado: string }>(() =>
      supabase
        .from('arqueos_tesoreria')
        .select('diferencia, estado')
        .gte('fecha', fechaLocal(desde))
        .lte('fecha', fechaLocal(hasta))
        .order('id')
    ),
    getResumenPorCobrar(),
  ])

  // Deudas a corto plazo
  const por_pagar: DeudaCortoPlazo = {
    total_pendiente: 0,
    vence_7: 0,
    vence_15: 0,
    vence_30: 0,
    vencidas: 0,
  }
  for (const d of pagarData) {
    // Deuda VIVA = monto − aplicado (pagado − sobrantes por redondeo), igual
    // que saldo_pendiente en finanzas.ts: los pagos parciales del flujo
    // integrado (mig 144) dejaban el KPI sumando el total como si nada se
    // hubiera pagado.
    const pagado = Number(d.monto_pagado) || 0
    const sobrantes = (d.pagos_cuenta ?? []).reduce(
      (acc, p) => acc + Number(p.sobrante ?? 0),
      0
    )
    const aplicado = Math.max(0, pagado - sobrantes)
    const monto = Math.max(0, (Number(d.monto) || 0) - aplicado)
    if (monto <= 0) continue
    por_pagar.total_pendiente += monto
    // Con plan de cuotas (mig 148) cada cuota impaga bucketea por SU fecha
    // (Σ de los restos = monto); sin plan, el saldo entero por el vencimiento.
    const cuotas = derivarCuotas(
      Number(d.monto) || 0,
      aplicado,
      'pendiente',
      d.cuotas_cuenta_pagar
    )
    if (cuotas.length > 0) {
      for (const q of cuotas) {
        const resto = q.monto - q.pagado
        if (resto <= 0.009) continue
        const dias = diasHasta(q.fecha_vencimiento)
        if (dias < 0) por_pagar.vencidas += resto
        else if (dias <= 7) por_pagar.vence_7 += resto
        else if (dias <= 15) por_pagar.vence_15 += resto
        else if (dias <= 30) por_pagar.vence_30 += resto
      }
    } else {
      const dias = d.fecha_vencimiento ? diasHasta(d.fecha_vencimiento) : 999
      if (dias < 0) por_pagar.vencidas += monto
      else if (dias <= 7) por_pagar.vence_7 += monto
      else if (dias <= 15) por_pagar.vence_15 += monto
      else if (dias <= 30) por_pagar.vence_30 += monto
    }
  }

  const arqueos: ArqueosResumen = {
    cantidad: arqueosData.length,
    con_diferencia: arqueosData.filter((a) => a.estado === 'con_diferencia')
      .length,
    diferencia_total: arqueosData.reduce(
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
    arqueos,
  }
}
