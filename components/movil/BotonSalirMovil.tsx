'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'

export function BotonSalirMovil() {
  const router = useRouter()
  const [saliendo, setSaliendo] = useState(false)

  async function salir() {
    if (saliendo) return
    setSaliendo(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      router.push('/login')
      router.refresh()
    } catch {
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
