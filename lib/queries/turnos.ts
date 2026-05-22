import { createClient } from '@/lib/supabase/client'
import type { CajaTurnoRow } from '@/types/database'

export async function getTurnoActivo(
  usuarioId: string
): Promise<CajaTurnoRow | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('caja_turnos')
    .select('*')
    .eq('usuario_id', usuarioId)
    .eq('estado', 'abierto')
    .order('fecha_apertura', { ascending: false })
    .limit(1)
    .maybeSingle<CajaTurnoRow>()

  if (error) throw error
  return data
}

export async function abrirTurno(
  usuarioId: string,
  montoApertura: number
): Promise<CajaTurnoRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('caja_turnos')
    .insert({
      usuario_id: usuarioId,
      monto_apertura: montoApertura,
      estado: 'abierto',
    })
    .select()
    .single<CajaTurnoRow>()

  if (error) throw error
  return data
}

export interface ResultadoCierre {
  turno: CajaTurnoRow
  monto_esperado: number
  diferencia: number
  total_ventas_efectivo: number
}

export async function cerrarTurno(
  turnoId: number,
  montoCierreReal: number,
  novedades: string | null
): Promise<ResultadoCierre> {
  const supabase = createClient()

  // 1. Obtener el turno + ventas en efectivo del turno para calcular monto esperado
  const { data: turnoActual, error: errorTurno } = await supabase
    .from('caja_turnos')
    .select('monto_apertura')
    .eq('id', turnoId)
    .single<{ monto_apertura: number }>()
  if (errorTurno) throw errorTurno

  // Suma efectivo desde pagos_venta (precisión con split payment) joineando
  // a ventas para filtrar por turno y estado.
  const { data: pagosEfectivo, error: errorVentas } = await supabase
    .from('pagos_venta')
    .select('monto, ventas!inner(turno_id, estado)')
    .eq('medio_pago', 'efectivo')
    .eq('ventas.turno_id', turnoId)
    .eq('ventas.estado', 'completada')

  if (errorVentas) throw errorVentas

  const totalVentasEfectivo = (pagosEfectivo ?? []).reduce(
    (acc, p) => acc + Number((p as { monto: number }).monto),
    0
  )

  // Gastos de caja registrados contra este turno (salen del efectivo).
  // Si la columna turno_id aún no existe (migración 009 sin correr) se
  // ignora el error y se asume 0 gastos.
  const { data: gastosData } = await supabase
    .from('egresos')
    .select('monto')
    .eq('turno_id', turnoId)

  const totalGastos = (gastosData ?? []).reduce(
    (acc, g) => acc + Number((g as { monto: number }).monto),
    0
  )

  const montoEsperado =
    Number(turnoActual.monto_apertura) + totalVentasEfectivo - totalGastos
  const diferencia = montoCierreReal - montoEsperado

  // 2. Cerrar el turno
  const { data: turno, error } = await supabase
    .from('caja_turnos')
    .update({
      fecha_cierre: new Date().toISOString(),
      monto_cierre_real: montoCierreReal,
      monto_cierre_esperado: montoEsperado,
      diferencia,
      estado: 'cerrado',
      novedades,
    })
    .eq('id', turnoId)
    .select()
    .single<CajaTurnoRow>()

  if (error) throw error
  return {
    turno,
    monto_esperado: montoEsperado,
    diferencia,
    total_ventas_efectivo: totalVentasEfectivo,
  }
}
