/**
 * Motor de sincronización de fichajes offline (kiosco). Reenvía la cola al
 * servidor vía `fn_registrar_fichaje` (idempotente por id). Mismo patrón que
 * sync.ts del POS.
 */

import { createClient } from '@/lib/supabase/client'
import { esErrorDeRed } from './sync'
import {
  contarFichajesPendientes,
  eliminarFichajePendiente,
  leerFichajesPendientes,
  marcarErrorFichaje,
  type FichajePendiente,
} from './colaFichajes'

let sincronizando = false

async function enviarFichaje(f: FichajePendiente): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_registrar_fichaje', {
    p_id: f.id,
    p_empleado_id: f.empleado_id,
    p_pin: f.pin,
    p_origen: 'kiosco',
    p_momento: f.momento,
  })
  if (error) throw error
}

export interface ResultadoSyncFichajes {
  sincronizados: number
  conError: number
  pendientes: number
  cortadoPorRed: boolean
}

export async function sincronizarFichajesPendientes(): Promise<ResultadoSyncFichajes> {
  if (sincronizando) {
    return {
      sincronizados: 0,
      conError: 0,
      pendientes: await contarFichajesPendientes(),
      cortadoPorRed: false,
    }
  }
  sincronizando = true
  let sincronizados = 0
  let conError = 0
  let cortadoPorRed = false

  try {
    for (const f of await leerFichajesPendientes()) {
      if (f.estado === 'error') continue
      try {
        await enviarFichaje(f)
        await eliminarFichajePendiente(f.id)
        sincronizados += 1
      } catch (error) {
        if (esErrorDeRed(error)) {
          cortadoPorRed = true
          break
        }
        // PIN incorrecto u otro error del servidor: queda en error en la cola.
        const msg = error instanceof Error ? error.message : 'Error desconocido'
        await marcarErrorFichaje(f.id, msg)
        conError += 1
      }
    }
  } finally {
    sincronizando = false
  }

  return {
    sincronizados,
    conError,
    pendientes: await contarFichajesPendientes(),
    cortadoPorRed,
  }
}
