'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { LogOut, Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Sidebar } from '@/components/shared/Sidebar'
import { createClient } from '@/lib/supabase/client'
import type { Rol } from '@/types/database'

const ETIQUETAS_ROL: Record<string, { texto: string; clase: string }> = {
  admin: {
    texto: 'Admin',
    clase: 'bg-[#c43e2c] text-white hover:bg-[#c43e2c]',
  },
  encargado: {
    texto: 'Encargado',
    clase: 'bg-[#f9b44c] text-[#391511] hover:bg-[#f9b44c]',
  },
  cajero: {
    texto: 'Cajero',
    clase: 'bg-[#ebd5a1] text-[#391511] hover:bg-[#ebd5a1]',
  },
}

function etiquetaRol(rol: string): { texto: string; clase: string } {
  if (ETIQUETAS_ROL[rol]) return ETIQUETAS_ROL[rol]
  const texto = rol.charAt(0).toUpperCase() + rol.slice(1).replace(/_/g, ' ')
  return { texto, clase: 'bg-[#ebd5a1] text-[#391511] hover:bg-[#ebd5a1]' }
}

interface HeaderProps {
  nombre: string
  rol: Rol
  permisos: string[]
}

export function Header({ nombre, rol, permisos }: HeaderProps) {
  const router = useRouter()
  const [cerrandoSesion, setCerrandoSesion] = useState(false)
  const [sidebarAbierto, setSidebarAbierto] = useState(false)

  async function handleLogout() {
    if (cerrandoSesion) return
    setCerrandoSesion(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      router.push('/login')
      router.refresh()
    } catch {
      toast.error('No se pudo cerrar la sesión. Intentá de nuevo.')
      setCerrandoSesion(false)
    }
  }

  const iniciales = nombre
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()

  const etiqueta = etiquetaRol(rol)

  return (
    <>
      <header className="h-14 bg-white border-b border-[#e4c9b0]/60 flex items-center justify-between px-4 md:px-6 shrink-0 sticky top-0 z-30">
        {/* Botón hamburguesa — solo mobile */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden text-[#391511] hover:bg-[#f9d2a2]/40"
          onClick={() => setSidebarAbierto(true)}
          aria-label="Abrir menú"
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* Logo mobile — centrado */}
        <span className="md:hidden text-[#391511] font-extrabold text-xl tracking-tight">
          ¡Hola!
        </span>

        {/* Espacio en desktop (el logo está en el sidebar) */}
        <div className="hidden md:block" />

        {/* Info del usuario + logout */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8 bg-[#391511]">
              <AvatarFallback className="bg-[#391511] text-[#f9b44c] text-xs font-bold">
                {iniciales}
              </AvatarFallback>
            </Avatar>
            <div className="hidden sm:flex flex-col leading-tight">
              <span className="text-[#391511] text-sm font-semibold leading-tight">
                {nombre}
              </span>
              <Badge className={`${etiqueta.clase} text-[10px] px-1.5 py-0 h-4 w-fit font-medium`}>
                {etiqueta.texto}
              </Badge>
            </div>
          </div>

          <div className="w-px h-6 bg-[#e4c9b0]" />

          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            disabled={cerrandoSesion}
            className="text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511] gap-1.5 text-xs font-medium"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Salir</span>
          </Button>
        </div>
      </header>

      {/* Sidebar mobile en Sheet */}
      <Sheet open={sidebarAbierto} onOpenChange={setSidebarAbierto}>
        <SheetContent side="left" className="p-0 w-60 bg-[#391511] border-r-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Menú de navegación</SheetTitle>
          </SheetHeader>
          <div onClick={() => setSidebarAbierto(false)} className="h-full">
            <Sidebar permisos={permisos} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
