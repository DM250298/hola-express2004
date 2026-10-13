'use client'

import { useEffect, useState } from 'react'

/**
 * Pestaña activa sincronizada con `?tab=` en la URL, mismo patrón que
 * PantallaPersonal: arranca en el `?tab=` que manda el server (page.tsx), lo
 * sigue si cambia (un enlace desde otra pantalla) y al cambiar de pestaña lo
 * refleja en la URL con replaceState, sin pasar por el server, para compartir
 * o recargar en el mismo lugar.
 *
 * `validas` puede cambiar después del primer render (permisos que llegan en el
 * cliente): la pestaña pedida se guarda igual y se muestra cuando aparece.
 * Mientras no sea válida se muestra `porDefecto`.
 */
export function usePestanaUrl(
  validas: readonly string[],
  porDefecto: string,
  tabInicial?: string
): [string, (valor: string) => void] {
  const [pedida, setPedida] = useState<string | undefined>(tabInicial)

  // Si cambia ?tab= (ej. un link desde otra área hacia esta pestaña), seguirlo.
  useEffect(() => {
    if (tabInicial) setPedida(tabInicial)
  }, [tabInicial])

  function cambiar(valor: string) {
    setPedida(valor)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('tab', valor)
      window.history.replaceState(null, '', url.toString())
    }
  }

  const activa = pedida && validas.includes(pedida) ? pedida : porDefecto
  return [activa, cambiar]
}
