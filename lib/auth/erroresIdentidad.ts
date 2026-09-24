import { toast } from 'sonner'
import type { QueryClient } from '@tanstack/react-query'

/**
 * Errores de identidad que devuelve la base (migración 218) cuando la
 * pantalla quedó con una sesión o un turno que ya no son los reales:
 *
 *  - `SESION_CAMBIO:` el usuario de la pantalla no es el de la sesión.
 *  - `TURNO_AJENO:`   el turno de la pantalla es de otra persona.
 *  - `TURNO_CERRADO:` el turno de la pantalla ya está cerrado.
 *
 * Los prefijos los emiten fn_crear_venta, fn_abrir_turno, fn_cerrar_turno,
 * fn_resumen_turno y el trigger de identidad (ventas, egresos, sangrías,
 * devoluciones, cuenta corriente).
 */
export const PREFIJO_SESION_CAMBIO = 'SESION_CAMBIO:'
export const PREFIJO_TURNO_AJENO = 'TURNO_AJENO:'
export const PREFIJO_TURNO_CERRADO = 'TURNO_CERRADO:'

/** Query key del turno activo (espejo de TURNO_KEY en useTurno, sin importar hooks). */
const TURNO_ACTIVO_KEY = ['turno-activo'] as const

const DEMORA_RECARGA_MS = 2500

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '')
}

/** La pantalla quedó con otra sesión u otro turno: hay que rearmarla. */
export function esErrorDeIdentidad(error: unknown): boolean {
  const m = mensajeDe(error)
  return m.includes(PREFIJO_SESION_CAMBIO) || m.includes(PREFIJO_TURNO_AJENO)
}

/** El turno de la pantalla ya está cerrado (lo cerró el dueño o Finanzas). */
export function esErrorTurnoCerrado(error: unknown): boolean {
  const m = mensajeDe(error)
  return (
    m.includes(PREFIJO_TURNO_CERRADO) ||
    /turno #?\d* ?ya está cerrado/i.test(m) ||
    /no hay un turno de caja abierto/i.test(m)
  )
}

/** Texto para mostrar, sin el prefijo técnico. */
export function textoErrorIdentidad(error: unknown): string {
  const m = mensajeDe(error)
  for (const p of [PREFIJO_SESION_CAMBIO, PREFIJO_TURNO_AJENO, PREFIJO_TURNO_CERRADO]) {
    const i = m.indexOf(p)
    if (i >= 0) return m.slice(i + p.length).trim()
  }
  return m
}

/**
 * Manejo estándar en los hooks del POS. Devuelve true si el error era de
 * identidad/turno y ya se manejó (el hook no muestra su toast genérico).
 *
 *  - SESION_CAMBIO / TURNO_AJENO → aviso y recarga de la página: la pantalla
 *    se vuelve a armar con la sesión real del navegador.
 *  - TURNO_CERRADO → aviso e invalidación del turno activo: el POS pasa a
 *    "Abrir caja".
 */
export function manejarErrorIdentidad(
  error: unknown,
  queryClient?: QueryClient
): boolean {
  if (esErrorDeIdentidad(error)) {
    toast.error('La sesión de esta pantalla cambió', {
      description: `${textoErrorIdentidad(error)} Se recarga la pantalla…`,
      duration: DEMORA_RECARGA_MS,
    })
    if (typeof window !== 'undefined') {
      setTimeout(() => window.location.reload(), DEMORA_RECARGA_MS)
    }
    return true
  }
  if (esErrorTurnoCerrado(error)) {
    toast.error('El turno ya está cerrado', {
      description: textoErrorIdentidad(error),
    })
    queryClient?.invalidateQueries({ queryKey: TURNO_ACTIVO_KEY })
    return true
  }
  return false
}
