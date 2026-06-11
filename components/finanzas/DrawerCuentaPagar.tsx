'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  CalendarClock,
  ExternalLink,
  FileText,
  Loader2,
  Receipt,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AyudaContextual } from '@/components/shared/AyudaContextual'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import { BadgeEstadoCuenta } from '@/components/shared/BadgeEstadoCuenta'
import { formatearFechaCorta } from '@/lib/utils/formato'
import {
  usePagosCuenta,
  useEditarCuentaAPagar,
} from '@/lib/hooks/useFinanzas'
import type { CuentaAPagarConProveedor } from '@/lib/queries/finanzas'

interface Props {
  cuenta: CuentaAPagarConProveedor | null
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Pide al padre abrir el modal de pago para esta cuenta. */
  onPagar: (cuenta: CuentaAPagarConProveedor) => void
}

export function DrawerCuentaPagar({
  cuenta,
  abierto,
  onCambioAbierto,
  onPagar,
}: Props) {
  const editar = useEditarCuentaAPagar()
  const { data: pagos, isLoading: cargandoPagos } = usePagosCuenta(
    abierto ? (cuenta?.id ?? null) : null
  )

  const [vencimiento, setVencimiento] = useState('')
  const [monto, setMonto] = useState('')
  const [nota, setNota] = useState('')

  useEffect(() => {
    if (abierto && cuenta) {
      setVencimiento(cuenta.fecha_vencimiento)
      setMonto(String(cuenta.monto))
      setNota(cuenta.nota ?? '')
    }
  }, [abierto, cuenta])

  if (!cuenta) return null

  const pagada = cuenta.estado === 'pagada'
  const montoCambia = !cuenta.tiene_factura && Number(monto) !== cuenta.monto
  const hayCambios =
    vencimiento !== cuenta.fecha_vencimiento ||
    (nota ?? '') !== (cuenta.nota ?? '') ||
    montoCambia

  function handleGuardar() {
    if (!cuenta || editar.isPending || !hayCambios) return
    editar.mutate({
      cuenta_id: cuenta.id,
      fecha_vencimiento: vencimiento,
      nota: nota.trim() === '' ? null : nota.trim(),
      ...(!cuenta.tiene_factura ? { monto: Number(monto) || 0 } : {}),
    })
  }

  return (
    <Sheet open={abierto} onOpenChange={onCambioAbierto}>
      <SheetContent className="sm:max-w-md overflow-y-auto p-0">
        <SheetHeader className="px-5 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <SheetTitle className="text-[#391511] flex items-center justify-between gap-2">
            <span>{cuenta.proveedor_nombre ?? 'Proveedor'}</span>
            <BadgeEstadoCuenta estado={cuenta.estado} />
          </SheetTitle>
          <SheetDescription className="text-[#6f3a2a]">
            <Link
              href={`/pedidos/${cuenta.pedido_id}`}
              className="inline-flex items-center gap-1 text-[#c43e2c] hover:underline font-mono text-xs"
            >
              Pedido #{cuenta.pedido_id}
              <ExternalLink className="h-3 w-3" />
            </Link>
          </SheetDescription>
        </SheetHeader>

        <div className="px-5 py-4 space-y-5">
          {/* Saldos */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <Saldo etiqueta="Total" monto={cuenta.monto} color="#391511" />
            <Saldo
              etiqueta="Pagado"
              monto={cuenta.monto_pagado}
              color="#2f8f4e"
            />
            <Saldo
              etiqueta="Pendiente"
              monto={cuenta.saldo_pendiente}
              color="#c43e2c"
            />
          </div>

          {/* Factura asociada */}
          <div className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-[#6f3a2a]" />
            {cuenta.tiene_factura ? (
              <span className="text-[#2f8f4e] font-medium">
                Factura cargada
              </span>
            ) : (
              <span className="text-[#c43e2c] inline-flex items-center gap-1">
                Sin factura todavía
                {cuenta.provisoria && (
                  <>
                    {' '}
                    (monto estimado)
                    <AyudaContextual titulo="Deuda sin factura">
                      Esta deuda se registró al recibir la mercadería sin la
                      factura. El monto es estimado; cuando cargues el
                      comprobante real, se ajusta al valor exacto.
                    </AyudaContextual>
                  </>
                )}
              </span>
            )}
          </div>

          {/* Edición */}
          <div className="space-y-3 rounded-xl border border-[#e4c9b0]/60 p-3">
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Editar
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-[#6f3a2a] flex items-center gap-1">
                <CalendarClock className="h-3 w-3" /> Vencimiento (plazo)
              </Label>
              <Input
                type="date"
                value={vencimiento}
                onChange={(e) => setVencimiento(e.target.value)}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-[#6f3a2a]">Monto</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={monto}
                disabled={cuenta.tiene_factura}
                onChange={(e) => setMonto(e.target.value)}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums disabled:opacity-60"
              />
              {cuenta.tiene_factura && (
                <p className="text-[10px] text-[#c8a58a]">
                  Tiene factura — el monto se edita en Comprobantes.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-[#6f3a2a]">Nota</Label>
              <Input
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Referencia, recordatorio…"
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>
            <Button
              onClick={handleGuardar}
              disabled={!hayCambios || editar.isPending}
              variant="outline"
              className="w-full border-[#e4c9b0] text-[#6f3a2a] disabled:opacity-50"
            >
              {editar.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando…
                </>
              ) : (
                'Guardar cambios'
              )}
            </Button>
          </div>

          {/* Historial de pagos */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-[#6f3a2a]" />
              <h3 className="text-sm font-semibold text-[#391511]">
                Historial de pagos
              </h3>
            </div>
            {cargandoPagos ? (
              <Skeleton className="h-16 rounded-xl bg-[#f9d2a2]/30" />
            ) : (pagos ?? []).length === 0 ? (
              <p className="text-xs text-[#6f3a2a]">
                Todavía no se registraron pagos.
              </p>
            ) : (
              <div className="space-y-1.5">
                {(pagos ?? []).map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-[#e4c9b0]/40 bg-[#fdfaf6] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-[#391511] text-sm tabular-nums">
                        <MontoARS monto={p.monto} />
                      </div>
                      <div className="text-[11px] text-[#6f3a2a] truncate">
                        {formatearFechaCorta(p.fecha)} ·{' '}
                        {p.cuenta_origen_nombre ?? 'cuenta'}
                        {p.nota ? ` · ${p.nota}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Acción de pago */}
          {!pagada && (
            <Button
              onClick={() => onPagar(cuenta)}
              className="w-full bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold"
            >
              <Wallet className="mr-2 h-4 w-4" />
              Registrar pago · pendiente{' '}
              <MontoARS monto={cuenta.saldo_pendiente} />
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Saldo({
  etiqueta,
  monto,
  color,
}: {
  etiqueta: string
  monto: number
  color: string
}) {
  return (
    <div className="rounded-xl border border-[#e4c9b0]/60 bg-white p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
        {etiqueta}
      </div>
      <div
        className="font-extrabold tabular-nums text-sm mt-0.5"
        style={{ color }}
      >
        <MontoARS monto={monto} />
      </div>
    </div>
  )
}
