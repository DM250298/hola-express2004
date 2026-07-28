/**
 * Registro server-side de una venta a partir de un cobro con terminal aprobado.
 *
 * SOLO SERVIDOR (usa service role). Lo comparten el webhook de MP
 * (`/api/terminales/webhook`) y el endpoint de conciliación
 * (`/api/terminales/conciliar/[id]`).
 *
 * Dada una orden MP `processed` y el id del intento (cobros_terminal):
 *   1. Resuelve la comisión + IIBB REALES del pago (best-effort).
 *   2. Resuelve el medio de pago con `matchMedioPagoPorMP` (server-side).
 *   3. Marca el intento `aprobado` con esos datos.
 *   4. Llama la RPC `fn_registrar_venta_cobro_terminal` (idempotente, imputa la
 *      venta al turno original aunque esté cerrado).
 *   5. Si la RPC falla, marca el intento `fallida` + error (en una operación
 *      aparte que sí persiste).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { consultarCobroRealMP, type OrdenPago } from './point'
import { matchMedioPagoPorMP } from '@/lib/queries/mediosPago'
import type { MedioPagoRow } from '@/types/database'

/** Medio con el que se registra un cobro de terminal cuyo tipo MP no mapea a
 *  ningún medio configurado. Debe existir en la tabla medios_pago. */
const MEDIO_TERMINAL_CATCHALL = 'mp2_otros'

export interface ResultadoRegistro {
  registrada: boolean
  ventaId: number | null
  medioPago: string | null
  error: string | null
}

/**
 * Procesa una orden aprobada: resuelve medio + comisión, actualiza el intento
 * y registra la venta (idempotente). No lanza: devuelve el resultado.
 */
export async function procesarCobroAprobado(
  admin: SupabaseClient,
  orden: OrdenPago,
  cobroId: string
): Promise<ResultadoRegistro> {
  const pago = orden.transactions?.payments?.[0]
  const pm = pago?.payment_method

  // 1. Comisión + IIBB reales (best-effort; el /v1/payments usa el id numérico).
  let comision: number | null = null
  let iibb: number | null = null
  const pagoId = pago?.reference_id ?? pago?.id
  if (pagoId != null) {
    try {
      const real = await consultarCobroRealMP(String(pagoId))
      comision = real.comision
      iibb = real.iibb
    } catch {
      // sin detalle real → la RPC/tabla calcula con el %
    }
  }

  // 2. Medio de pago (server-side, misma lógica que el POS).
  const { data: mediosData } = await admin
    .from('medios_pago')
    .select('*')
    .eq('disponible_terminal', true)
  const medios = (mediosData ?? []) as MedioPagoRow[]
  const medio = matchMedioPagoPorMP(medios, pm?.type, pm?.id)
  const codigoMedio = medio?.codigo ?? MEDIO_TERMINAL_CATCHALL

  const ahora = new Date().toISOString()

  // 3. Marcar el intento como aprobado con el medio + comisión resueltos.
  //    `.is('venta_id', null)`: si ya se registró, no lo pisamos.
  await admin
    .from('cobros_terminal')
    .update({
      estado: 'aprobado',
      medio_pago: codigoMedio,
      comision_real: comision,
      iibb_real: iibb,
      mp_payment_type: pm?.type ?? null,
      mp_payment_method_id: pm?.id ?? null,
      updated_at: ahora,
    })
    .eq('id', cobroId)
    .is('venta_id', null)

  // 4. Registrar la venta (idempotente por venta_id del intento + cliente_uuid).
  const { data: venta, error } = await admin.rpc(
    'fn_registrar_venta_cobro_terminal',
    { p_cobro_id: cobroId }
  )

  if (error) {
    // 5. Persistir el fallo en una operación aparte (la RPC ya hizo rollback).
    await admin
      .from('cobros_terminal')
      .update({ estado: 'fallida', error: error.message, updated_at: new Date().toISOString() })
      .eq('id', cobroId)
      .is('venta_id', null)
    return { registrada: false, ventaId: null, medioPago: codigoMedio, error: error.message }
  }

  const ventaId =
    venta && typeof venta === 'object' && 'id' in venta
      ? ((venta as { id: number }).id ?? null)
      : null
  return { registrada: true, ventaId, medioPago: codigoMedio, error: null }
}
