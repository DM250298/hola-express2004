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
import { Label } from '@/components/ui/label'
import { InputNumero } from './InputNumero'
import { TablaDisponibilidad } from './TablaDisponibilidad'
import { useCrearOrden, useRecetas } from '@/lib/hooks/useProduccion'
import { useUsuario } from '@/lib/hooks/useUsuario'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
}

export function AsistenteNuevaOrden({ open, onOpenChange }: Props) {
  const { data: usuario } = useUsuario()
  const { data: recetas } = useRecetas()
  const crear = useCrearOrden()

  const [recetaId, setRecetaId] = useState<number | undefined>()
  const [cantidad, setCantidad] = useState(1)

  const recetaSel = recetas?.find((r) => r.id === recetaId)

  function handleCrear() {
    if (!recetaSel || !usuario) return
    crear.mutate(
      {
        producto_id: recetaSel.producto_id,
        receta_id: recetaSel.id,
        cantidad_planificada: cantidad,
        usuario_id: usuario.id,
      },
      {
        onSuccess: () => {
          setRecetaId(undefined)
          setCantidad(1)
          onOpenChange(false)
        },
      }
    )
  }

  const puedeCrear = !!recetaSel && cantidad > 0 && !!usuario && !crear.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[#391511]">
            Nueva orden de producción
          </DialogTitle>
          <DialogDescription>
            Elegí qué producir y cuánto. Revisá la disponibilidad de insumos
            antes de iniciar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[#6f3a2a]">Producto a producir</Label>
            <select
              value={recetaId ?? ''}
              onChange={(e) => setRecetaId(Number(e.target.value) || undefined)}
              className="w-full h-9 rounded-lg border border-[#e4c9b0] bg-white px-3 text-sm text-[#391511] focus:outline-none focus:ring-2 focus:ring-[#f9b44c]"
            >
              <option value="">Elegí una receta…</option>
              {(recetas ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.producto?.nombre ?? 'Producto'} (rinde {r.rendimiento}{' '}
                  {r.unidad_rendimiento})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#6f3a2a]">
              Cantidad a producir{' '}
              {recetaSel ? `(${recetaSel.unidad_rendimiento})` : ''}
            </Label>
            <InputNumero
              min={0}
              step="0.001"
              value={cantidad}
              onChange={setCantidad}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#6f3a2a]">Disponibilidad de insumos</Label>
            <TablaDisponibilidad recetaId={recetaId} cantidad={cantidad} />
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
            onClick={handleCrear}
            disabled={!puedeCrear}
            className="bg-[#391511] hover:bg-[#4a1d16] text-white"
          >
            {crear.isPending ? 'Creando…' : 'Crear orden'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
