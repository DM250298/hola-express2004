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
import { useGenerarLiquidacion } from '@/lib/hooks/useRrhh'
import { useUsuario } from '@/lib/hooks/useUsuario'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Se llama con el id del lote generado. */
  onGenerada: (loteId: number) => void
}

function mesActual(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function esMesSac(periodo: string): boolean {
  const mes = Number(periodo.split('-')[1])
  return mes === 6 || mes === 12
}

export function ModalGenerarLiquidacion({
  abierto,
  onCambioAbierto,
  onGenerada,
}: Props) {
  const { data: usuario } = useUsuario()
  const generar = useGenerarLiquidacion()

  const [periodo, setPeriodo] = useState(mesActual())

  useEffect(() => {
    if (abierto) setPeriodo(mesActual())
  }, [abierto])

  const puedeGenerar = periodo !== '' && !generar.isPending && !!usuario

  function handleGenerar() {
    if (!puedeGenerar || !usuario) return
    generar.mutate(
      { periodo, usuarioId: usuario.id },
      {
        onSuccess: (lote) => {
          onCambioAbierto(false)
          onGenerada(lote.id)
        },
      }
    )
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !generar.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">
            Generar liquidación
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Arma un recibo por cada empleado activo con la asistencia y el
            sueldo del período.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Período</Label>
            <Input
              type="month"
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value || mesActual())}
              disabled={generar.isPending}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
            />
          </div>

          <div className="text-[11px] text-[#6f3a2a] bg-[#fdfaf6] border border-[#e4c9b0]/60 rounded-lg px-3 py-2.5 space-y-1.5">
            <p className="font-semibold text-[#391511]">Qué incluye el cálculo</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Sueldo básico + presentismo (si no lo perdió por faltas).</li>
              <li>Horas extra 50% / 100% automáticas desde la asistencia.</li>
              <li>Adelantos, otros descuentos y consumo de cuenta corriente.</li>
              {esMesSac(periodo) && (
                <li className="text-[#391511] font-medium">
                  SAC (½ aguinaldo): se incluye por ser {' '}
                  {Number(periodo.split('-')[1]) === 6 ? 'junio' : 'diciembre'}.
                </li>
              )}
            </ul>
            <p className="pt-0.5">
              Si ya hay un borrador del período, se reemplaza. Una liquidación
              confirmada no se regenera.
            </p>
          </div>
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={generar.isPending}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleGenerar}
            disabled={!puedeGenerar}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            {generar.isPending ? (
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
