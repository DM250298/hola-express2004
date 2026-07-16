import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'

export interface PosicionCaja {
  efectivo: number
  banco: number
  billetera: number
  /** Total ya depositado al banco (remesado). Se resta del total para no contar doble. */
  remesado: number
  total: number
}

/**
 * Suma histórica de remesas, paginada. La tabla crece sin tope: un select plano
 * se trunca en Max Rows (~1000 filas) y el descuento quedaría corto en silencio,
 * inflando el "disponible".
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
 * Cuentas, Caja fuerte y Flujo proyectado.
 *
 * La cuenta "Caja Efectivo" es un acumulado histórico: las remesas acreditan la
 * cuenta bancaria destino pero no la bajan, así que lo ya depositado quedaría
 * contado dos veces (ahí y en el banco). Se resta una vez del total. NO modifica
 * saldos persistidos: es solo cálculo de presentación.
 *
 * Cuando fn_generar_remesa descuente de Caja Efectivo (fix de fondo pendiente),
 * la resta se elimina SOLO acá y todos los consumidores quedan bien.
 */
export async function getPosicionCaja(): Promise<PosicionCaja> {
  const supabase = createClient()
  const [cuentasRes, remesado] = await Promise.all([
    supabase.from('cuentas').select('tipo, saldo_actual').eq('activo', true),
    getTotalRemesado(),
  ])
  if (cuentasRes.error) throw cuentasRes.error

  const posicion: PosicionCaja = {
    efectivo: 0,
    banco: 0,
    billetera: 0,
    remesado,
    total: 0,
  }
  for (const c of cuentasRes.data ?? []) {
    const saldo = Number(c.saldo_actual) || 0
    posicion.total += saldo
    if (c.tipo === 'caja') posicion.efectivo += saldo
    else if (c.tipo === 'banco') posicion.banco += saldo
    else if (c.tipo === 'billetera_virtual') posicion.billetera += saldo
  }
  posicion.total -= remesado
  return posicion
}
