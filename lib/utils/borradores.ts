/**
 * Borradores locales de formularios largos (localStorage): el trabajo a
 * medias sobrevive a un cierre del modal, un F5 o un corte de luz. Un
 * borrador por clave; expiran solos a los 7 días (se purgan al abrir el
 * form). Todo es best-effort: si localStorage no está disponible (SSR, modo
 * privado, cuota llena), las funciones no hacen nada y el form sigue
 * funcionando, solo que sin red de seguridad.
 */

const PREFIJO = 'hola:borrador:'
const EXPIRA_MS = 7 * 24 * 60 * 60 * 1000

interface Envoltorio<T> {
  guardadoEn: number
  datos: T
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

export function guardarBorrador<T>(clave: string, datos: T): void {
  const ls = storage()
  if (!ls) return
  try {
    const env: Envoltorio<T> = { guardadoEn: Date.now(), datos }
    ls.setItem(PREFIJO + clave, JSON.stringify(env))
  } catch {
    // Cuota llena o dato no serializable: se sigue sin borrador.
  }
}

export function leerBorrador<T>(clave: string): T | null {
  const ls = storage()
  if (!ls) return null
  try {
    const crudo = ls.getItem(PREFIJO + clave)
    if (!crudo) return null
    const env = JSON.parse(crudo) as Envoltorio<T>
    if (
      typeof env?.guardadoEn !== 'number' ||
      Date.now() - env.guardadoEn > EXPIRA_MS
    ) {
      ls.removeItem(PREFIJO + clave)
      return null
    }
    return env.datos ?? null
  } catch {
    return null
  }
}

export function borrarBorrador(clave: string): void {
  const ls = storage()
  if (!ls) return
  try {
    ls.removeItem(PREFIJO + clave)
  } catch {
    // nada para hacer
  }
}

/** Barre los borradores vencidos (o corruptos) de todas las claves. */
export function purgarBorradoresVencidos(): void {
  const ls = storage()
  if (!ls) return
  try {
    const ahora = Date.now()
    const vencidas: string[] = []
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i)
      if (!k?.startsWith(PREFIJO)) continue
      try {
        const env = JSON.parse(ls.getItem(k) ?? '') as Envoltorio<unknown>
        if (
          typeof env?.guardadoEn !== 'number' ||
          ahora - env.guardadoEn > EXPIRA_MS
        ) {
          vencidas.push(k)
        }
      } catch {
        vencidas.push(k)
      }
    }
    for (const k of vencidas) ls.removeItem(k)
  } catch {
    // nada para hacer
  }
}
