'use client'

import { useEffect, useState } from 'react'
import { Loader2, Wallet } from 'lucide-react'
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
import { useCrearEgreso } from '@/lib/hooks/useFinanzas'
import { CATEGORIAS_EGRESO } from '@/lib/queries/finanzas'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  turnoId: number
  usuarioId: string
}

const CAT_ITEMS: Record<string, string> = Object.fromEntries(
  CATEGORIAS_EGRESO.map((c) => [c.valor, c.etiqueta])
)

function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function ModalGastoPOS({
  abierto,
  onCambioAbierto,
  turnoId,
  usuarioId,
}: Props) {
  const crear = useCrearEgreso()
  const [descripcion, setDescripcion] = useState('')
  const [monto, setMonto] = useState('')
  const [categoria, setCategoria] = useState('otros')

  useEffect(() => {
    if (abierto) {
      setDescripcion('')
      setMonto('')
      setCategoria('otros')
    }
  }, [abierto])

  const montoNum = Number(monto)
  const puedeGuardar =
    descripcion.trim().length >= 2 &&
    Number.isFinite(montoNum) &&
    montoNum > 0 &&
    !crear.isPending

  function guardar() {
    if (!puedeGuardar) return
    crear.mutate(
      {
        descripcion: descripcion.trim(),
        monto: montoNum,
        categoria,
        fecha: hoyIso(),
        usuario_id: usuarioId,
        turno_id: turnoId,
      },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !crear.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <Wallet className="h-5 w-5 text-[#f9b44c]" />
            Registrar gasto de caja
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            El gasto sale del efectivo del turno y se descuenta al cerrar la
            caja.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Descripción
            </Label>
            <Input
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Ej: flete, propina, compra de bolsas…"
              maxLength={200}
              autoFocus
              disabled={crear.isPending}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Monto
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
                  disabled={crear.isPending}
                  className="pl-7 h-11 text-lg font-semibold tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Categoría
              </Label>
              <Select
                items={CAT_ITEMS}
                value={categoria}
                onValueChange={(v) => setCategoria(v ?? 'otros')}
                disabled={crear.isPending}
              >
                <SelectTrigger className="h-11 border-[#e4c9b0] focus:ring-[#f9b44c]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIAS_EGRESO.map((c) => (
                    <SelectItem key={c.valor} value={c.valor}>
                      {c.etiqueta}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={crear.isPending}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={guardar}
            disabled={!puedeGuardar}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            {crear.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando…
              </>
            ) : (
              'Registrar gasto'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
