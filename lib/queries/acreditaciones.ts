import { createClient } from '@/lib/supabase/client'
import type { AcreditacionRow, EstadoAcreditacion } from '@/types/database'

export interface AcreditacionConCuenta extends AcreditacionRow {
  cuenta_nombre: string | null
}

export interface FiltrosAcreditaciones {
  estado?: EstadoAcreditacion | null
  desde?: string | null
  hasta?: string | null
}

/** Lista acreditaciones (cuentas por cobrar de tarjetas/MP). */
export async function getAcreditaciones(
  filtros: FiltrosAcreditaciones = {}
): Promise<AcreditacionConCuenta[]> {
  const supabase = createClient()
  let q = supabase
    .from('acreditaciones')
    .select('*, cuentas(nombre)')
    .order('fecha_estimada', { ascending: true })

  if (filtros.estado) q = q.eq('estado', filtros.estado)
  if (filtros.desde) q = q.gte('fecha_estimada', filtros.desde)
  if (filtros.hasta) q = q.lte('fecha_estimada', filtros.hasta)

  const { data, error } = await q
  if (error) throw error

  type Fila = AcreditacionRow & { cuentas: { nombre: string } | null }
  return ((data ?? []) as unknown as Fila[]).map(({ cuentas, ...resto }) => ({
    ...resto,
    cuenta_nombre: cuentas?.nombre ?? null,
  }))
}

export interface ResumenPorCobrar {
  pendientes: number // cantidad de acreditaciones pendientes
  monto_bruto: number
  monto_neto: number
  comision_total: number
  /** Agrupado por medio de pago. */
  por_medio: { medio_pago: string; cantidad: number; monto_neto: number }[]
  /** Próximas acreditaciones a recibir (≤ 7 días). */
  proximos_7_dias: number
}

export async function getResumenPorCobrar(): Promise<ResumenPorCobrar> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('acreditaciones')
    .select('medio_pago, monto_bruto, monto_neto, comision_monto, fecha_estimada')
    .eq('estado', 'pendiente')
  if (error) throw error

  const filas = data ?? []
  let monto_bruto = 0
  let monto_neto = 0
  let comision_total = 0
  let proximos_7_dias = 0
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const en7 = new Date(hoy)
  en7.setDate(en7.getDate() + 7)

  const mapaMedio = new Map<
    string,
    { medio_pago: string; cantidad: number; monto_neto: number }
  >()

  for (const f of filas) {
    monto_bruto += Number(f.monto_bruto)
    monto_neto += Number(f.monto_neto)
    comision_total += Number(f.comision_monto)
    const fe = new Date(`${f.fecha_estimada}T00:00:00`)
    if (fe <= en7) proximos_7_dias += Number(f.monto_neto)
    const prev = mapaMedio.get(f.medio_pago)
    if (prev) {
      prev.cantidad += 1
      prev.monto_neto += Number(f.monto_neto)
    } else {
      mapaMedio.set(f.medio_pago, {
        medio_pago: f.medio_pago,
        cantidad: 1,
        monto_neto: Number(f.monto_neto),
      })
    }
  }

  return {
    pendientes: filas.length,
    monto_bruto,
    monto_neto,
    comision_total,
    por_medio: [...mapaMedio.values()].sort(
      (a, b) => b.monto_neto - a.monto_neto
    ),
    proximos_7_dias,
  }
}

export interface AcreditarPayload {
  acreditacion_id: number
  usuario_id: string
  fecha_real: string | null
}

export async function acreditarPago(payload: AcreditarPayload) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_acreditar_pago', {
    p_acreditacion_id: payload.acreditacion_id,
    p_usuario_id: payload.usuario_id,
    p_fecha_real: payload.fecha_real,
  })
  if (error) throw error
  return data
}

/** Marca varias acreditaciones como acreditadas (lote desde el extracto). */
export async function acreditarLote(
  ids: number[],
  usuarioId: string,
  fecha: string | null
) {
  const resultados = []
  for (const id of ids) {
    resultados.push(
      await acreditarPago({ acreditacion_id: id, usuario_id: usuarioId, fecha_real: fecha })
    )
  }
  return resultados
}
