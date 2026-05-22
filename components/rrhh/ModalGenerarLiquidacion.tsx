'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
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
import { useLiquidarPeriodo } from '@/lib/hooks/useRrhh'
import { useUsuario } from '@/lib/hooks/useUsuario'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Se llama con el id de la liquidación generada. */
  onGenerada: (liquidacionId: number) => void
}

function mesActual(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function ModalGenerarLiquidacion({
  abierto,
  onCambioAbierto,
  onGenerada,
}: Props) {
  const { data: usuario } = useUsuario()
  const liquidar = useLiquidarPeriodo()

  const [periodo, setPeriodo] = useState(mesActual())
  const [aportes, setAportes] = useState('17')

  useEffect(() => {
    if (abierto) {
      setPeriodo(mesActual())
      setAportes('17')
    }
  }, [abierto])

  const aportesNum = Number(aportes)
  const puedeGenerar =
    periodo !== '' &&
    aportesNum >= 0 &&
    aportesNum < 100 &&
    !liquidar.isPending &&
    !!usuario

  function generar() {
    if (!puedeGenerar || !usuario) return
    liquidar.mutate(
      {
        periodo,
        aportesPorcentaje: aportesNum,
        usuarioId: usuario.id,
      },
      {
        onSuccess: (liq) => {
          onCambioAbierto(false)
          onGenerada(liq.id)
        },
      }
    )
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !liquidar.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">
            Generar liquidación
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Arma un recibo por cada empleado activo con sus novedades del
            período.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Período
            </Label>
            <Input
              type="month"
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value || mesActual())}
              disabled={liquidar.isPending}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Aportes / retenciones (%)
            </Label>
            <div className="relative">
              <Input
                type="number"
                min="0"
                max="99"
                step="0.5"
                value={aportes}
                onChange={(e) => setAportes(e.target.value)}
                disabled={liquidar.isPending}
                className="pr-8 tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#c8a58a] text-sm">
                %
              </span>
            </div>
            <p className="text-[11px] text-[#c8a58a]">
              Se descuenta del bruto de cada recibo. En Argentina el aporte del
              empleado suele ser ~17% (jubilación 11% + obra social 3% + ley
              19032 3%).
            </p>
          </div>

          <p className="text-[11px] text-[#6f3a2a] bg-[#fdfaf6] border border-[#e4c9b0]/60 rounded-lg px-3 py-2">
            Si ya generaste un borrador para este período, se reemplaza con los
            datos actuales. Una liquidación confirmada no se puede regenerar.
          </p>
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={liquidar.isPending}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={generar}
            disabled={!puedeGenerar}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            {liquidar.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generando…
              </>
            ) : (
              'Generar liquidación'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
