'use client'

import { useEffect, useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
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
import { useSetPin, useTienePin } from '@/lib/hooks/useAsistencia'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  empleadoId: number
  nombre: string
}

export function ModalPin({ abierto, onCambioAbierto, empleadoId, nombre }: Props) {
  const { data: tienePin } = useTienePin(abierto ? empleadoId : undefined)
  const guardar = useSetPin()
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')

  useEffect(() => {
    if (abierto) {
      setPin('')
      setPin2('')
    }
  }, [abierto])

  const valido = /^\d{4}$/.test(pin) && pin === pin2
  const error = pin2.length === 4 && pin !== pin2 ? 'Los PIN no coinciden.' : null

  function onGuardar() {
    if (!valido) return
    guardar.mutate(
      { empleadoId, pin },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !guardar.isPending && onCambioAbierto(v)}>
      <DialogContent className="sm:max-w-sm p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-[#f9b44c]" />
            PIN del kiosco
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {nombre} · {tienePin ? 'ya tiene un PIN (lo vas a reemplazar)' : 'sin PIN definido'}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Nuevo PIN (4 dígitos)</Label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="••••"
              disabled={guardar.isPending}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums tracking-[0.5em] text-center"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Repetir PIN</Label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="••••"
              disabled={guardar.isPending}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums tracking-[0.5em] text-center"
            />
          </div>
          {error && <p className="text-[#c43e2c] text-sm">{error}</p>}
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={guardar.isPending}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={onGuardar}
            disabled={!valido || guardar.isPending}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            {guardar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar PIN'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
