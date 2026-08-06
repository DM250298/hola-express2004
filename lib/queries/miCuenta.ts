import { createClient } from '@/lib/supabase/client'

/**
 * Autoservicio del empleado (mig 143): su cuenta corriente y sus
 * adelantos/descuentos, resueltos por auth.uid() vía RPCs definer.
 * El empleado NUNCA ve haberes (bono/otro), el básico ni el neto.
 */

export interface MiMovimientoCtaCte {
  id: number
  fecha: string
  tipo: string
  concepto: string | null
  monto: number
}

export interface MiNovedad {
  id: number
  fecha: string
  periodo: string
  tipo: string
  concepto: string | null
  monto: number
}

/** Saldo actual de mi cuenta corriente (positivo = debo). */
export async function getMiSaldoCtaCte(): Promise<number> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_mi_saldo_cta_cte')
  if (error) throw error
  return Number(data) || 0
}

/** Mis movimientos de cuenta corriente, más nuevos primero. */
export async function getMiCtaCte(
  limite = 100
): Promise<MiMovimientoCtaCte[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_mi_cta_cte', {
    p_limite: limite,
  })
  if (error) throw error
  return (data ?? []) as MiMovimientoCtaCte[]
}

/** Mis adelantos y descuentos (solo esos tipos), opcionalmente por período. */
export async function getMisNovedades(
  periodo?: string | null
): Promise<MiNovedad[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_mis_novedades', {
    p_periodo: periodo ?? null,
  })
  if (error) throw error
  return (data ?? []) as MiNovedad[]
}
