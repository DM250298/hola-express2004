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
import { ModalCuotasCuenta } from '@/components/finanzas/ModalCuotasCuenta'
import { formatearFechaCorta } from '@/lib/utils/formato'
import {
  usePagosCuenta,
  usePagosProgramados,
  useEditarCuentaAPagar,
} from '@/lib/hooks/useFinanzas'
import {
  FORMA_PAGO_LABEL,
  esFormaPago,
  type CuentaAPagarConProveedor,
  type CuotaConEstado,
} from '@/lib/queries/finanzas'

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
  // Pagos agendados a futuro para ESTA deuda (mig 146): informativos acá,
  // se ejecutan/cancelan desde la sección de la tab.
  const { data: programados } = usePagosProgramados()
  const programadosCuenta = (programados ?? []).filter(
    (p) => p.cuenta_a_pagar_id === (cuenta?.id ?? -1)
  )

  const [vencimiento, setVencimiento] = useState('')
  const [monto, setMonto] = useState('')
  const [nota, setNota] = useState('')
  // Modal de plan de cuotas (mig 148), montado por este drawer.
  const [modalCuotas, setModalCuotas] = useState(false)

  // Deps por id: la cuenta llega "viva" desde la tab (se re-resuelve en cada
  // render) y un refetch de fondo no debe pisar lo tipeado en los inputs.
  useEffect(() => {
    if (abierto && cuenta) {
      setVencimiento(cuenta.fecha_vencimiento)
      setMonto(String(cuenta.monto))
      setNota(cuenta.nota ?? '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, cuenta?.id])

  if (!cuenta) return null

  const pagada = cuenta.estado === 'pagada'
  // Con plan de cuotas, vencimiento y monto NO se editan directo: el
  // vencimiento del padre lo fija la próxima cuota impaga, y el monto debe
  // cuadrar con Σ cuotas (editarCuentaAPagar lo bloquea server-side también).
  const tienePlan = cuenta.cuotas.length > 0
  const montoCambia =
    !cuenta.tiene_factura && !tienePlan && Number(monto) !== cuenta.monto
  const vencCambia = !tienePlan && vencimiento !== cuenta.fecha_vencimiento
  const hayCambios =
    vencCambia || (nota ?? '') !== (cuenta.nota ?? '') || montoCambia

  function handleGuardar() {
    if (!cuenta || editar.isPending || !hayCambios) return
    editar.mutate({
      cuenta_id: cuenta.id,
      ...(vencCambia ? { fecha_vencimiento: vencimiento } : {}),
      nota: nota.trim() === '' ? null : nota.trim(),
      ...(!cuenta.tiene_factura && !tienePlan
        ? { monto: Number(monto) || 0 }
        : {}),
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
            {cuenta.pedido_id != null ? (
              <Link
                href={`/pedidos/${cuenta.pedido_id}`}
                className="inline-flex items-center gap-1 text-[#c43e2c] hover:underline font-mono text-xs"
              >
                Pedido #{cuenta.pedido_id}
                <ExternalLink className="h-3 w-3" />
              </Link>
            ) : (
              <span className="font-mono text-xs">
                Compra directa · sin orden
              </span>
            )}
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
                disabled={tienePlan}
                onChange={(e) => setVencimiento(e.target.value)}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums disabled:opacity-60"
              />
              {tienePlan && (
                <p className="text-[10px] text-[#c8a58a]">
                  Lo fija la próxima cuota del plan (abajo).
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-[#6f3a2a]">Monto</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={monto}
                disabled={cuenta.tiene_factura || tienePlan}
                onChange={(e) => setMonto(e.target.value)}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums disabled:opacity-60"
              />
              {cuenta.tiene_factura ? (
                <p className="text-[10px] text-[#c8a58a]">
                  Tiene factura — el monto se edita en Comprobantes.
                </p>
              ) : tienePlan ? (
                <p className="text-[10px] text-[#c8a58a]">
                  Tiene plan de cuotas — editá el plan para cambiarlo.
                </p>
              ) : null}
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

          {/* Plan de cuotas (mig 148) */}
          <div className="space-y-2 rounded-xl border border-[#e4c9b0]/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Plan de cuotas
              </div>
              {!pagada && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setModalCuotas(true)}
                  className="h-7 border-[#e4c9b0] px-2 text-[11px] text-[#6f3a2a] hover:text-[#391511]"
                >
                  <CalendarClock className="mr-1 h-3 w-3" />
                  {tienePlan ? 'Editar plan' : 'Dividir en cuotas'}
                </Button>
              )}
            </div>
            {tienePlan ? (
              <div className="space-y-1">
                {cuenta.cuotas.map((q) => (
                  <div
                    key={q.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-[#e4c9b0]/40 bg-[#fdfaf6] px-2.5 py-1.5 text-xs"
                  >
                    <span className="text-[#6f3a2a]">
                      Cuota {q.numero}/{cuenta.cuotas.length} ·{' '}
                      {formatearFechaCorta(q.fecha_vencimiento)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="font-semibold tabular-nums text-[#391511]">
                        <MontoARS monto={q.monto} />
                      </span>
                      <ChipEstadoCuota cuota={q} />
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#6f3a2a]">
                Vencimiento único. Podés dividir el saldo pendiente en cuotas
                con distintas fechas de pago.
              </p>
            )}
          </div>

          {/* Historial de pagos */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-[#6f3a2a]" />
              <h3 className="text-sm font-semibold text-[#391511]">
                Historial de pagos
              </h3>
            </div>
            {programadosCuenta.length > 0 && (
              <div className="space-y-1.5">
                {programadosCuenta.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-[#f9b44c]/70 bg-[#f9b44c]/5 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-[#391511] text-sm tabular-nums">
                          <MontoARS monto={p.monto} />
                        </span>
                        <span className="rounded-full bg-[#f9b44c]/20 border border-[#f9b44c]/60 px-1.5 py-px text-[10px] font-semibold text-[#9e6b15]">
                          Programado {formatearFechaCorta(p.fecha_programada)}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#6f3a2a] truncate">
                        {p.cuenta_origen_nombre ?? 'cuenta'}
                        {esFormaPago(p.forma_pago)
                          ? ` · ${FORMA_PAGO_LABEL[p.forma_pago]}`
                          : ''}{' '}
                        · se ejecuta desde Cuentas a pagar
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {cargandoPagos ? (
              <Skeleton className="h-16 rounded-xl bg-[#f9d2a2]/30" />
            ) : (pagos ?? []).length === 0 && programadosCuenta.length === 0 ? (
              <p className="text-xs text-[#6f3a2a]">
                Todavía no se registraron pagos.
              </p>
            ) : (pagos ?? []).length === 0 ? null : (
              <div className="space-y-1.5">
                {(pagos ?? []).map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-[#e4c9b0]/40 bg-[#fdfaf6] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-[#391511] text-sm tabular-nums">
                          <MontoARS monto={p.monto} />
                        </span>
                        {/* Forma de pago estructurada (mig 144). Pagos viejos:
                            quedó dentro de la nota, sin chip. */}
                        {esFormaPago(p.forma_pago) && (
                          <span className="rounded-full bg-[#f9b44c]/15 border border-[#f9b44c]/50 px-1.5 py-px text-[10px] font-semibold text-[#9e6b15]">
                            {FORMA_PAGO_LABEL[p.forma_pago]}
                          </span>
                        )}
                        {p.sobrante > 0.009 && (
                          <span className="text-[10px] text-[#b3821b]">
                            (incluye <MontoARS monto={p.sobrante} /> de
                            redondeo)
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#6f3a2a] truncate">
                        {formatearFechaCorta(p.fecha)} ·{' '}
                        {p.cuenta_origen_nombre ?? 'cuenta'}
                        {p.comprobante ? ` · Comp. ${p.comprobante}` : ''}
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

      {/* Editor del plan de cuotas (Dialog, portalea fuera del Sheet). */}
      <ModalCuotasCuenta
        cuenta={cuenta}
        abierto={modalCuotas}
        onCambioAbierto={setModalCuotas}
      />
    </Sheet>
  )
}

function ChipEstadoCuota({ cuota }: { cuota: CuotaConEstado }) {
  if (cuota.estado === 'pagada') {
    return (
      <span className="rounded-full bg-[#2f8f4e]/12 px-1.5 py-px text-[10px] font-semibold text-[#2f8f4e]">
        Pagada
      </span>
    )
  }
  if (cuota.estado === 'vencida') {
    return (
      <span className="rounded-full bg-[#c43e2c]/12 px-1.5 py-px text-[10px] font-semibold text-[#c43e2c]">
        Vencida{cuota.pagado > 0.009 ? ' · parcial' : ''}
      </span>
    )
  }
  if (cuota.estado === 'parcial') {
    return (
      <span className="rounded-full bg-[#f9b44c]/20 px-1.5 py-px text-[10px] font-semibold text-[#9e6b15]">
        Resta <MontoARS monto={cuota.monto - cuota.pagado} />
      </span>
    )
  }
  return (
    <span className="rounded-full bg-[#e4c9b0]/40 px-1.5 py-px text-[10px] font-semibold text-[#6f3a2a]">
      Pendiente
    </span>
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
