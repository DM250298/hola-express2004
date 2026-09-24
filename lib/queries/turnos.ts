import { createClient } from '@/lib/supabase/client'
import type { CajaTurnoRow } from '@/types/database'

/**
 * Turno abierto del usuario. Con el índice único de la migración 218 hay a
 * lo sumo uno por usuario; el order/limit queda como defensa.
 */
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

/**
 * Abre el turno del usuario de la SESIÓN (`fn_abrir_turno`, mig 218): la
 * identidad la pone `auth.uid()`, el POS ya no la manda. Idempotente: si el
 * usuario ya tenía un turno abierto, devuelve ese en vez de crear otro.
 */
export async function abrirTurno(montoApertura: number): Promise<CajaTurnoRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_abrir_turno', {
    p_monto_apertura: montoApertura,
  })
  if (error) throw error
  if (!data) throw new Error('No se pudo abrir el turno.')
  const t = data as CajaTurnoRow
  return { ...t, monto_apertura: Number(t.monto_apertura) }
}

export interface DesgloseMedioTurno {
  codigo: string
  total: number
  cantidad: number
}

export interface ProductoVendidoTurno {
  nombre: string
  cantidad: number
  unidad: string
}

/** Resumen de caja de un turno (`fn_resumen_turno`, mig 218). */
export interface ResumenTurno {
  turno_id: number
  usuario_id: string
  cajero_nombre: string | null
  estado: 'abierto' | 'cerrado'
  fecha_apertura: string
  fecha_cierre: string | null
  monto_apertura: number
  cantidad_ventas: number
  total_ventas: number
  por_medio: DesgloseMedioTurno[]
  productos: ProductoVendidoTurno[]
  total_ventas_efectivo: number
  /** Cobros de fiado en efectivo del turno (suman al esperado). */
  cobros_fiado: number
  gastos: number
  sangrias: number
  /** apertura + efectivo + fiado − gastos − sangrías, calculado en la base. */
  monto_esperado: number
}

type Crudo = Record<string, unknown>

function num(v: unknown): number {
  return Number(v ?? 0)
}

/**
 * Resumen del turno calculado en el servidor: sin tope de 1000 filas y sin
 * ceros por RLS cuando lo consulta alguien que no es el dueño (Finanzas).
 */
export async function getResumenTurno(turnoId: number): Promise<ResumenTurno> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_resumen_turno', {
    p_turno_id: turnoId,
  })
  if (error) throw error
  const r = (data ?? {}) as Crudo
  const porMedio = ((r.por_medio as Crudo[] | null) ?? []).map((m) => ({
    codigo: String(m.codigo),
    total: num(m.total),
    cantidad: num(m.cantidad),
  }))
  const productos = ((r.productos as Crudo[] | null) ?? []).map((p) => ({
    nombre: String(p.nombre),
    cantidad: num(p.cantidad),
    unidad: String(p.unidad ?? ''),
  }))
  return {
    turno_id: num(r.turno_id),
    usuario_id: String(r.usuario_id ?? ''),
    cajero_nombre: (r.cajero_nombre as string | null) ?? null,
    estado: r.estado === 'cerrado' ? 'cerrado' : 'abierto',
    fecha_apertura: String(r.fecha_apertura ?? ''),
    fecha_cierre: (r.fecha_cierre as string | null) ?? null,
    monto_apertura: num(r.monto_apertura),
    cantidad_ventas: num(r.cantidad_ventas),
    total_ventas: num(r.total_ventas),
    por_medio: porMedio,
    productos,
    total_ventas_efectivo: num(r.total_ventas_efectivo),
    cobros_fiado: num(r.cobros_fiado),
    gastos: num(r.gastos),
    sangrias: num(r.sangrias),
    monto_esperado: num(r.monto_esperado),
  }
}

export interface ResultadoCierre {
  turno: CajaTurnoRow
  /** Dueño real del turno (para el comprobante). */
  cajero_nombre: string | null
  monto_esperado: number
  diferencia: number
  total_ventas_efectivo: number
  /** Cobros de fiado en efectivo del turno (también suman al esperado). */
  total_cobros_fiado: number
  gastos: number
  sangrias: number
  /** Sangría automática del efectivo contado (al buzón), si el contado fue > 0. */
  sangria_id: number | null
}

/**
 * Cierra el turno en UNA transacción del servidor (`fn_cerrar_turno`, mig
 * 218): esperado = apertura + efectivo + fiado − gastos − sangrías, dueño o
 * Finanzas, solo si sigue abierto, `cerrado_por` = sesión, y la sangría
 * automática del efectivo contado en la misma transacción.
 */
export async function cerrarTurno(
  turnoId: number,
  montoCierreReal: number,
  novedades: string | null
): Promise<ResultadoCierre> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_cerrar_turno', {
    p_turno_id: turnoId,
    p_monto_cierre_real: montoCierreReal,
    p_novedades: novedades,
  })
  if (error) throw error
  const r = (data ?? {}) as Crudo
  const turno = (r.turno ?? {}) as CajaTurnoRow
  return {
    turno: {
      ...turno,
      monto_apertura: num(turno.monto_apertura),
      monto_cierre_real: turno.monto_cierre_real == null ? null : num(turno.monto_cierre_real),
      monto_cierre_esperado:
        turno.monto_cierre_esperado == null ? null : num(turno.monto_cierre_esperado),
      diferencia: turno.diferencia == null ? null : num(turno.diferencia),
    },
    cajero_nombre: (r.cajero_nombre as string | null) ?? null,
    monto_esperado: num(r.monto_esperado),
    diferencia: num(r.diferencia),
    total_ventas_efectivo: num(r.total_ventas_efectivo),
    total_cobros_fiado: num(r.total_cobros_fiado),
    gastos: num(r.gastos),
    sangrias: num(r.sangrias),
    sangria_id: r.sangria_id == null ? null : num(r.sangria_id),
  }
}
