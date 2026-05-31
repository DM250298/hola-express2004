'use client'

import { useState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { validarSupervisor } from '@/lib/auth/validarSupervisor'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Motivo de la autorización (se muestra al supervisor). */
  motivo: string
  /** Se llama cuando un supervisor válido autoriza. */
  onAutorizado: (nombre: string) => void
}

export function ModalClaveSupervisor({
  abierto,
  onCambioAbierto,
  motivo,
  onAutorizado,
}: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [validando, setValidando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function autorizar() {
    setValidando(true)
    setError(null)
    const r = await validarSupervisor(email, password)
    setValidando(false)
    if (r.ok) {
      setEmail('')
      setPassword('')
      onAutorizado(r.nombre ?? 'Supervisor')
      onCambioAbierto(false)
    } else {
      setError(r.error ?? 'No autorizado.')
    }
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => {
        if (!validando) {
          if (!v) {
            setEmail('')
            setPassword('')
            setError(null)
          }
          onCambioAbierto(v)
        }
      }}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#f9b44c]" />
            Autorización de supervisor
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {motivo}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sup-email" className="text-[#391511] font-medium">
              Email del supervisor
            </Label>
            <Input
              id="sup-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="encargado@holaexpress.com"
              disabled={validando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sup-pass" className="text-[#391511] font-medium">
              Contraseña
            </Label>
            <Input
              id="sup-pass"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && email && password) autorizar()
              }}
              disabled={validando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          {error && (
            <p className="text-[#c43e2c] text-sm font-medium">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => onCambioAbierto(false)}
              disabled={validando}
              className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={autorizar}
              disabled={validando || !email || !password}
              className="flex-1 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
            >
              {validando ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Validando…
                </>
              ) : (
                'Autorizar'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
