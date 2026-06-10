'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MontoARS } from '@/components/shared/MontoARS'
import { useCerrarOrden } from '@/lib/hooks/useProduccion'
import { useUsuario } from '@/lib/hooks/useUsuario'
import type { OrdenConProducto } from '@/lib/queries/produccion'

interface Props {
  orden: OrdenConProducto
  open: boolean
  onOpenChange: (v: boolean) => void
}

export function ModalCierreOrden({ orden, open, onOpenChange }: Props) {
  const { data: usuario } = useUsuario()
  const cerrar = useCerrarOrden()
  const [producida, setProducida] = useState(orden.cantidad_planificada)

  const merma = orden.cantidad_planificada - producida
  const costoUnit = producida > 0 ? orden.costo_total / producida : 0
  const unidad = orden.producto?.unidad ?? 'u'

  function handleCerrar() {
    if (!usuario || producida <= 0) return
    cerrar.mutate(
      {
        orden_id: orden.id,
        cantidad_producida: producida,
        usuario_id: usuario.id,
      },
      { onSuccess: () => onOpenChange(false) }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#391511]">
            Cerrar producción · {orden.producto?.nombre ?? 'Producto'}
          </DialogTitle>
          <DialogDescription>
            Cargá lo que realmente se produjo. Se ingresa al stock, se crea el
            lote con vencimiento y se calcula el costo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[#6f3a2a]">Planificado</span>
            <span className="font-medium text-[#391511]">
              {orden.cantidad_planificada} {unidad}
            </span>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#6f3a2a]">Producido real ({unidad})</Label>
            <Input
              type="number"
              min={0}
              step="0.001"
              value={producida}
              onChange={(e) => setProducida(Number(e.target.value))}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-[#e4c9b0]/60 bg-[#fdfaf6] p-2.5">
              <div className="text-[10px] uppercase tracking-wide text-[#6f3a2a]">
                Merma de rinde
              </div>
              <div
                className={
                  merma > 0
                    ? 'text-[#c45e14] font-bold'
                    : 'text-[#2f8f4e] font-bold'
                }
              >
                {merma > 0 ? `${merma} ${unidad}` : 'Sin merma'}
              </div>
            </div>
            <div className="rounded-lg border border-[#e4c9b0]/60 bg-[#fdfaf6] p-2.5">
              <div className="text-[10px] uppercase tracking-wide text-[#6f3a2a]">
                Costo unitario
              </div>
              <div className="font-bold text-[#391511]">
                <MontoARS monto={costoUnit} />
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-[#e4c9b0]/40">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleCerrar}
            disabled={producida <= 0 || cerrar.isPending}
            className="bg-[#2f8f4e] hover:bg-[#267a42] text-white"
          >
            {cerrar.isPending ? 'Cerrando…' : 'Finalizar producción'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
