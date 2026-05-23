/**
 * Cliente de la API de Mercado Pago Point (Orders + Terminals).
 *
 * SOLO SERVIDOR. Usa el Access Token (secreto) — nunca debe importarse desde
 * un componente cliente. Lo consumen las route handlers de `app/api/terminales`.
 *
 * Docs:
 *   - Terminals (listar / setear modo)  https://api.mercadopago.com/terminals/v1/
 *   - Orders (cobros)                    https://api.mercadopago.com/v1/orders
 */

const MP_BASE = 'https://api.mercadopago.com'

function accessToken(): string {
  const t = process.env.MP_ACCESS_TOKEN
  if (!t) {
    throw new Error(
      'Falta MP_ACCESS_TOKEN en el servidor. Agregalo en .env.local.'
    )
  }
  return t
}

/** Genera una clave de idempotencia para los POST que la requieren. */
function nuevaIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  // Fallback razonable; el formato exacto no importa, solo que sea único.
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Llama a la API de Mercado Pago y normaliza errores. */
async function mpFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${MP_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  })

  const texto = await res.text()
  let data: unknown = null
  try {
    data = texto ? JSON.parse(texto) : null
  } catch {
    data = texto
  }

  if (!res.ok) {
    let msg = `Mercado Pago respondió ${res.status}.`
    if (data && typeof data === 'object') {
      const d = data as {
        message?: unknown
        errors?: unknown
        cause?: unknown
      }
      if (Array.isArray(d.errors) && d.errors.length > 0) {
        const e = d.errors[0] as {
          code?: unknown
          message?: unknown
          details?: unknown
        }
        const partes = [
          typeof e.code === 'string' || typeof e.code === 'number'
            ? String(e.code)
            : null,
          typeof e.message === 'string' ? e.message : null,
          e.details
            ? typeof e.details === 'string'
              ? e.details
              : JSON.stringify(e.details)
            : null,
        ].filter(Boolean)
        msg = partes.join(' · ') || msg
      } else if (typeof d.message === 'string') {
        msg = d.message
      } else {
        msg = JSON.stringify(data).slice(0, 400)
      }
    }
    throw new Error(msg)
  }

  return data as T
}

// ─── Terminals ───────────────────────────────────────────────────────────────

export interface DispositivoPoint {
  id: string
  /** 'PDV' = integrado al sistema; 'STANDALONE' = autónomo. */
  operating_mode: string
  pos_id?: number
  store_id?: number
}

/** Lista los dispositivos Point asociados a la cuenta de Mercado Pago. */
export async function listarDispositivos(): Promise<DispositivoPoint[]> {
  const data = await mpFetch<{
    data?: { terminals?: DispositivoPoint[] }
    devices?: DispositivoPoint[]
  }>('/terminals/v1/list')
  return data.data?.terminals ?? data.devices ?? []
}

/** Pone un dispositivo en modo integrado ('PDV') para aceptar cobros del sistema. */
export async function ponerModoIntegrado(deviceId: string): Promise<void> {
  await mpFetch('/terminals/v1/setup', {
    method: 'PATCH',
    body: JSON.stringify({
      terminals: [{ id: deviceId, operating_mode: 'PDV' }],
    }),
  })
}

// ─── Orders (cobros) ─────────────────────────────────────────────────────────

export interface OrdenPago {
  id: string
  status?: string
  status_detail?: string
  type?: string
  total_amount?: string | number
  external_reference?: string
  config?: {
    point?: { terminal_id?: string }
  }
  transactions?: {
    payments?: Array<{
      id?: string | number
      amount?: string | number
      status?: string
      payment_method?: { id?: string; type?: string }
    }>
  }
}

/** Estados finales de una orden (ya no cambian). */
export const ESTADOS_FINALES_ORDEN = new Set([
  'processed',
  'failed',
  'canceled',
  'expired',
  'refunded',
])

/**
 * Crea una orden de cobro en una terminal Point.
 * El monto se envía en pesos (string con 2 decimales, como pide la API).
 */
export async function crearOrdenPago(
  deviceId: string,
  montoPesos: number,
  referencia: string
): Promise<OrdenPago> {
  const referenciaSegura = referencia.slice(0, 64) || 'cobro_hola_express'
  return mpFetch<OrdenPago>('/v1/orders', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': nuevaIdempotencyKey() },
    body: JSON.stringify({
      type: 'point',
      external_reference: referenciaSegura,
      expiration_time: 'PT16M',
      transactions: {
        payments: [{ amount: montoPesos.toFixed(2) }],
      },
      config: {
        point: {
          terminal_id: deviceId,
          print_on_terminal: 'no_ticket',
        },
      },
      description: 'Cobro Hola Express',
    }),
  })
}

/** Consulta el estado actual de una orden (polling). */
export async function consultarOrdenPago(
  ordenId: string
): Promise<OrdenPago> {
  return mpFetch<OrdenPago>(`/v1/orders/${ordenId}`)
}

/** Cancela una orden pendiente en la terminal. */
export async function cancelarOrdenPago(ordenId: string): Promise<void> {
  await mpFetch(`/v1/orders/${ordenId}/cancel`, {
    method: 'POST',
    headers: { 'X-Idempotency-Key': nuevaIdempotencyKey() },
    body: '{}',
  })
}
