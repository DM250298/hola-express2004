'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MontoARS } from '@/components/shared/MontoARS'
import { useCuentas } from '@/lib/hooks/useCuentas'
import { usePagarCuenta } from '@/lib/hooks/useFinanzas'
import { useUsuario } from '@/lib/hooks/useUsuario'
import type { CuentaAPagarConProveedor } from '@/lib/queries/finanzas'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  cuenta: CuentaAPagarConProveedor | null
}

function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function ModalPagarCuenta({ abierto, onCambioAbierto, cuenta }: Props) {
  const { data: usuario } = useUsuario()
  const { data: cuentas } = useCuentas(true)
  const pagar = usePagarCuenta()

  const pendiente = cuenta?.saldo_pendiente ?? 0

  const [cuentaOrigen, setCuentaOrigen] = useState<string>('')
  const [monto, setMonto] = useState<string>('')
  const [fecha, setFecha] = useState<string>(hoyIso())
  const [nota, setNota] = useState<string>('')

  // Al abrir, precargar monto = saldo pendiente y resetear
  useEffect(() => {
    if (abierto && cuenta) {
      setMonto(String(r2(cuenta.saldo_pendiente)))
      setFecha(hoyIso())
      setNota('')
      setCuentaOrigen('')
    }
  }, [abierto, cuenta])

  const montoNum = Number(monto) || 0
  const cuentaSel = useMemo(
    () => (cuentas ?? []).find((c) => String(c.id) === cuentaOrigen) ?? null,
    [cuentas, cuentaOrigen]
  )

  const excedePendiente = montoNum > pendiente + 0.009
  const esParcial = montoNum > 0 && montoNum < pendiente - 0.009
  const saldoInsuficiente =
    cuentaSel != null && cuentaSel.saldo_actual < montoNum - 0.009
  const puedeGuardar =
    !!usuario &&
    !!cuentaSel &&
    montoNum > 0 &&
    !excedePendiente &&
    !pagar.isPending

  function handlePagar() {
    if (!cuenta || !usuario || !cuentaSel || !puedeGuardar) return
    pagar.mutate(
      {
        cuenta_id: cuenta.id,
        usuario_id: usuario.id,
        cuenta_origen_id: cuentaSel.id,
        monto: r2(montoNum),
        fecha,
        nota: nota.trim() === '' ? null : nota.trim(),
      },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !pagar.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#391511] flex items-center gap-2">
            <Wallet className="h-5 w-5 text-[#f9b44c]" />
            Registrar pago
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {cuenta?.proveedor_nombre ?? 'Proveedor'} · pedido #
            {cuenta?.pedido_id}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            handlePagar()
          }}
        >
          {/* Resumen de saldos */}
          <div className="rounded-xl border border-[#e4c9b0]/60 bg-[#fdfaf6] p-3 grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Total
              </div>
              <div className="font-bold text-[#391511] tabular-nums text-sm">
                <MontoARS monto={cuenta?.monto ?? 0} />
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Pagado
              </div>
              <div className="font-bold text-[#2f8f4e] tabular-nums text-sm">
                <MontoARS monto={cuenta?.monto_pagado ?? 0} />
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Pendiente
              </div>
              <div className="font-extrabold text-[#c43e2c] tabular-nums text-sm">
                <MontoARS monto={pendiente} />
              </div>
            </div>
          </div>

          {/* Cuenta de origen */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Pagar desde
            </Label>
            <Select value={cuentaOrigen} onValueChange={(v) => setCuentaOrigen(v ?? '')}>
              <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
                <SelectValue placeholder="Elegí la cuenta…" />
              </SelectTrigger>
              <SelectContent>
                {(cuentas ?? []).map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.nombre} · saldo{' '}
                    {new Intl.NumberFormat('es-AR', {
                      style: 'currency',
                      currency: 'ARS',
                      maximumFractionDigits: 0,
                    }).format(c.saldo_actual)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {saldoInsuficiente && (
              <p className="flex items-center gap-1 text-[11px] text-[#c43e2c]">
                <AlertTriangle className="h-3 w-3" />
                El saldo de esta cuenta quedará en negativo.
              </p>
            )}
          </div>

          {/* Monto y fecha */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Monto a pagar
              </Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                autoFocus
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
              />
              {excedePendiente && (
                <p className="text-[11px] text-[#c43e2c]">
                  No puede superar el pendiente.
                </p>
              )}
              {esParcial && !excedePendiente && (
                <p className="text-[11px] text-[#6f3a2a]">
                  Pago parcial — quedarán{' '}
                  <MontoARS monto={pendiente - montoNum} /> pendientes.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Fecha
              </Label>
              <Input
                type="date"
                value={fecha}
                max={hoyIso()}
                onChange={(e) => setFecha(e.target.value)}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
              />
            </div>
          </div>

          {/* Nota */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Nota (opcional)
            </Label>
            <Input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="N° de transferencia, comprobante…"
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => onCambioAbierto(false)}
              disabled={pagar.isPending}
              className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!puedeGuardar}
              className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
            >
              {pagar.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Registrando…
                </>
              ) : (
                <>
                  Pagar <MontoARS monto={montoNum} />
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
