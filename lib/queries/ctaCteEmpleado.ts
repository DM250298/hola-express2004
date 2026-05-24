import { createClient } from '@/lib/supabase/client'
import type {
  CuentaCorrienteEmpleadoInsert,
  CuentaCorrienteEmpleadoRow,
  EmpleadoConSaldo,
} from '@/types/database'

/** Listado de empleados activos con su saldo deudor de cta. cte. */
export async function getEmpleadosConSaldo(): Promise<EmpleadoConSaldo[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('vista_empleados_saldo')
    .select('*')
    .order('nombre', { ascending: true })
  if (error) throw error
  return (data ?? []) as EmpleadoConSaldo[]
}

/** Movimientos de un empleado, más nuevos primero. */
export async function getMovimientosCtaCte(
  empleadoId: number
): Promise<CuentaCorrienteEmpleadoRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('cuenta_corriente_empleado')
    .select('*')
    .eq('empleado_id', empleadoId)
    .order('fecha', { ascending: false })
    .order('id', { ascending: false })
  if (error) throw error
  return (data ?? []) as CuentaCorrienteEmpleadoRow[]
}

/** Crear un movimiento manual (consumo o pago_libre o ajuste). */
export async function crearMovimientoCtaCte(
  datos: CuentaCorrienteEmpleadoInsert
): Promise<CuentaCorrienteEmpleadoRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('cuenta_corriente_empleado')
    .insert(datos)
    .select()
    .single<CuentaCorrienteEmpleadoRow>()
  if (error) throw error
  return data
}

/**
 * Elimina un movimiento manual. No deja borrar los `descuento_sueldo` que
 * fueron generados por una liquidación: esos se borran cuando se regenera
 * el borrador de liquidación (cascade vía recibo_id).
 */
export async function eliminarMovimientoCtaCte(id: number): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('cuenta_corriente_empleado')
    .delete()
    .eq('id', id)
    .is('recibo_id', null)
  if (error) throw error
}
