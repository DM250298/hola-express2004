'use client'

import { useEffect, useState } from 'react'
import { Banknote, Loader2 } from 'lucide-react'
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
import { MontoARS } from '@/components/shared/MontoARS'
import { useGenerarRemesa } from '@/lib/hooks/useCajaFuerte'
import { useCuentas } from '@/lib/hooks/useCuentas'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  usuarioId: string
  saldoDisponible: number
}

const SIN_CUENTA = '__sin__'

export function ModalRemesa({
  abierto,
  onCambioAbierto,
  usuarioId,
  saldoDisponible,
}: Props) {
  const { data: cuentas } = useCuentas(true)
  const generar = useGenerarRemesa()
  const [cuentaId, setCuentaId] = useState<string>(SIN_CUENTA)
  const [monto, setMonto] = useState('')
  const [comprobante, setComprobante] = useState('')
  const [nota, setNota] = useState('')

  // Cuentas de tipo banco o billetera (destino del depósito)
  const cuentasDestino = (cuentas ?? []).filter(
    (c) => c.tipo === 'banco' || c.tipo === 'billetera_virtual'
  )

  useEffect(() => {
    if (abierto) {
      setMonto(saldoDisponible > 0 ? String(saldoDisponible) : '')
      setComprobante('')
      setNota('')
      setCuentaId(SIN_CUENTA)
    }
  }, [abierto, saldoDisponible])

  const montoNum = Number(monto)
  const puedeGenerar =
    cuentaId !== SIN_CUENTA &&
    Number.isFinite(montoNum) &&
    montoNum > 0 &&
    !generar.isPending

  function confirmar() {
    if (!puedeGenerar) return
    generar.mutate(
      {
        usuario_id: usuarioId,
        cuenta_id: Number(cuentaId),
        monto: montoNum,
        comprobante: comprobante.trim() || null,
        nota: nota.trim() || null,
      },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !generar.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <Banknote className="h-5 w-5 text-[#f9b44c]" />
            Generar remesa / depósito
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Registrá el efectivo que sale de la caja fuerte hacia el banco.
            Disponible en caja fuerte: <MontoARS monto={saldoDisponible} />.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Cuenta destino
            </Label>
            <Select
              value={cuentaId}
              onValueChange={(v) => setCuentaId(v ?? SIN_CUENTA)}
              disabled={generar.isPending}
            >
              <SelectTrigger className="h-11 border-[#e4c9b0] focus:ring-[#f9b44c]">
                <SelectValue placeholder="Elegí la cuenta bancaria…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_CUENTA} disabled>
                  Elegí la cuenta bancaria…
                </SelectItem>
                {cuentasDestino.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.nombre}
                    {c.banco ? ` · ${c.banco}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {cuentasDestino.length === 0 && (
              <p className="text-xs text-[#c43e2c]">
                No hay cuentas bancarias. Creá una en la pestaña Cuentas.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Monto</Label>
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
                  disabled={generar.isPending}
                  className="pl-7 h-11 text-lg font-semibold tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Comprobante
              </Label>
              <Input
                value={comprobante}
                onChange={(e) => setComprobante(e.target.value)}
                placeholder="N.º de remesa"
                maxLength={60}
                disabled={generar.isPending}
                className="h-11 border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Nota (opcional)
            </Label>
            <Input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ej: transportadora de caudales…"
              maxLength={200}
              disabled={generar.isPending}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
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
            onClick={confirmar}
            disabled={!puedeGenerar}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            {generar.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generando…
              </>
            ) : (
              'Generar remesa'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
