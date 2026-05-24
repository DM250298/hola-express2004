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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCrearMovimientoCtaCte } from '@/lib/hooks/useCtaCteEmpleado'
import { useUsuario } from '@/lib/hooks/useUsuario'
import type { TipoMovimientoCtaCte } from '@/types/database'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  empleadoId: number
  empleadoNombre: string
}

type Tipo = Exclude<TipoMovimientoCtaCte, 'descuento_sueldo'>

const TIPOS: Record<Tipo, { label: string; signo: 1 | -1; descripcion: string }> = {
  consumo: {
    label: 'Consumo (aumenta deuda)',
    signo: 1,
    descripcion: 'El empleado se llevó mercadería del local.',
  },
  pago_libre: {
    label: 'Pago (cancela deuda)',
    signo: -1,
    descripcion: 'El empleado pagó fuera del sueldo (efectivo, transferencia).',
  },
  ajuste: {
    label: 'Ajuste manual (libre)',
    signo: 1,
    descripcion: 'Corregir un error o aplicar un perdón. Podés usar signo negativo.',
  },
}

export function ModalMovimientoCtaCte({
  abierto,
  onCambioAbierto,
  empleadoId,
  empleadoNombre,
}: Props) {
  const { data: usuario } = useUsuario()
  const crear = useCrearMovimientoCtaCte()

  const [tipo, setTipo] = useState<Tipo>('consumo')
  const [monto, setMonto] = useState('')
  const [concepto, setConcepto] = useState('')
  const [fecha, setFecha] = useState(() =>
    new Date().toISOString().slice(0, 10)
  )

  useEffect(() => {
    if (abierto) {
      setTipo('consumo')
      setMonto('')
      setConcepto('')
      setFecha(new Date().toISOString().slice(0, 10))
    }
  }, [abierto])

  const procesando = crear.isPending
  const cfg = TIPOS[tipo]
  const montoNum = Number(monto) || 0
  const puedeGuardar = !procesando && montoNum !== 0 && !!fecha

  const tiposMap: Record<string, string> = Object.fromEntries(
    (Object.keys(TIPOS) as Tipo[]).map((t) => [t, TIPOS[t].label])
  )

  function guardar() {
    if (!puedeGuardar) return
    const abs = Math.abs(montoNum)
    // Para ajuste, respetamos el signo que escribió el usuario.
    const montoFinal = tipo === 'ajuste' ? montoNum : cfg.signo * abs
    crear.mutate(
      {
        empleado_id: empleadoId,
        fecha,
        tipo,
        concepto: concepto.trim() || null,
        monto: montoFinal,
        usuario_id: usuario?.id ?? null,
      },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !procesando && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">
            Nuevo movimiento de cuenta corriente
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {empleadoNombre}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Tipo</Label>
            <Select
              items={tiposMap}
              value={tipo}
              onValueChange={(v) => setTipo((v as Tipo) ?? 'consumo')}
              disabled={procesando}
            >
              <SelectTrigger className="w-full border-[#e4c9b0] focus:ring-[#f9b44c]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TIPOS) as Tipo[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {TIPOS[t].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-[#c8a58a]">{cfg.descripcion}</p>
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
                  step="0.01"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  placeholder={tipo === 'ajuste' ? 'Puede ser negativo' : '0.00'}
                  disabled={procesando}
                  className="pl-7 tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Fecha
              </Label>
              <Input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                disabled={procesando}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Concepto (opcional)
            </Label>
            <Input
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              placeholder="Ej: 2 paquetes de yerba y 1 gaseosa"
              disabled={procesando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
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
            ) : (
              'Registrar movimiento'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
