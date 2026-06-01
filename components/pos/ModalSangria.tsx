'use client'

import { useEffect, useState } from 'react'
import { ArrowDownToLine, Loader2 } from 'lucide-react'
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
import { useRegistrarSangria } from '@/lib/hooks/useCajaFuerte'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  turnoId: number
  usuarioId: string
}

export function ModalSangria({
  abierto,
  onCambioAbierto,
  turnoId,
  usuarioId,
}: Props) {
  const registrar = useRegistrarSangria()
  const [monto, setMonto] = useState('')
  const [nota, setNota] = useState('')

  useEffect(() => {
    if (abierto) {
      setMonto('')
      setNota('')
    }
  }, [abierto])

  const montoNum = Number(monto)
  const puedeGuardar =
    Number.isFinite(montoNum) && montoNum > 0 && !registrar.isPending

  function guardar() {
    if (!puedeGuardar) return
    registrar.mutate(
      {
        turno_id: turnoId,
        usuario_id: usuarioId,
        monto: montoNum,
        nota: nota.trim() || null,
      },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !registrar.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <ArrowDownToLine className="h-5 w-5 text-[#f9b44c]" />
            Sangría / Retiro a caja fuerte
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Retirá el excedente de efectivo de la caja y dejalo en el buzón de
            la caja fuerte. Queda registrado a tu nombre y turno.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Monto del sobre
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c8a58a] text-sm">
                $
              </span>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                placeholder="0,00"
                autoFocus
                disabled={registrar.isPending}
                className="pl-7 h-12 text-xl font-bold tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Nota (opcional)
            </Label>
            <Input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ej: sobre n.º 2 del turno"
              maxLength={200}
              disabled={registrar.isPending}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          <p className="text-xs text-[#6f3a2a] bg-[#f9b44c]/10 rounded-lg px-3 py-2">
            La sangría descuenta efectivo de la caja del turno. El responsable
            financiero lo va a contar y validar en el arqueo de tesorería.
          </p>
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={registrar.isPending}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={guardar}
            disabled={!puedeGuardar}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            {registrar.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Registrando…
              </>
            ) : (
              'Registrar sangría'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
