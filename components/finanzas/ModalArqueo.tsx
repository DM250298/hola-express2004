'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Calculator, Loader2 } from 'lucide-react'
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
import { MontoARS } from '@/components/shared/MontoARS'
import { useValidarArqueo } from '@/lib/hooks/useCajaFuerte'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  usuarioId: string
  sangriaIds: number[]
  montoEsperado: number
}

export function ModalArqueo({
  abierto,
  onCambioAbierto,
  usuarioId,
  sangriaIds,
  montoEsperado,
}: Props) {
  const validar = useValidarArqueo()
  const [montoFisico, setMontoFisico] = useState('')
  const [nota, setNota] = useState('')

  useEffect(() => {
    if (abierto) {
      setMontoFisico(String(montoEsperado))
      setNota('')
    }
  }, [abierto, montoEsperado])

  const fisicoNum = Number(montoFisico) || 0
  const diferencia = useMemo(
    () => Math.round((fisicoNum - montoEsperado) * 100) / 100,
    [fisicoNum, montoEsperado]
  )
  const hayDiferencia = diferencia !== 0
  const requiereNota = hayDiferencia && nota.trim() === ''

  const puedeValidar =
    sangriaIds.length > 0 &&
    Number.isFinite(fisicoNum) &&
    fisicoNum >= 0 &&
    !requiereNota &&
    !validar.isPending

  function confirmar() {
    if (!puedeValidar) return
    validar.mutate(
      {
        usuario_id: usuarioId,
        sangria_ids: sangriaIds,
        monto_fisico: fisicoNum,
        nota: nota.trim() || null,
      },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !validar.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <Calculator className="h-5 w-5 text-[#f9b44c]" />
            Arqueo de tesorería
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Contá los sobres físicos y validalos contra lo que reportó el POS.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <div className="flex items-center justify-between rounded-xl bg-[#fdfaf6] border border-[#e4c9b0]/60 px-4 py-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Esperado ({sangriaIds.length} sobre
                {sangriaIds.length === 1 ? '' : 's'})
              </div>
              <div className="text-lg font-bold text-[#391511] tabular-nums">
                <MontoARS monto={montoEsperado} />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Monto físico contado
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
                value={montoFisico}
                onChange={(e) => setMontoFisico(e.target.value)}
                autoFocus
                disabled={validar.isPending}
                className="pl-7 h-12 text-xl font-bold tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>
          </div>

          {/* Diferencia */}
          <div
            className={
              hayDiferencia
                ? 'rounded-xl bg-[#c43e2c]/10 border-2 border-[#c43e2c]/40 px-4 py-3'
                : 'rounded-xl bg-[#2f7d4f]/10 border border-[#2f7d4f]/30 px-4 py-3'
            }
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-[#391511]">
                Diferencia
              </span>
              <span
                className={
                  hayDiferencia
                    ? 'text-lg font-extrabold tabular-nums text-[#c43e2c]'
                    : 'text-lg font-extrabold tabular-nums text-[#2f7d4f]'
                }
              >
                {diferencia > 0 ? '+' : ''}
                <MontoARS monto={diferencia} />
              </span>
            </div>
          </div>

          {hayDiferencia && (
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5 text-[#c43e2c]" />
                Nota de ajuste (obligatoria con diferencia)
              </Label>
              <Input
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Explicá el motivo de la diferencia…"
                maxLength={300}
                disabled={validar.isPending}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>
          )}
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={validar.isPending}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={confirmar}
            disabled={!puedeValidar}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            {validar.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Validando…
              </>
            ) : (
              'Validar arqueo'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
