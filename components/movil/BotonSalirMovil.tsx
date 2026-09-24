'use client'

import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { purgarShellSW } from '@/lib/offline/shell'
import { cancelarSalida, iniciarSalida } from '@/lib/auth/sesionActual'

export function BotonSalirMovil() {
  const [saliendo, setSaliendo] = useState(false)

  async function salir() {
    if (saliendo) return
    setSaliendo(true)
    try {
      const supabase = createClient()
      iniciarSalida()
      // Purgar ANTES de salir: el guardián de sesión navega apenas ve el
      // SIGNED_OUT y la purga no tiene que competir con esa navegación.
      await purgarShellSW()
      // scope 'local': cierra SOLO la sesión de este celular. El default
      // ('global') también tumbaba la sesión de la PC del mostrador y el
      // POS quedaba sin turno "de la nada".
      const { error } = await supabase.auth.signOut({ scope: 'local' })
      if (error) throw error
      // Navegación dura: descarta la caché de queries del usuario saliente.
      window.location.assign('/login')
    } catch {
      cancelarSalida()
      toast.error('No se pudo cerrar la sesión. Intentá de nuevo.')
      setSaliendo(false)
    }
  }

  return (
    <button
      type="button"
      onClick={salir}
      disabled={saliendo}
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-[#6f3a2a] hover:bg-[#f9d2a2]/40 disabled:opacity-60"
    >
      <LogOut className="h-4 w-4" />
      Salir
    </button>
  )
}
