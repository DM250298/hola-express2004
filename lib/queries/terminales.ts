import { createClient } from '@/lib/supabase/client'
import type {
  TerminalInsert,
  TerminalRow,
  TerminalUpdate,
} from '@/types/database'
import type { PagoPayload } from '@/lib/queries/ventas'

// ─── Terminales registradas (tabla local) ───────────────────────────────────

export async function getTerminales(): Promise<TerminalRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('terminales')
    .select('*')
    .order('nombre', { ascending: true })

  if (error) throw error
  return (data ?? []) as TerminalRow[]
}

export async function createTerminal(
  datos: TerminalInsert
): Promise<TerminalRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('terminales')
    .insert(datos)
    .select()
    .single<TerminalRow>()

  if (error) throw error
  return data
}

export async function updateTerminal(
  id: number,
  datos: TerminalUpdate
): Promise<TerminalRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('terminales')
    .update({ ...datos, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single<TerminalRow>()

  if (error) throw error
  return data
}

export async function deleteTerminal(id: number): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('terminales').delete().eq('id', id)
  if (error) throw error
}

// ─── Dispositivos Point en vivo (vía route handler del servidor) ─────────────

export interface DispositivoPoint {
  id: string
  operating_mode: string
  pos_id?: number
  store_id?: number
}

/** Lista los dispositivos Point de la cuenta de Mercado Pago. */
export async function getDispositivosPoint(): Promise<DispositivoPoint[]> {
  const res = await fetch('/api/terminales/dispositivos')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(
      data?.error ?? 'No se pudieron obtener los dispositivos de Mercado Pago.'
    )
  }
  return (data?.dispositivos ?? []) as DispositivoPoint[]
}

/** Cambia el modo de operación de una terminal a "integrado / PDV". */
export async function activarModoPdv(deviceId: string): Promise<void> {
  const res = await fetch('/api/terminales/activar-pdv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.error ?? 'No se pudo activar el modo PDV.')
  }
}

// ─── Cobros vía terminal (Orders de Mercado Pago) ────────────────────────────

export interface OrdenPagoCliente {
  id: string
  status?: string
  status_detail?: string
  total_amount?: string | number
  transactions?: {
    payments?: Array<{
      id?: string | number
      amount?: string | number
      status?: string
      payment_method?: { id?: string; type?: string }
    }>
  }
  /**
   * Comisión + IIBB REALES que cobró MP, adjuntados por el endpoint cuando
   * la orden queda aprobada. Si no vino, el POS usa la tabla de medios.
   */
  cobro_real?: {
    comision: number
    iibb: number
    neto: number | null
  }
}

/** Item del carrito que se guarda en el intento de cobro (para el webhook). */
export interface ItemCobroPayload {
  producto_id: number
  cantidad: number
  precio_unitario: number
}

/** Argumentos para crear un cobro con terminal. Los campos de contexto de la
 *  venta (items, pagos previos, turno, etc.) se guardan en el intento de cobro
 *  para que el webhook pueda registrar la venta aunque la pestaña del POS muera. */
export interface CrearCobroTerminalArgs {
  deviceId: string
  monto: number
  referencia?: string
  items?: ItemCobroPayload[]
  pagosPrevios?: PagoPayload[]
  turnoId?: number
  usuarioId?: string
  clienteId?: number | null
}

/** Resultado de crear un cobro: la orden MP + el id del intento (cobros_terminal). */
export interface ResultadoCobroTerminal {
  orden: OrdenPagoCliente
  /** id del intento de cobro; se usa como `cliente_uuid` de la venta. */
  cobroId: string | null
}

/** Crea una orden de cobro en una terminal (+ el intento de cobro en el server). */
export async function crearCobroTerminal(
  args: CrearCobroTerminalArgs
): Promise<ResultadoCobroTerminal> {
  const res = await fetch('/api/terminales/cobro', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: args.deviceId,
      monto: args.monto,
      referencia: args.referencia ?? '',
      items: args.items ?? [],
      pagos_previos: args.pagosPrevios ?? [],
      turno_id: args.turnoId ?? null,
      usuario_id: args.usuarioId ?? null,
      cliente_id: args.clienteId ?? null,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.error ?? 'No se pudo enviar el cobro a la terminal.')
  }
  return {
    orden: data.orden as OrdenPagoCliente,
    cobroId: (data.cobro_id ?? null) as string | null,
  }
}

/** Consulta el estado actual de una orden de cobro. */
export async function consultarCobroTerminal(
  ordenId: string
): Promise<OrdenPagoCliente> {
  const res = await fetch(
    `/api/terminales/cobro/${encodeURIComponent(ordenId)}`
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.error ?? 'No se pudo consultar el estado del cobro.')
  }
  return data.orden as OrdenPagoCliente
}

/**
 * Cancela una orden pendiente. Si se pasa `deviceId`, el servidor también
 * libera la cola del dispositivo via el endpoint legacy — esto es lo que
 * realmente saca el monto de la pantalla de la maquinita.
 */
export async function cancelarCobroTerminal(
  ordenId: string,
  deviceId?: string
): Promise<void> {
  const qs = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : ''
  const res = await fetch(
    `/api/terminales/cobro/${encodeURIComponent(ordenId)}${qs}`,
    { method: 'DELETE' }
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.error ?? 'No se pudo cancelar el cobro.')
  }
}

export const ESTADOS_FINALES_ORDEN = new Set([
  'processed',
  'failed',
  'canceled',
  'expired',
  'refunded',
])

// ─── Tracking local de órdenes pendientes ────────────────────────────────────
//
// Si el navegador se cierra o el modal se aborta a mitad de un cobro, la
// orden puede quedar "encolada" del lado de Mercado Pago. Guardamos el id de
// la orden en localStorage por terminal para poder cancelarla después.

function claveOrden(deviceId: string): string {
  return `he_orden_pendiente_${deviceId}`
}

export function guardarOrdenPendiente(
  deviceId: string,
  ordenId: string
): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(claveOrden(deviceId), ordenId)
  } catch {
    // ignore
  }
}

export function olvidarOrdenPendiente(deviceId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(claveOrden(deviceId))
  } catch {
    // ignore
  }
}

export function obtenerOrdenPendiente(deviceId: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(claveOrden(deviceId))
  } catch {
    return null
  }
}

/**
 * Crea un cobro en la terminal, con limpieza automática si quedó una orden
 * vieja encolada de un intento previo.
 */
export async function crearCobroTerminalSeguro(
  args: CrearCobroTerminalArgs
): Promise<ResultadoCobroTerminal> {
  try {
    const resultado = await crearCobroTerminal(args)
    guardarOrdenPendiente(args.deviceId, resultado.orden.id)
    return resultado
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (!/already_queued/i.test(msg)) {
      throw error
    }
    // Hay una orden previa colgada. Intentar cancelarla y reintentar.
    const ordenVieja = obtenerOrdenPendiente(args.deviceId)
    if (ordenVieja) {
      try {
        await cancelarCobroTerminal(ordenVieja)
      } catch {
        // ignore — quizá ya está finalizada o expirada
      }
      olvidarOrdenPendiente(args.deviceId)
    }
    // Reintento limpio.
    const resultado = await crearCobroTerminal(args)
    guardarOrdenPendiente(args.deviceId, resultado.orden.id)
    return resultado
  }
}
