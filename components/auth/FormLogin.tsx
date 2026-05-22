'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Lock, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'

export function FormLogin() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [contrasena, setContrasena] = useState('')
  const [cargando, setCargando] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (cargando) return
    setCargando(true)

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: contrasena,
      })

      if (error) {
        const mensajes: Record<string, string> = {
          'Invalid login credentials': 'Email o contraseña incorrectos.',
          'Email not confirmed': 'Confirmá tu email antes de ingresar.',
          'Too many requests': 'Demasiados intentos. Esperá unos minutos.',
        }
        toast.error(mensajes[error.message] ?? 'No se pudo iniciar sesión. Intentá de nuevo.')
        return
      }

      router.push('/')
      router.refresh()
    } catch {
      toast.error('Error inesperado. Revisá tu conexión e intentá de nuevo.')
    } finally {
      setCargando(false)
    }
  }

  return (
    <Card className="w-full max-w-sm shadow-2xl border-0 rounded-2xl overflow-hidden">
      {/* Header con branding */}
      <CardHeader className="bg-[#391511] text-center pb-8 pt-8 px-8">
        <div className="flex flex-col items-center gap-2">
          {/* Isotipo / Logo textual */}
          <div className="flex items-baseline gap-1">
            <span
              className="text-5xl font-extrabold text-[#f9b44c] leading-none tracking-tight"
              style={{ fontFamily: 'var(--font-bricolage)' }}
            >
              ¡Hola!
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <div className="h-px w-8 bg-[#f9b44c]/40" />
            <span className="text-[#f9d2a2] text-sm font-medium tracking-[0.2em] uppercase">
              Express
            </span>
            <div className="h-px w-8 bg-[#f9b44c]/40" />
          </div>
          <p className="text-[#c8a58a] text-xs mt-2 font-light">
            Sistema de gestión operativa
          </p>
        </div>
      </CardHeader>

      <CardContent className="px-8 py-7 bg-white">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-[#391511] font-medium text-sm">
              Email
            </Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a]" />
              <Input
                id="email"
                type="email"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={cargando}
                className="pl-9 border-[#e4c9b0] focus-visible:ring-[#f9b44c] focus-visible:border-[#f9b44c]"
                autoComplete="email"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contrasena" className="text-[#391511] font-medium text-sm">
              Contraseña
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a]" />
              <Input
                id="contrasena"
                type="password"
                placeholder="••••••••"
                value={contrasena}
                onChange={(e) => setContrasena(e.target.value)}
                required
                disabled={cargando}
                className="pl-9 border-[#e4c9b0] focus-visible:ring-[#f9b44c] focus-visible:border-[#f9b44c]"
                autoComplete="current-password"
              />
            </div>
          </div>

          <Button
            type="submit"
            disabled={cargando}
            className="w-full bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold h-11 rounded-xl shadow-md transition-all duration-200 hover:shadow-lg mt-2"
          >
            {cargando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Ingresando…
              </>
            ) : (
              'Ingresar'
            )}
          </Button>
        </form>

        <p className="text-center text-[#c8a58a] text-xs mt-6">
          24/7 · La Rioja, Argentina
        </p>
      </CardContent>
    </Card>
  )
}
