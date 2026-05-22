import { createClient } from '@/lib/supabase/client'
import type {
  EmpleadoInsert,
  EmpleadoRow,
  EmpleadoUpdate,
  LiquidacionRow,
  NovedadEmpleadoInsert,
  NovedadEmpleadoRow,
  ReciboSueldoRow,
} from '@/types/database'

// ─── Empleados ───────────────────────────────────────────────────────────────

export async function getEmpleados(): Promise<EmpleadoRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('empleados')
    .select('*')
    .order('nombre', { ascending: true })

  if (error) throw error
  return (data ?? []) as EmpleadoRow[]
}

export async function createEmpleado(
  datos: EmpleadoInsert
): Promise<EmpleadoRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('empleados')
    .insert(datos)
    .select()
    .single<EmpleadoRow>()

  if (error) throw error
  return data
}

export async function updateEmpleado(
  id: number,
  datos: EmpleadoUpdate
): Promise<EmpleadoRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('empleados')
    .update({ ...datos, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single<EmpleadoRow>()

  if (error) throw error
  return data
}

export async function toggleEmpleadoActivo(
  id: number,
  activo: boolean
): Promise<EmpleadoRow> {
  return updateEmpleado(id, { activo })
}

// ─── Novedades ───────────────────────────────────────────────────────────────

export interface NovedadConEmpleado extends NovedadEmpleadoRow {
  empleados: { nombre: string } | null
}

export async function getNovedades(
  periodo: string
): Promise<NovedadConEmpleado[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('novedades_empleado')
    .select('*, empleados(nombre)')
    .eq('periodo', periodo)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as unknown as NovedadConEmpleado[]
}

export async function createNovedad(
  datos: NovedadEmpleadoInsert
): Promise<NovedadEmpleadoRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('novedades_empleado')
    .insert(datos)
    .select()
    .single<NovedadEmpleadoRow>()

  if (error) throw error
  return data
}

export async function deleteNovedad(id: number): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('novedades_empleado')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ─── Liquidaciones ───────────────────────────────────────────────────────────

export async function getLiquidaciones(): Promise<LiquidacionRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('liquidaciones')
    .select('*')
    .order('periodo', { ascending: false })

  if (error) throw error
  return (data ?? []) as LiquidacionRow[]
}

export interface ReciboConEmpleado extends ReciboSueldoRow {
  empleados: { nombre: string; puesto: string | null } | null
}

export interface LiquidacionDetalle {
  liquidacion: LiquidacionRow
  recibos: ReciboConEmpleado[]
}

export async function getLiquidacionDetalle(
  id: number
): Promise<LiquidacionDetalle | null> {
  const supabase = createClient()
  const [resLiq, resRecibos] = await Promise.all([
    supabase.from('liquidaciones').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('recibos_sueldo')
      .select('*, empleados(nombre, puesto)')
      .eq('liquidacion_id', id)
      .order('id', { ascending: true }),
  ])

  if (resLiq.error) throw resLiq.error
  if (resRecibos.error) throw resRecibos.error
  if (!resLiq.data) return null

  return {
    liquidacion: resLiq.data as LiquidacionRow,
    recibos: (resRecibos.data ?? []) as unknown as ReciboConEmpleado[],
  }
}

/** Arma (o re-arma) el borrador de liquidación de un período. */
export async function liquidarPeriodo(
  periodo: string,
  aportesPorcentaje: number,
  usuarioId: string
): Promise<LiquidacionRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_liquidar_periodo', {
    p_periodo: periodo,
    p_aportes_porcentaje: aportesPorcentaje,
    p_usuario_id: usuarioId,
  })
  if (error) throw error
  return data as LiquidacionRow
}

/** Confirma el borrador y genera el asiento de devengamiento. */
export async function confirmarLiquidacion(
  liquidacionId: number,
  usuarioId: string
): Promise<LiquidacionRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_confirmar_liquidacion', {
    p_liquidacion_id: liquidacionId,
    p_usuario_id: usuarioId,
  })
  if (error) throw error
  return data as LiquidacionRow
}

/** Paga la liquidación desde una cuenta de tesorería. */
export async function pagarLiquidacion(
  liquidacionId: number,
  cuentaId: number,
  usuarioId: string
): Promise<LiquidacionRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_pagar_liquidacion', {
    p_liquidacion_id: liquidacionId,
    p_cuenta_id: cuentaId,
    p_usuario_id: usuarioId,
  })
  if (error) throw error
  return data as LiquidacionRow
}
