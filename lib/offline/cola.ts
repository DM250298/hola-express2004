/**
 * Cola de ventas pendientes de sincronizar (POS offline).
 *
 * Cuando el POS cobra sin conexión, la venta se guarda acá con un
 * `cliente_uuid` único. El motor de sincronización (sync.ts) la reenvía al
 * servidor cuando vuelve internet; ese uuid garantiza que no se duplique
 * aunque el reintento ocurra varias veces.
 */

import {
  STORE_VENTAS_PENDIENTES,
  idbContar,
  idbEliminar,
  idbGuardar,
  idbObtener,
  idbObtenerTodo,
} from './db'
import type { ItemVentaPayload, PagoPayload } from '@/lib/queries/ventas'

export interface VentaPendiente {
  /** Clave primaria + idempotencia. */
  cliente_uuid: string
  turno_id: number
  usuario_id: string
  /** Cliente del CRM asociado a la venta (FASE 3). Null = al mostrador. */
  cliente_id: number | null
  pagos: PagoPayload[]
  items: ItemVentaPayload[]
  total: number
  /** ISO de cuando se cobró offline. */
  creada_en: string
  /** 'pendiente' = aún por sincronizar; 'error' = el server la rechazó. */
  estado: 'pendiente' | 'error'
  /** Último mensaje de error de sincronización, si lo hubo. */
  error?: string
  intentos: number
}

export interface DatosVentaOffline {
  turno_id: number
  usuario_id: string
  cliente_id?: number | null
  pagos: PagoPayload[]
  items: ItemVentaPayload[]
  total: number
}

/** Nombre del evento que se dispara cuando cambia la cola de ventas. */
export const EVENTO_COLA_CAMBIADA = 'he-cola-cambiada'

/** Avisa a la UI que la cola cambió, para que refresque el contador. */
function notificarCambioCola(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENTO_COLA_CAMBIADA))
  }
}

/** Genera un UUID v4 (con fallback si crypto.randomUUID no existe). */
export function nuevoUuid(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** Encola una venta hecha offline. Devuelve el registro guardado. */
export async function encolarVenta(
  datos: DatosVentaOffline,
  clienteUuid: string = nuevoUuid()
): Promise<VentaPendiente> {
  const registro: VentaPendiente = {
    cliente_uuid: clienteUuid,
    turno_id: datos.turno_id,
    usuario_id: datos.usuario_id,
    cliente_id: datos.cliente_id ?? null,
    pagos: datos.pagos,
    items: datos.items,
    total: datos.total,
    creada_en: new Date().toISOString(),
    estado: 'pendiente',
    intentos: 0,
  }
  await idbGuardar(STORE_VENTAS_PENDIENTES, registro)
  notificarCambioCola()
  return registro
}

/** Todas las ventas en cola, ordenadas de la más vieja a la más nueva. */
export async function leerVentasPendientes(): Promise<VentaPendiente[]> {
  const ventas = await idbObtenerTodo<VentaPendiente>(STORE_VENTAS_PENDIENTES)
  return ventas.sort((a, b) => a.creada_en.localeCompare(b.creada_en))
}

/** Cantidad de ventas en cola (pendientes + con error). */
export async function contarVentasPendientes(): Promise<number> {
  return idbContar(STORE_VENTAS_PENDIENTES)
}

/** Quita una venta de la cola (tras sincronizarla con éxito). */
export async function eliminarVentaPendiente(uuid: string): Promise<void> {
  await idbEliminar(STORE_VENTAS_PENDIENTES, uuid)
  notificarCambioCola()
}

/** Marca una venta de la cola como fallida, guardando el motivo. */
export async function marcarErrorVenta(
  uuid: string,
  mensaje: string
): Promise<void> {
  const venta = await idbObtener<VentaPendiente>(
    STORE_VENTAS_PENDIENTES,
    uuid
  )
  if (!venta) return
  venta.estado = 'error'
  venta.error = mensaje
  venta.intentos += 1
  await idbGuardar(STORE_VENTAS_PENDIENTES, venta)
  notificarCambioCola()
}

/** Marca una venta como pendiente otra vez (reintento manual). */
export async function reintentarVenta(uuid: string): Promise<void> {
  const venta = await idbObtener<VentaPendiente>(
    STORE_VENTAS_PENDIENTES,
    uuid
  )
  if (!venta) return
  venta.estado = 'pendiente'
  venta.error = undefined
  await idbGuardar(STORE_VENTAS_PENDIENTES, venta)
  notificarCambioCola()
}
