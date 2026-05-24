'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCategorias } from '@/lib/hooks/useCategorias'
import { useProveedores } from '@/lib/hooks/useProveedores'
import { aplicarMinimoMasivo } from '@/lib/queries/vencimientoMinimo'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
}

const SIN_SELECCION = '__ninguno'

export function ModalVencimientoMinimoMasivo({
  abierto,
  onCambioAbierto,
}: Props) {
  const qc = useQueryClient()
  const { data: categorias } = useCategorias()
  const { data: proveedores } = useProveedores()

  const [categoriaId, setCategoriaId] = useState<string>(SIN_SELECCION)
  const [proveedorId, setProveedorId] = useState<string>(SIN_SELECCION)
  const [dias, setDias] = useState('30')
  const [sinMinimo, setSinMinimo] = useState(false)

  const aplicar = useMutation({
    mutationFn: () =>
      aplicarMinimoMasivo({
        categoria_id:
          categoriaId !== SIN_SELECCION ? Number(categoriaId) : null,
        proveedor_id:
          proveedorId !== SIN_SELECCION ? Number(proveedorId) : null,
        dias: sinMinimo ? null : Math.max(0, Number(dias) || 0),
      }),
    onSuccess: (afectados) => {
      qc.invalidateQueries({ queryKey: ['productos'] })
      toast.success(
        afectados === 0
          ? 'No había productos con ese filtro.'
          : `Aplicado a ${afectados} producto${afectados === 1 ? '' : 's'}.`
      )
      onCambioAbierto(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const sinFiltro =
    categoriaId === SIN_SELECCION && proveedorId === SIN_SELECCION
  const puedeAplicar = !sinFiltro && (sinMinimo || Number(dias) > 0)

  const categoriasMap: Record<string, string> = {
    [SIN_SELECCION]: 'Todas',
    ...Object.fromEntries(
      (categorias ?? []).map((c) => [String(c.id), c.nombre])
    ),
  }
  const proveedoresMap: Record<string, string> = {
    [SIN_SELECCION]: 'Todos',
    ...Object.fromEntries(
      (proveedores ?? []).map((p) => [String(p.id), p.nombre])
    ),
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !aplicar.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-[#f9b44c]" />
            Vencimiento mínimo masivo
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Definí cuántos días al vencimiento debe tener la mercadería al
            recibirla. Se aplica a todos los productos del filtro elegido.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Categoría
            </Label>
            <Select
              items={categoriasMap}
              value={categoriaId}
              onValueChange={(v) => setCategoriaId(v ?? SIN_SELECCION)}
              disabled={aplicar.isPending}
            >
              <SelectTrigger className="w-full border-[#e4c9b0] focus:ring-[#f9b44c]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_SELECCION}>— Sin filtro —</SelectItem>
                {(categorias ?? []).map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Proveedor
            </Label>
            <Select
              items={proveedoresMap}
              value={proveedorId}
              onValueChange={(v) => setProveedorId(v ?? SIN_SELECCION)}
              disabled={aplicar.isPending}
            >
              <SelectTrigger className="w-full border-[#e4c9b0] focus:ring-[#f9b44c]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_SELECCION}>— Sin filtro —</SelectItem>
                {(proveedores ?? []).map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Días mínimos al vencimiento
            </Label>
            <Input
              type="number"
              min="0"
              step="1"
              value={dias}
              onChange={(e) => setDias(e.target.value)}
              disabled={aplicar.isPending || sinMinimo}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
            />
            <label className="flex items-center gap-2 pt-1 text-xs text-[#6f3a2a] cursor-pointer">
              <input
                type="checkbox"
                checked={sinMinimo}
                onChange={(e) => setSinMinimo(e.target.checked)}
                className="h-3.5 w-3.5 accent-[#f9b44c]"
              />
              Quitar la validación (sin mínimo)
            </label>
          </div>

          {sinFiltro && (
            <p className="text-xs text-[#c43e2c] bg-[#c43e2c]/10 border border-[#c43e2c]/30 rounded-lg px-3 py-2">
              Elegí al menos una categoría o un proveedor para evitar aplicar
              esto a todos los productos por accidente.
            </p>
          )}
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={aplicar.isPending}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={() => aplicar.mutate()}
            disabled={!puedeAplicar || aplicar.isPending}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            {aplicar.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Aplicando…
              </>
            ) : (
              'Aplicar a productos del filtro'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
