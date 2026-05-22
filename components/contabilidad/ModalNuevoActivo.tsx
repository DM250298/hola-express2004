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
import { useCrearActivo } from '@/lib/hooks/useContabilidad'
import { useUsuario } from '@/lib/hooks/useUsuario'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
}

function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function ModalNuevoActivo({ abierto, onCambioAbierto }: Props) {
  const { data: usuario } = useUsuario()
  const crear = useCrearActivo()

  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [fecha, setFecha] = useState(hoyIso())
  const [valor, setValor] = useState('')
  const [vidaUtil, setVidaUtil] = useState('60')
  const [residual, setResidual] = useState('0')

  useEffect(() => {
    if (abierto) {
      setNombre('')
      setDescripcion('')
      setFecha(hoyIso())
      setValor('')
      setVidaUtil('60')
      setResidual('0')
    }
  }, [abierto])

  const valorNum = Number(valor)
  const vidaNum = Number(vidaUtil)
  const puedeGuardar =
    nombre.trim().length > 0 &&
    valorNum > 0 &&
    vidaNum > 0 &&
    !crear.isPending

  function guardar() {
    if (!puedeGuardar || !usuario) return
    crear.mutate(
      {
        nombre: nombre.trim(),
        descripcion: descripcion.trim() || null,
        fecha_adquisicion: fecha,
        valor_origen: valorNum,
        vida_util_meses: Math.round(vidaNum),
        valor_residual: Number(residual) || 0,
        usuario_id: usuario.id,
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
          <DialogTitle className="text-[#391511] text-lg">
            Nuevo activo fijo
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Se registra el bien y se genera su asiento de alta.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Nombre</Label>
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Heladera exhibidora"
              disabled={crear.isPending}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Descripción (opcional)
            </Label>
            <Input
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Marca, modelo, número de serie…"
              disabled={crear.isPending}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Fecha de compra
              </Label>
              <Input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                disabled={crear.isPending}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Valor de origen
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c8a58a] text-sm">
                  $
                </span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  placeholder="0,00"
                  disabled={crear.isPending}
                  className="pl-7 tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Vida útil (meses)
              </Label>
              <Input
                type="number"
                min="1"
                value={vidaUtil}
                onChange={(e) => setVidaUtil(e.target.value)}
                disabled={crear.isPending}
                className="tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Valor residual
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c8a58a] text-sm">
                  $
                </span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={residual}
                  onChange={(e) => setResidual(e.target.value)}
                  disabled={crear.isPending}
                  className="pl-7 tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
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
              'Registrar activo'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
