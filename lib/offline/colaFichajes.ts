/**
 * Cola de fichajes pendientes de sincronizar (kiosco offline).
 *
 * Mismo patrón que la cola de ventas del POS (cola.ts): cada fichaje hecho sin
 * conexión se guarda con un `id` único (client uuid) que garantiza idempotencia
 * al reenviarlo. El PIN viaja en la cola y se valida en el servidor al
 * sincronizar: si está mal, el fichaje queda en estado 'error'.
 */

import {
  STORE_FICHAJES_PENDIENTES,
  idbEliminar,
  idbGuardar,
  idbObtener,
  idbObtenerTodo,
} from './db'
import { nuevoUuid } from './cola'

export interface FichajePendiente {
  /** Client uuid = PK + idempotencia. */
  id: string
  empleado_id: number
  /** Nombre para mostrar en la cola. */
  nombre: string
  /** Se valida en el servidor al sincronizar. */
  pin: string
  /** ISO del momento de la marcación. */
  momento: string
  creado_en: string
  estado: 'pendiente' | 'error'
  error?: string
  intentos: number
}

export interface DatosFichajeOffline {
  empleado_id: number
  nombre: string
  pin: string
  momento: string
}

export const EVENTO_COLA_FICHAJES = 'he-cola-fichajes-cambiada'

function notificarCambio(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENTO_COLA_FICHAJES))
  }
}

export async function encolarFichaje(
  datos: DatosFichajeOffline,
  id: string = nuevoUuid()
): Promise<FichajePendiente> {
  const registro: FichajePendiente = {
    id,
    empleado_id: datos.empleado_id,
    nombre: datos.nombre,
    pin: datos.pin,
    momento: datos.momento,
    creado_en: new Date().toISOString(),
    estado: 'pendiente',
    intentos: 0,
  }
  await idbGuardar(STORE_FICHAJES_PENDIENTES, registro)
  notificarCambio()
  return registro
}

export async function leerFichajesPendientes(): Promise<FichajePendiente[]> {
  const f = await idbObtenerTodo<FichajePendiente>(STORE_FICHAJES_PENDIENTES)
  return f.sort((a, b) => a.creado_en.localeCompare(b.creado_en))
}

export async function contarFichajesPendientes(): Promise<number> {
  // Sólo los realmente pendientes: los que quedaron en 'error' (PIN mal offline)
  // no se reenvían solos, así que no deben inflar el badge.
  const f = await leerFichajesPendientes()
  return f.filter((x) => x.estado === 'pendiente').length
}

export async function eliminarFichajePendiente(id: string): Promise<void> {
  await idbEliminar(STORE_FICHAJES_PENDIENTES, id)
  notificarCambio()
}

export async function marcarErrorFichaje(
  id: string,
  mensaje: string
): Promise<void> {
  const f = await idbObtener<FichajePendiente>(STORE_FICHAJES_PENDIENTES, id)
  if (!f) return
  f.estado = 'error'
  f.error = mensaje
  f.intentos += 1
  // Un fichaje en 'error' nunca se reenvía: purgar el PIN para no dejarlo en
  // texto plano en IndexedDB.
  f.pin = ''
  await idbGuardar(STORE_FICHAJES_PENDIENTES, f)
  notificarCambio()
}
