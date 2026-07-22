import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'

export interface PosicionCaja {
  efectivo: number
  banco: number
  billetera: number
  total: number
}

/**
 * Suma histórica de remesas, paginada. La tabla crece sin tope: un select plano
 * se trunca en Max Rows (~1000 filas) y la suma quedaría corta en silencio.
 * Se usa solo como dato informativo del desglose de Caja fuerte.
 */
export async function getTotalRemesado(): Promise<number> {
  const supabase = createClient()
  const remesas = await traerTodo<{ monto: number }>(() =>
    supabase.from('remesas').select('monto').order('id')
  )
  return remesas.reduce((acc, r) => acc + (Number(r.monto) || 0), 0)
}

/**
 * Cálculo canónico de "cuánta plata hay" — única fuente para el Tablero,
 * Cuentas y Flujo proyectado.
 *
 * Desde el candado (migración 118) la cuenta "Caja Efectivo" ES la caja
 * fuerte: se acredita SOLO al validar el arqueo (control administrativo),
 * los movimientos manuales la mueven de verdad y las remesas la debitan.
 * Su saldo es real → no hay que restar lo remesado ni compensar nada.
 */
export async function getPosicionCaja(): Promise<PosicionCaja> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('cuentas')
    .select('tipo, saldo_actual')
    .eq('activo', true)
  if (error) throw error

  const posicion: PosicionCaja = {
    efectivo: 0,
    banco: 0,
    billetera: 0,
    total: 0,
  }
  for (const c of data ?? []) {
    const saldo = Number(c.saldo_actual) || 0
    posicion.total += saldo
    if (c.tipo === 'caja') posicion.efectivo += saldo
    else if (c.tipo === 'banco') posicion.banco += saldo
    else if (c.tipo === 'billetera_virtual') posicion.billetera += saldo
  }
  return posicion
}
