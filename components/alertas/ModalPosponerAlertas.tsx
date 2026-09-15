'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { usePosponerAlertas } from '@/lib/hooks/useAlertas'
import type { Alerta } from '@/lib/queries/alertas'
import { conCantidad } from './presentacion'

const OPCIONES_DIAS = [3, 7, 15, 30]

/**
 * La decisión "por ahora no": se ocultan N días. Si al vencer el plazo el
 * problema sigue, la alerta vuelve sola a "Para resolver".
 */
export function ModalPosponerAlertas({
  alertas,
  onCerrar,
  onListo,
}: {
  alertas: Alerta[]
  onCerrar: () => void
  onListo: () => void
}) {
  const [dias, setDias] = useState(7)
  const [motivo, setMotivo] = useState('')
  const posponer = usePosponerAlertas()

  const guardar = () => {
    posponer.mutate(
      { ids: alertas.map((a) => a.id), dias, motivo: motivo.trim() },
      { onSuccess: onListo }
    )
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Posponer</DialogTitle>
          <DialogDescription>
            {conCantidad(alertas.length, 'alerta', 'alertas')}. Si el problema sigue cuando
            termine el plazo, vuelven a aparecer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Durante</Label>
            <div className="flex flex-wrap gap-2">
              {OPCIONES_DIAS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDias(d)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-sm font-medium',
                    dias === d
                      ? 'border-[#e4a42a] bg-[#f9b44c]/25 text-[#391511]'
                      : 'border-[#e4c9b0] text-[#6f3a2a] hover:border-[#c8a58a]'
                  )}
                >
                  {d} días
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="posponer-motivo">Motivo (queda registrado)</Label>
            <Input
              id="posponer-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: el proveedor entrega el jueves · es mercadería de temporada"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onCerrar} disabled={posponer.isPending}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={posponer.isPending}>
            {posponer.isPending ? 'Guardando…' : `Posponer ${dias} días`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
