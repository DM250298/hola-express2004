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
import { cn } from '@/lib/utils'
import type { CuentaAPagarConProveedor } from '@/lib/queries/finanzas'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  cuenta: CuentaAPagarConProveedor | null
}

const FORMAS_PAGO = [
  { valor: 'efectivo', label: 'Efectivo' },
  { valor: 'transferencia', label: 'Transferencia' },
  { valor: 'cheque', label: 'Cheque' },
  { valor: 'debito', label: 'Débito' },
  { valor: 'otro', label: 'Otro' },
] as const
type FormaPago = (typeof FORMAS_PAGO)[number]['valor']

const FORMA_LABEL: Record<FormaPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  debito: 'Débito',
  otro: 'Otro',
}

function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const r2 = (n: number) => Math.round(n * 100) / 100

const fmtSaldo = (n: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n)

export function ModalPagarCuenta({ abierto, onCambioAbierto, cuenta }: Props) {
  const { data: usuario } = useUsuario()
  const { data: cuentas } = useCuentas(true)
  const pagar = usePagarCuenta()

  const pendiente = cuenta?.saldo_pendiente ?? 0

  const [cuentaOrigen, setCuentaOrigen] = useState<string>('')
  const [formaPago, setFormaPago] = useState<FormaPago>('transferencia')
  const [monto, setMonto] = useState<string>('')
  const [fecha, setFecha] = useState<string>(hoyIso())
  const [comprobante, setComprobante] = useState<string>('')
  const [nota, setNota] = useState<string>('')

  // Al abrir, precargar monto = saldo pendiente y resetear
  useEffect(() => {
    if (abierto && cuenta) {
      setMonto(String(r2(cuenta.saldo_pendiente)))
      setFecha(hoyIso())
      setComprobante('')
      setNota('')
      setCuentaOrigen('')
      setFormaPago('transferencia')
    }
  }, [abierto, cuenta])

  const montoNum = Number(monto) || 0

  const cuentaSel = useMemo(
    () => (cuentas ?? []).find((c) => String(c.id) === cuentaOrigen) ?? null,
    [cuentas, cuentaOrigen]
  )

  // El Select de base-ui necesita `items` (value → label) para que el trigger
  // muestre el nombre de la cuenta y no el id crudo.
  const itemsCuenta = useMemo(() => {
    const r: Record<string, string> = {}
    for (const c of cuentas ?? []) r[String(c.id)] = c.nombre
    return r
  }, [cuentas])

  function elegirCuenta(v: string | null) {
    const id = v ?? ''
    setCuentaOrigen(id)
    // Sugerir la forma de pago según el tipo de cuenta (se puede cambiar).
    const c = (cuentas ?? []).find((x) => String(x.id) === id)
    if (c) setFormaPago(c.tipo === 'caja' ? 'efectivo' : 'transferencia')
  }

  const excedePendiente = montoNum > pendiente + 0.009
  const esParcial = montoNum > 0 && montoNum < pendiente - 0.009
  const saldoResultante =
    cuentaSel != null ? Number(cuentaSel.saldo_actual) - montoNum : null
  const saldoInsuficiente = saldoResultante != null && saldoResultante < -0.009

  const labelComprobante =
    formaPago === 'transferencia'
      ? 'N° de transferencia'
      : formaPago === 'cheque'
        ? 'N° de cheque'
        : formaPago === 'debito'
          ? 'N° de operación'
          : 'N° de comprobante'

  const puedeGuardar =
    !!usuario &&
    !!cuentaSel &&
    montoNum > 0 &&
    !excedePendiente &&
    !pagar.isPending

  function handlePagar() {
    if (!cuenta || !usuario || !cuentaSel || !puedeGuardar) return
    // La forma de pago y el comprobante se guardan dentro de la nota (todavía
    // no hay columnas dedicadas). Quedan visibles en el historial del pago.
    const partes = [FORMA_LABEL[formaPago]]
    if (comprobante.trim()) partes.push(`Comp. ${comprobante.trim()}`)
    if (nota.trim()) partes.push(nota.trim())
    const notaFinal = partes.join(' · ')
    pagar.mutate(
      {
        cuenta_id: cuenta.id,
        usuario_id: usuario.id,
        cuenta_origen_id: cuentaSel.id,
        monto: r2(montoNum),
        fecha,
        nota: notaFinal,
      },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !pagar.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden max-h-[92vh] flex flex-col">
        <DialogHeader className="px-6 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
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
          className="flex flex-1 flex-col min-h-0"
          onSubmit={(e) => {
            e.preventDefault()
            handlePagar()
          }}
        >
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
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

            {/* Forma de pago */}
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Forma de pago
              </Label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                {FORMAS_PAGO.map((f) => (
                  <button
                    key={f.valor}
                    type="button"
                    onClick={() => setFormaPago(f.valor)}
                    className={cn(
                      'rounded-lg border-2 py-2 text-xs font-semibold transition-all',
                      formaPago === f.valor
                        ? 'border-[#f9b44c] bg-[#f9b44c]/15 text-[#391511]'
                        : 'border-[#e4c9b0] bg-white text-[#6f3a2a] hover:border-[#c8a58a]'
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Cuenta de origen */}
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Pagar desde
              </Label>
              <Select
                items={itemsCuenta}
                value={cuentaOrigen}
                onValueChange={elegirCuenta}
              >
                <SelectTrigger className="w-full border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
                  <SelectValue placeholder="Elegí la cuenta…" />
                </SelectTrigger>
                <SelectContent>
                  {(cuentas ?? []).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.nombre} · saldo {fmtSaldo(Number(c.saldo_actual))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {cuentaSel && saldoResultante != null && (
                <p
                  className={cn(
                    'text-[11px] flex items-center gap-1',
                    saldoInsuficiente ? 'text-[#c43e2c]' : 'text-[#6f3a2a]'
                  )}
                >
                  {saldoInsuficiente && <AlertTriangle className="h-3 w-3" />}
                  Saldo de {cuentaSel.nombre} después:{' '}
                  <span className="font-semibold tabular-nums">
                    <MontoARS monto={saldoResultante} />
                  </span>
                  {saldoInsuficiente && ' (queda en negativo)'}
                </p>
              )}
            </div>

            {/* Monto y fecha */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  Monto a pagar
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c8a58a] text-sm">
                    $
                  </span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    autoFocus
                    value={monto}
                    onChange={(e) => setMonto(e.target.value)}
                    className="pl-7 h-11 text-lg font-semibold tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                  />
                </div>
                {excedePendiente && (
                  <p className="text-[11px] text-[#c43e2c]">
                    No puede superar el pendiente.
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
                  className="h-11 tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
            </div>

            {/* Comprobante */}
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                {labelComprobante}{' '}
                <span className="normal-case text-[#c8a58a] font-normal">
                  (opcional)
                </span>
              </Label>
              <Input
                value={comprobante}
                onChange={(e) => setComprobante(e.target.value)}
                placeholder="N° de la operación, cheque o recibo"
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>

            {/* Nota */}
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Nota{' '}
                <span className="normal-case text-[#c8a58a] font-normal">
                  (opcional)
                </span>
              </Label>
              <Input
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Cualquier observación"
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 shrink-0 space-y-2.5">
            {cuentaSel && montoNum > 0 && !excedePendiente && (
              <p className="text-xs text-[#6f3a2a] text-center">
                Pagás{' '}
                <span className="font-bold text-[#391511]">
                  <MontoARS monto={montoNum} />
                </span>{' '}
                en {FORMA_LABEL[formaPago].toLowerCase()} desde{' '}
                <span className="font-bold text-[#391511]">
                  {cuentaSel.nombre}
                </span>
                {esParcial ? (
                  <>
                    {' '}
                    · quedan{' '}
                    <span className="font-bold text-[#c43e2c]">
                      <MontoARS monto={pendiente - montoNum} />
                    </span>{' '}
                    pendientes
                  </>
                ) : (
                  ' · cancela la deuda'
                )}
              </p>
            )}
            <div className="flex gap-2">
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
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
