import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  crearOrdenPago,
  liberarDispositivo,
  liberarOrdenesPendientes,
} from '@/lib/mercadopago/point'

export const runtime = 'nodejs'

interface ItemCobro {
  producto_id: number
  cantidad: number
  precio_unitario: number
  /** Lista aplicada (mig 153); el jsonb persiste el ítem completo tal cual. */
  lista_precio?: 'minorista' | 'mayorista'
}

/**
 * Crea una orden de cobro en una terminal Point.
 * Body: {
 *   device_id: string, monto: number (pesos), referencia?: string,
 *   items?: ItemCobro[], pagos_previos?: Pago[],
 *   turno_id?: number, usuario_id?: string, cliente_id?: number|null
 * }
 *
 * BLINDAJE (mig 128): antes de mandar la orden a MP se crea un "intento de
 * cobro" (cobros_terminal) con el carrito y el contexto de la venta. El
 * `external_reference` que se le manda a MP es el id de ese intento, para que
 * el webhook pueda encontrarlo y registrar la venta aunque la pestaña del POS
 * muera. Devuelve `{ orden, cobro_id }`.
 *
 * Si MP responde `already_queued_order_on_terminal`, la ruta intenta
 * cancelar automáticamente las órdenes pendientes de la terminal y
 * reintenta UNA vez.
 */
export async function POST(request: Request) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  }

  // Cobrar con terminal es una acción de caja: exigir permiso pos o terminales.
  // fn_tiene_permiso evalúa para el usuario logueado (auth.uid()).
  const [{ data: puedePos }, { data: puedeTerminales }] = await Promise.all([
    supabase.rpc('fn_tiene_permiso', { p_clave: 'pos' }),
    supabase.rpc('fn_tiene_permiso', { p_clave: 'terminales' }),
  ])
  if (!puedePos && !puedeTerminales) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  }

  let body: {
    device_id?: string
    monto?: number
    referencia?: string
    items?: ItemCobro[]
    pagos_previos?: unknown[]
    cliente_id?: number | null
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const deviceId = (body.device_id ?? '').trim()
  const monto = Number(body.monto)

  if (!deviceId) {
    return NextResponse.json(
      { error: 'Falta el identificador de la terminal.' },
      { status: 400 }
    )
  }
  if (!(monto > 0)) {
    return NextResponse.json(
      { error: 'El monto debe ser mayor a cero.' },
      { status: 400 }
    )
  }

  const items = Array.isArray(body.items) ? body.items : []
  const pagosPrevios = Array.isArray(body.pagos_previos) ? body.pagos_previos : []
  const clienteId = body.cliente_id ?? null

  // El vendedor y el turno se DERIVAN de la sesión, nunca del body: no confiar
  // en datos del cliente para atribuir una venta. El turno es el turno abierto
  // del propio usuario.
  const usuarioId = user.id
  const admin = createAdminClient()
  const { data: turnoAbierto } = await admin
    .from('caja_turnos')
    .select('id')
    .eq('usuario_id', usuarioId)
    .eq('estado', 'abierto')
    .maybeSingle()
  const turnoId = (turnoAbierto?.id as number | undefined) ?? null

  // Solo creamos el intento si tenemos lo mínimo para registrar la venta desde
  // el webhook (carrito + turno abierto del usuario). Si no, se cobra igual pero
  // sin blindaje (ej: "probar cobro" desde Terminales, sin items).
  const puedeBlindar = items.length > 0 && turnoId != null
  const cobroId = puedeBlindar ? crypto.randomUUID() : null

  if (cobroId) {
    const { error: errIntento } = await admin.from('cobros_terminal').insert({
      id: cobroId,
      external_reference: cobroId,
      device_id: deviceId,
      turno_id: turnoId,
      usuario_id: usuarioId,
      cliente_id: clienteId,
      monto,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: items as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pagos_previos: pagosPrevios as any,
      estado: 'pendiente',
    })
    if (errIntento) {
      // Si falla el intento, NO cobramos: preferimos frenar antes que cobrar
      // sin red de seguridad.
      return NextResponse.json(
        { error: `No se pudo preparar el cobro: ${errIntento.message}` },
        { status: 500 }
      )
    }
  }

  // El external_reference es el id del intento (si hay blindaje) o un fallback.
  const referencia = cobroId ?? `venta_pos_${Date.now()}`
  const notificationUrl = process.env.MP_WEBHOOK_URL || undefined

  async function marcarIntento(orden_mp_id: string | null, estado?: string) {
    if (!cobroId) return
    await admin
      .from('cobros_terminal')
      .update({
        orden_mp_id,
        ...(estado ? { estado } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', cobroId)
  }

  try {
    const orden = await crearOrdenPago(deviceId, monto, referencia, notificationUrl)
    await marcarIntento(orden.id)
    return NextResponse.json({ orden, cobro_id: cobroId })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    // Si la terminal tiene una orden colgada, intentamos limpiarla por las
    // dos vías (cancel a nivel /v1/orders + liberar el dispositivo legacy)
    // y reintentar.
    if (/already_queued/i.test(msg)) {
      const canceladas = await liberarOrdenesPendientes(deviceId)
      try {
        await liberarDispositivo(deviceId)
      } catch {
        // si el endpoint legacy no responde, seguimos igual
      }
      try {
        const orden = await crearOrdenPago(
          deviceId,
          monto,
          referencia,
          notificationUrl
        )
        await marcarIntento(orden.id)
        return NextResponse.json({
          orden,
          cobro_id: cobroId,
          limpieza: { canceladas },
        })
      } catch (e2) {
        await marcarIntento(null, 'fallida')
        return NextResponse.json(
          {
            error:
              e2 instanceof Error
                ? `${e2.message} (no se pudo liberar la terminal; canceladas previas: ${canceladas})`
                : 'No se pudo enviar el cobro.',
          },
          { status: 502 }
        )
      }
    }
    await marcarIntento(null, 'fallida')
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo enviar el cobro a la terminal.',
      },
      { status: 502 }
    )
  }
}
