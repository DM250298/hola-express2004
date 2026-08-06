import { createClient } from '@/lib/supabase/client'
import type {
  CuentaCorrienteClienteRow,
  CuentaCorrienteEmpleadoRow,
  DeudorBuscado,
  LimiteCreditoInsert,
  LimiteCreditoRow,
  TipoDeudorCtaCte,
} from '@/types/database'

/**
 * Cuenta corriente (fiado) unificada de clientes y empleados.
 *
 * Modelo: libro de movimientos con signo (consumo +, pago −); el saldo de un
 * deudor es sum(monto). El tope de fiado vive en `limite_credito` (sin fila o
 * monto 0 = no se le fía). Los movimientos del POS y la cobranza entran por
 * RPCs `security definer`; acá solo hay lecturas y el ABM del tope.
 */

// ─── Cartera (tab Fiado en Finanzas) ─────────────────────────────────────────

export interface DeudorCartera {
  deudor_tipo: TipoDeudorCtaCte
  deudor_id: number
  nombre: string
  documento: string | null
  saldo: number
  tiene_cupo: boolean
  disponible: number | null
}

/**
 * Cartera completa de deudores vía fn_buscar_deudores (definer). Con búsqueda
 * vacía la RPC lista a todos; el límite alto trae la cartera entera.
 */
export async function getCarteraFiado(
  busqueda?: string
): Promise<DeudorCartera[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_buscar_deudores', {
    p_busqueda: busqueda ?? '',
    p_limite: 1000,
  })
  if (error) throw error
  return (data ?? []) as DeudorCartera[]
}

/** Buscador liviano del POS (máx. 8 resultados). */
export async function buscarDeudores(
  busqueda: string,
  limite = 8
): Promise<DeudorBuscado[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_buscar_deudores', {
    p_busqueda: busqueda,
    p_limite: limite,
  })
  if (error) throw error
  return (data ?? []) as DeudorBuscado[]
}

// ─── Movimientos de un deudor ────────────────────────────────────────────────

export interface MovimientoCtaCteUnificado {
  id: number
  fecha: string
  tipo: string
  concepto: string | null
  monto: number
  venta_id: number | null
  created_at: string
}

/** Movimientos de un deudor (cliente o empleado), más nuevos primero. */
export async function getMovimientosDeudor(
  deudorTipo: TipoDeudorCtaCte,
  deudorId: number
): Promise<MovimientoCtaCteUnificado[]> {
  const supabase = createClient()
  if (deudorTipo === 'cliente') {
    const { data, error } = await supabase
      .from('cuenta_corriente_cliente')
      .select('*')
      .eq('cliente_id', deudorId)
      .order('fecha', { ascending: false })
      .order('id', { ascending: false })
    if (error) throw error
    return ((data ?? []) as CuentaCorrienteClienteRow[]).map((m) => ({
      id: m.id,
      fecha: m.fecha,
      tipo: m.tipo,
      concepto: m.concepto,
      monto: m.monto,
      venta_id: m.venta_id,
      created_at: m.created_at,
    }))
  }
  const { data, error } = await supabase
    .from('cuenta_corriente_empleado')
    .select('*')
    .eq('empleado_id', deudorId)
    .order('fecha', { ascending: false })
    .order('id', { ascending: false })
  if (error) throw error
  return ((data ?? []) as CuentaCorrienteEmpleadoRow[]).map((m) => ({
    id: m.id,
    fecha: m.fecha,
    tipo: m.tipo,
    concepto: m.concepto,
    monto: m.monto,
    venta_id: m.venta_id,
    created_at: m.created_at,
  }))
}

// ─── Límite de crédito (tope de fiado) ───────────────────────────────────────

/** Tope actual de un deudor, o null si no tiene fila (no se le fía). */
export async function getLimiteCredito(
  deudorTipo: TipoDeudorCtaCte,
  deudorId: number
): Promise<LimiteCreditoRow | null> {
  const supabase = createClient()
  const columna = deudorTipo === 'cliente' ? 'cliente_id' : 'empleado_id'
  const { data, error } = await supabase
    .from('limite_credito')
    .select('*')
    .eq(columna, deudorId)
    .maybeSingle<LimiteCreditoRow>()
  if (error) throw error
  return data
}

export interface SetLimitePayload {
  deudor_tipo: TipoDeudorCtaCte
  deudor_id: number
  monto: number
  nota?: string | null
  usuario_id: string
}

/**
 * Crea o actualiza el tope de un deudor. No usa upsert: el índice único es
 * PARCIAL (where cliente_id is not null) y Postgres no lo puede inferir en
 * un ON CONFLICT sin el predicado → update por id o insert según exista.
 */
export async function setLimiteCredito(
  payload: SetLimitePayload
): Promise<LimiteCreditoRow> {
  const supabase = createClient()
  const esCliente = payload.deudor_tipo === 'cliente'
  const existente = await getLimiteCredito(
    payload.deudor_tipo,
    payload.deudor_id
  )
  if (existente) {
    const { data, error } = await supabase
      .from('limite_credito')
      .update({
        monto: payload.monto,
        nota: payload.nota ?? null,
        usuario_id: payload.usuario_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existente.id)
      .select()
      .single<LimiteCreditoRow>()
    if (error) throw error
    return data
  }
  const fila: LimiteCreditoInsert = {
    cliente_id: esCliente ? payload.deudor_id : null,
    empleado_id: esCliente ? null : payload.deudor_id,
    monto: payload.monto,
    nota: payload.nota ?? null,
    usuario_id: payload.usuario_id,
  }
  const { data, error } = await supabase
    .from('limite_credito')
    .insert(fila)
    .select()
    .single<LimiteCreditoRow>()
  if (error) throw error
  return data
}

/** Sugerencia de tope del empleado (= sueldo básico). Solo rrhh_sueldos. */
export async function getLimiteSugeridoEmpleado(
  empleadoId: number
): Promise<number> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_limite_sugerido_empleado', {
    p_empleado_id: empleadoId,
  })
  if (error) throw error
  return (data as number) ?? 0
}

// ─── Cobranza ────────────────────────────────────────────────────────────────

export interface CobrarCtaCtePayload {
  deudor_tipo: TipoDeudorCtaCte
  deudor_id: number
  monto: number
  usuario_id: string
  /** Cobro por tesorería (Finanzas): cuenta que se acredita. */
  cuenta_id?: number | null
  /** Cobro en efectivo en la caja del POS: turno abierto. */
  turno_id?: number | null
  /** ISO yyyy-mm-dd. Solo para cobros por tesorería con fecha pasada. */
  fecha?: string | null
  nota?: string | null
}

export interface ResultadoCobroCtaCte {
  movimiento_cta_cte_id: number
  saldo_anterior: number
  saldo_nuevo: number
  asiento_id: number | null
  movimiento_id: number | null
}

/**
 * Cobra (parcial o total) la deuda de un deudor vía fn_cobrar_cta_cte.
 * Modos excluyentes: turno_id (efectivo del POS, entra al arqueo) o
 * cuenta_id (tesorería). El server valida saldo, permisos y período.
 */
export async function cobrarCtaCte(
  payload: CobrarCtaCtePayload
): Promise<ResultadoCobroCtaCte> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_cobrar_cta_cte', {
    p_deudor_tipo: payload.deudor_tipo,
    p_deudor_id: payload.deudor_id,
    p_monto: payload.monto,
    p_usuario_id: payload.usuario_id,
    p_cuenta_id: payload.cuenta_id ?? null,
    p_turno_id: payload.turno_id ?? null,
    p_fecha: payload.fecha ?? null,
    p_nota: payload.nota ?? null,
  })
  if (error) throw error
  return data as unknown as ResultadoCobroCtaCte
}

/**
 * Total de cobros de fiado en EFECTIVO de un turno (suma al esperado del
 * cierre). Devuelve 0 si la migración 141 aún no corrió.
 */
export async function getCobrosFiadoTurno(turnoId: number): Promise<number> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_cobros_fiado_turno', {
    p_turno_id: turnoId,
  })
  if (error) return 0
  return Number(data) || 0
}
