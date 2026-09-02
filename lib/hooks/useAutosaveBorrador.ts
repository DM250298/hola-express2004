'use client'

import { useCallback, useEffect, useRef } from 'react'
import { borrarBorrador, guardarBorrador } from '@/lib/utils/borradores'

interface Opciones {
  /**
   * Mientras sea `false` no se escribe nada. Sirve para el arranque: hasta que
   * el formulario no terminó de inicializarse, su estado está vacío y guardarlo
   * pisaría el borrador que justo estamos por restaurar.
   */
  activo?: boolean
  debounceMs?: number
}

export interface ControlBorrador {
  /**
   * Da de baja el borrador: lo borra y deja el hook mudo por el resto de la
   * vida del componente. Llamalo cuando el trabajo ya se grabó en la base.
   */
  limpiar: () => void
  /**
   * Borra el borrador pero deja el autoguardado andando. Es lo que necesita el
   * botón "Descartar": el usuario tira lo recuperado y sigue trabajando desde
   * cero, así que lo que cargue a partir de ahí tiene que volver a guardarse.
   */
  descartar: () => void
}

/**
 * Autoguardado de un formulario largo en localStorage.
 *
 * Guarda con un debounce (no en cada tecla) y, sobre todo, **hace flush cuando
 * la pantalla se oculta**. Eso último es lo que importa en un teléfono: cuando
 * Chrome en Android descarta una pestaña en segundo plano por presión de
 * memoria no dispara ni el unmount de React ni el cleanup de los effects, así
 * que un guardado "al cerrar" nunca llega a correr. Lo que sí dispara es
 * `visibilitychange` → hidden, y `pagehide` al congelar o cerrar la página.
 *
 * `beforeunload` queda deliberadamente afuera: iOS Safari no lo dispara de
 * forma confiable y además rompe el bfcache.
 *
 * Todo es best-effort — `borradores.ts` traga los errores de localStorage
 * (modo privado, cuota llena), así que el formulario sigue andando igual, solo
 * que sin red de seguridad.
 */
export function useAutosaveBorrador<T>(
  clave: string,
  datos: T | null,
  { activo = true, debounceMs = 600 }: Opciones = {}
): ControlBorrador {
  // Se compara por contenido y no por identidad: el objeto se rearma en cada
  // render del padre, y con la identidad el debounce se reiniciaría siempre.
  const json = datos == null ? null : JSON.stringify(datos)

  const datosRef = useRef(datos)
  datosRef.current = datos
  const claveRef = useRef(clave)
  claveRef.current = clave

  /** Hay cambios sin escribir. `false` también significa "ya se dio de baja". */
  const pendienteRef = useRef(false)
  /** Una vez dado de baja no se vuelve a escribir en esta vida del componente. */
  const bajaRef = useRef(false)

  const escribir = useCallback(() => {
    if (bajaRef.current || !pendienteRef.current) return
    const d = datosRef.current
    if (d == null) return
    guardarBorrador(claveRef.current, d)
  }, [])

  // Cambiar de clave (otro pedido) es empezar de nuevo.
  useEffect(() => {
    bajaRef.current = false
    pendienteRef.current = false
  }, [clave])

  useEffect(() => {
    if (!activo || json == null || bajaRef.current) return
    pendienteRef.current = true
    const t = setTimeout(escribir, debounceMs)
    return () => clearTimeout(t)
  }, [activo, json, debounceMs, escribir])

  useEffect(() => {
    if (!activo) return
    const alOcultar = () => {
      if (document.visibilityState === 'hidden') escribir()
    }
    document.addEventListener('visibilitychange', alOcultar)
    window.addEventListener('pagehide', escribir)
    return () => {
      document.removeEventListener('visibilitychange', alOcultar)
      window.removeEventListener('pagehide', escribir)
      // Desmontaje, navegación del router, o el formulario que se deshabilita
      // porque arrancó la mutación: en todos los casos conviene dejar el último
      // estado guardado. Si la mutación después sale bien, `limpiar()` lo borra.
      escribir()
    }
  }, [activo, escribir])

  const limpiar = useCallback(() => {
    // El orden importa: primero se apaga el hook y recién después se borra. Si
    // se hiciera al revés, el flush del cleanup (que corre justo después, cuando
    // `activo` pasa a false por la navegación) reescribiría el borrador que
    // acabamos de dar de baja, y el pedido ya recibido volvería a aparecer con
    // una recepción fantasma encima.
    bajaRef.current = true
    pendienteRef.current = false
    borrarBorrador(claveRef.current)
  }, [])

  const descartar = useCallback(() => {
    // A diferencia de `limpiar`, el hook sigue vivo: solo se apaga lo que
    // estaba pendiente de escribir, para que el flush del cleanup no resucite
    // el borrador que el usuario acaba de tirar.
    pendienteRef.current = false
    borrarBorrador(claveRef.current)
  }, [])

  return { limpiar, descartar }
}
