'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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
import {
  useActualizarCuentaContable,
  useCrearCuentaContable,
} from '@/lib/hooks/useContabilidad'
import { TIPOS_CUENTA } from '@/lib/queries/contabilidad'
import type { PlanCuentaRow, TipoCuentaContable } from '@/types/database'

const ITEMS_TIPO: Record<string, string> = Object.fromEntries(
  TIPOS_CUENTA.map((t) => [t.valor, t.etiqueta])
)

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  cuenta: PlanCuentaRow | null
}

export function ModalCuentaContable({ abierto, onCambioAbierto, cuenta }: Props) {
  const crear = useCrearCuentaContable()
  const actualizar = useActualizarCuentaContable()

  const [codigo, setCodigo] = useState('')
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState<TipoCuentaContable>('activo')
  const [imputable, setImputable] = useState(true)

  const esEdicion = cuenta !== null
  const procesando = crear.isPending || actualizar.isPending

  useEffect(() => {
    if (!abierto) return
    setCodigo(cuenta?.codigo ?? '')
    setNombre(cuenta?.nombre ?? '')
    setTipo(cuenta?.tipo ?? 'activo')
    setImputable(cuenta?.imputable ?? true)
  }, [abierto, cuenta])

  const puedeGuardar =
    codigo.trim().length > 0 && nombre.trim().length > 0 && !procesando

  function guardar() {
    if (!puedeGuardar) return
    if (esEdicion && cuenta) {
      actualizar.mutate(
        {
          id: cuenta.id,
          patch: {
            codigo: codigo.trim(),
            nombre: nombre.trim(),
            tipo,
            imputable,
          },
        },
        { onSuccess: () => onCambioAbierto(false) }
      )
    } else {
      crear.mutate(
        { codigo: codigo.trim(), nombre: nombre.trim(), tipo, imputable },
        { onSuccess: () => onCambioAbierto(false) }
      )
    }
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !procesando && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">
            {esEdicion ? 'Editar cuenta' : 'Nueva cuenta contable'}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            El código define la jerarquía (ej: 1.1.07 cuelga de 1.1).
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-[110px_1fr] gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Código
              </Label>
              <Input
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="1.1.07"
                disabled={procesando}
                className="font-mono tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Nombre
              </Label>
              <Input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej: Caja Chica"
                disabled={procesando}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Tipo</Label>
            <Select
              items={ITEMS_TIPO}
              value={tipo}
              onValueChange={(v) => setTipo((v ?? 'activo') as TipoCuentaContable)}
              disabled={procesando}
            >
              <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_CUENTA.map((t) => (
                  <SelectItem key={t.valor} value={t.valor}>
                    {t.etiqueta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-[#fdfaf6] border border-[#e4c9b0]/60">
            <div>
              <Label className="text-[#391511] font-medium">Imputable</Label>
              <p className="text-[#6f3a2a] text-xs mt-0.5">
                Si está activo, se puede usar en asientos. Las cuentas título
                (agrupadoras) van desactivadas.
              </p>
            </div>
            <Switch
              checked={imputable}
              onCheckedChange={setImputable}
              disabled={procesando}
            />
          </div>
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={procesando}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={guardar}
            disabled={!puedeGuardar}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            {procesando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando…
              </>
            ) : esEdicion ? (
              'Guardar cambios'
            ) : (
              'Crear cuenta'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
