/**
 * Cliente de la Point Integration API de Mercado Pago (FASE 6).
 *
 * SOLO SERVIDOR. Usa el Access Token (secreto) — nunca debe importarse desde
 * un componente cliente. Lo consumen las route handlers de `app/api/terminales`.
 *
 * Docs: https://www.mercadopago.com.ar/developers — Point / Integration API.
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
    if (data && typeof data === 'object' && 'message' in data) {
      msg = String((data as { message: unknown }).message)
    }
    throw new Error(msg)
  }

  return data as T
}

export interface DispositivoPoint {
  id: string
  /** 'PDV' = integrado al sistema; 'STANDALONE' = autónomo. */
  operating_mode: string
  pos_id?: number
  store_id?: number
}

/** Lista los dispositivos Point asociados a la cuenta de Mercado Pago. */
export async function listarDispositivos(): Promise<DispositivoPoint[]> {
  // API actual de Point: /terminals/v1/list devuelve { data: { terminals: [] } }.
  const data = await mpFetch<{
    data?: { terminals?: DispositivoPoint[] }
    // Fallback al endpoint viejo por si alguna cuenta aún lo usa.
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

export interface IntencionPago {
  id: string
  device_id?: string
  /** Monto en centavos. */
  amount?: number
  state?: string
  status?: string
  payment?: { id?: string | number } | null
}

/**
 * Crea una intención de pago en una terminal. El monto se envía en pesos y
 * acá se convierte a centavos, como espera la API.
 */
export async function crearIntencionPago(
  deviceId: string,
  montoPesos: number,
  referencia: string
): Promise<IntencionPago> {
  const amount = Math.round(montoPesos * 100)
  return mpFetch<IntencionPago>(
    `/point/integration-api/devices/${deviceId}/payment-intents`,
    {
      method: 'POST',
      body: JSON.stringify({
        amount,
        additional_info: {
          external_reference: referencia,
          print_on_terminal: true,
        },
      }),
    }
  )
}

/** Consulta el estado de una intención de pago (polling). */
export async function consultarIntencionPago(
  intencionId: string
): Promise<IntencionPago> {
  return mpFetch<IntencionPago>(
    `/point/integration-api/payment-intents/${intencionId}`
  )
}

/** Cancela una intención de pago pendiente en la terminal. */
export async function cancelarIntencionPago(
  deviceId: string,
  intencionId: string
): Promise<void> {
  await mpFetch(
    `/point/integration-api/devices/${deviceId}/payment-intents/${intencionId}`,
    { method: 'DELETE' }
  )
}
