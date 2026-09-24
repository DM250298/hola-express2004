'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { haySalidaEnCurso, setUsuarioSesion } from '@/lib/auth/sesionActual'

interface Props {
  /** Usuario con el que el servidor armó esta pantalla (SSR). */
  usuarioId: string
}

/** Cortacircuito anti-loop: si ya recargamos hace menos de esto, no insistir. */
const CLAVE_RECARGA = 'he-guardian-reload'
const VENTANA_LOOP_MS = 15_000
/** Chequeo periódico (lee la cookie; no va a la red salvo refresh del token). */
const TICK_MS = 60_000

/**
 * Guardián de sesión.
 *
 * La pantalla se arma en el servidor con la identidad de la cookie de ese
 * momento (`usuarioId`) y el POS la usa en cada operación. Este componente
 * garantiza que la pantalla SIGA a la sesión real del navegador:
 *
 *  - Si la sesión termina (SIGNED_OUT, cookie borrada) → al login.
 *  - Si la sesión pasa a ser de OTRO usuario (alguien entró con su cuenta en
 *    otra pestaña o ventana de la app instalada) → recarga: la pantalla se
 *    rearma con la identidad real. auth-js propaga los eventos entre pestañas
 *    del mismo perfil de navegador por BroadcastChannel.
 *
 * Reglas para no expulsar de más (POS sin internet):
 *  - Solo decide con `getSession()` SIN error. Con el token vencido y sin
 *    red, auth-js devuelve sesión null + error (o LockAcquireTimeoutError si
 *    otra pestaña tiene el lock): en esos casos no se hace nada.
 *  - `INITIAL_SESSION` se ignora (puede venir null por lo mismo).
 *  - Si un "Salir" propio está en curso, el que salió decide a dónde ir.
 */
export function GuardianSesion({ usuarioId }: Props) {
  const [bloqueada, setBloqueada] = useState(false)
  const decidiendoRef = useRef(false)

  useEffect(() => {
    const supabase = createClient()
    let activo = true

    function irAlLogin() {
      setUsuarioSesion(null)
      window.location.replace('/login')
    }

    function recargarPorOtroUsuario() {
      let ultima = 0
      try {
        ultima = Number(sessionStorage.getItem(CLAVE_RECARGA) ?? 0)
      } catch {
        // sessionStorage bloqueado: se recarga igual
      }
      if (Date.now() - ultima < VENTANA_LOOP_MS) {
        // Ya recargamos y seguimos con otra identidad (shell cacheado sin
        // red, por ejemplo): mostrar la pantalla de bloqueo en vez de un loop.
        setBloqueada(true)
        return
      }
      try {
        sessionStorage.setItem(CLAVE_RECARGA, String(Date.now()))
      } catch {
        // ignorar
      }
      window.location.reload()
    }

    function evaluar(idSesion: string | null) {
      if (!activo || decidiendoRef.current) return
      if (idSesion === null) {
        if (haySalidaEnCurso()) return
        decidiendoRef.current = true
        irAlLogin()
        return
      }
      setUsuarioSesion(idSesion)
      if (idSesion !== usuarioId) {
        decidiendoRef.current = true
        recargarPorOtroUsuario()
      }
    }

    async function verificar() {
      try {
        const { data, error } = await supabase.auth.getSession()
        if (error) return
        evaluar(data.session?.user.id ?? null)
      } catch {
        // LockAcquireTimeoutError u otro fallo transitorio: no decidir.
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((evento, session) => {
      if (evento === 'INITIAL_SESSION') return
      if (evento === 'SIGNED_OUT') {
        evaluar(null)
        return
      }
      if (session?.user) evaluar(session.user.id)
    })

    const alCambiarVisibilidad = () => {
      if (document.visibilityState === 'visible') void verificar()
    }
    const alEnfocar = () => void verificar()
    document.addEventListener('visibilitychange', alCambiarVisibilidad)
    window.addEventListener('focus', alEnfocar)
    window.addEventListener('pageshow', alEnfocar)
    const tick = setInterval(() => void verificar(), TICK_MS)
    void verificar()

    return () => {
      activo = false
      subscription.unsubscribe()
      document.removeEventListener('visibilitychange', alCambiarVisibilidad)
      window.removeEventListener('focus', alEnfocar)
      window.removeEventListener('pageshow', alEnfocar)
      clearInterval(tick)
    }
  }, [usuarioId])

  if (!bloqueada) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#391511]/90 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl">
        <div className="mx-auto mb-3 inline-flex rounded-full bg-[#c43e2c]/10 p-3">
          <AlertTriangle className="h-7 w-7 text-[#c43e2c]" />
        </div>
        <h2 className="text-lg font-bold text-[#391511]">
          Esta ventana quedó con la sesión de otro usuario
        </h2>
        <p className="mt-2 text-sm text-[#6f3a2a]">
          Para no registrar ventas a nombre de otra persona, esta pantalla se
          bloqueó. Conectate a internet y volvé a entrar con tu usuario.
        </p>
        <Button
          onClick={() => window.location.replace('/login')}
          className="mt-5 w-full bg-[#f9b44c] font-bold text-[#391511] hover:bg-[#e4a42a]"
        >
          Volver a entrar
        </Button>
      </div>
    </div>
  )
}
