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
import {
  FORMAS_PAGO,
  FORMA_PAGO_LABEL,
  labelComprobante as labelComprobantePorForma,
  requiereComprobante,
  type FormaPago,
  type CuentaAPagarConProveedor,
} from '@/lib/queries/finanzas'
import { hoyIso } from '@/lib/utils/periodos'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  cuenta: CuentaAPagarConProveedor | null
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

  // Al abrir, precargar y resetear. Con plan de cuotas (mig 148) el monto
  // precargado es lo que falta de la PRÓXIMA cuota; sin plan, todo el saldo.
  // Deps por id: la cuenta llega "viva" desde la tab (se re-resuelve en cada
  // render) y un refetch de fondo no debe pisar lo tipeado.
  useEffect(() => {
    if (abierto && cuenta) {
      const prox = cuenta.proxima_cuota
      setMonto(
        String(r2(prox ? prox.monto - prox.pagado : cuenta.saldo_pendiente))
      )
      setFecha(hoyIso())
      setComprobante('')
      setNota('')
      setCuentaOrigen('')
      setFormaPago('transferencia')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, cuenta?.id])

  const montoNum = Number(monto) || 0

  // Plan de cuotas (mig 148): accesos rápidos y explicación de cobertura.
  const cuotasPlan = cuenta?.cuotas ?? []
  const proximaCuota = cuenta?.proxima_cuota ?? null
  const restoProxima = proximaCuota
    ? r2(proximaCuota.monto - proximaCuota.pagado)
    : 0
  // Hasta qué cuota llega el monto tipeado (FIFO client-side, espejo del
  // reparto del server).
  const coberturaCuotas = useMemo(() => {
    if (!proximaCuota || montoNum <= 0) return null
    let resto = montoNum
    let ultima: number | null = null
    let completas = 0
    for (const q of cuotasPlan) {
      const falta = r2(q.monto - q.pagado)
      if (falta <= 0.009) continue
      if (resto >= falta - 0.009) {
        resto = r2(resto - falta)
        ultima = q.numero
        completas += 1
      } else {
        break
      }
    }
    const impagas = cuotasPlan.filter(
      (q) => q.monto - q.pagado > 0.009
    ).length
    return { ultima, quedan: impagas - completas }
  }, [cuotasPlan, proximaCuota, montoNum])

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

  // Sobrepago permitido (mig 144): lo que excede el pendiente se registra como
  // diferencia por redondeo (5.2.10) y la deuda queda pagada. Solo se avisa.
  const sobrante = montoNum > pendiente + 0.009 ? r2(montoNum - pendiente) : 0
  const umbralSobrante = Math.max(1000, r2(pendiente * 0.01))
  const sobranteGrande = sobrante > umbralSobrante
  const esParcial = montoNum > 0 && montoNum < pendiente - 0.009
  const saldoResultante =
    cuentaSel != null ? Number(cuentaSel.saldo_actual) - montoNum : null
  const saldoInsuficiente = saldoResultante != null && saldoResultante < -0.009
  // La caja fuerte no puede quedar en negativo: el server lo rechaza
  // (fn_pagar_cuenta v3), así que se bloquea acá igual que en ModalEditarFactura.
  const bovedaNegativa =
    saldoInsuficiente && (cuentaSel?.es_caja_fuerte ?? false)

  const labelComprobante = labelComprobantePorForma(formaPago)
  // N° de comprobante OBLIGATORIO con transferencia / cheque / débito (mig
  // 155); efectivo y "otro" no tienen número que cargar.
  const comprobanteFaltante =
    requiereComprobante(formaPago) && comprobante.trim() === ''
  // Un pago registrado acá sale HOY (o atrasado): una fecha futura es un
  // programado, que se carga desde la factura.
  const fechaFutura = !fecha || fecha > hoyIso()

  const puedeGuardar =
    !!usuario &&
    !!cuentaSel &&
    montoNum > 0 &&
    !bovedaNegativa &&
    !comprobanteFaltante &&
    !fechaFutura &&
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
        nota: nota.trim() || null,
        forma_pago: formaPago,
        comprobante: comprobante.trim() || null,
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
            {cuenta?.proveedor_nombre ?? 'Proveedor'}
            {cuenta?.pedido_id != null
              ? ` · pedido #${cuenta.pedido_id}`
              : ' · compra directa'}
            {proximaCuota
              ? ` · cuota ${proximaCuota.numero}/${cuotasPlan.length}`
              : ''}
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
                  {bovedaNegativa
                    ? ' — la caja fuerte no puede quedar en negativo.'
                    : saldoInsuficiente
                      ? ' (queda en negativo)'
                      : null}
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
                {proximaCuota && restoProxima > 0.009 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setMonto(String(restoProxima))}
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors',
                        Math.abs(montoNum - restoProxima) <= 0.009
                          ? 'border-[#f9b44c] bg-[#f9b44c]/15 text-[#391511]'
                          : 'border-[#e4c9b0] bg-white text-[#6f3a2a] hover:border-[#f9b44c]'
                      )}
                    >
                      Esta cuota (<MontoARS monto={restoProxima} />)
                    </button>
                    <button
                      type="button"
                      onClick={() => setMonto(String(r2(pendiente)))}
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors',
                        Math.abs(montoNum - r2(pendiente)) <= 0.009
                          ? 'border-[#f9b44c] bg-[#f9b44c]/15 text-[#391511]'
                          : 'border-[#e4c9b0] bg-white text-[#6f3a2a] hover:border-[#f9b44c]'
                      )}
                    >
                      Todo el saldo (<MontoARS monto={pendiente} />)
                    </button>
                  </div>
                )}
                {sobrante > 0 && !sobranteGrande && (
                  <p className="text-[11px] text-[#b3821b]">
                    Pagás <MontoARS monto={sobrante} /> de más: se registra
                    como diferencia por redondeo y la deuda queda pagada.
                  </p>
                )}
                {sobranteGrande && (
                  <p className="text-[11px] text-[#c43e2c] flex items-start gap-1">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>
                      Estás pagando <MontoARS monto={sobrante} /> por encima
                      del pendiente. ¿Es correcto? Se registra como diferencia
                      por redondeo.
                    </span>
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
                  className={cn(
                    'h-11 tabular-nums focus-visible:ring-[#f9b44c]',
                    fechaFutura ? 'border-[#c43e2c]' : 'border-[#e4c9b0]'
                  )}
                />
                {fechaFutura && (
                  <p className="text-[11px] text-[#c43e2c]">
                    {fecha
                      ? 'No puede ser futura: para pagar más adelante, programalo desde la carga de la factura.'
                      : 'Poné la fecha del pago.'}
                  </p>
                )}
              </div>
            </div>

            {/* Comprobante (obligatorio según la forma, mig 155) */}
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                {labelComprobante}{' '}
                {requiereComprobante(formaPago) ? (
                  <span className="text-[#c43e2c]">*</span>
                ) : (
                  <span className="normal-case text-[#c8a58a] font-normal">
                    (opcional)
                  </span>
                )}
              </Label>
              <Input
                value={comprobante}
                onChange={(e) => setComprobante(e.target.value)}
                placeholder={
                  requiereComprobante(formaPago)
                    ? `${labelComprobante} (obligatorio)`
                    : 'N° de la operación, cheque o recibo'
                }
                className={cn(
                  'focus-visible:ring-[#f9b44c]',
                  comprobanteFaltante ? 'border-[#f9b44c]' : 'border-[#e4c9b0]'
                )}
              />
              {comprobanteFaltante && (
                <p className="text-[11px] text-[#b3821b]">
                  Poné el {labelComprobante} para poder registrar el pago.
                </p>
              )}
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
            {cuentaSel && montoNum > 0 && (
              <p className="text-xs text-[#6f3a2a] text-center">
                Pagás{' '}
                <span className="font-bold text-[#391511]">
                  <MontoARS monto={montoNum} />
                </span>{' '}
                en {FORMA_PAGO_LABEL[formaPago].toLowerCase()} desde{' '}
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
                    {coberturaCuotas &&
                      (coberturaCuotas.ultima != null ? (
                        <>
                          {' '}
                          · cubre hasta la cuota {coberturaCuotas.ultima}/
                          {cuotasPlan.length} (quedan {coberturaCuotas.quedan})
                        </>
                      ) : proximaCuota ? (
                        <>
                          {' '}
                          · pago parcial de la cuota {proximaCuota.numero}/
                          {cuotasPlan.length}
                        </>
                      ) : null)}
                  </>
                ) : sobrante > 0 ? (
                  <>
                    {' '}
                    · cancela la deuda ·{' '}
                    <span
                      className={cn(
                        'font-bold',
                        sobranteGrande ? 'text-[#c43e2c]' : 'text-[#b3821b]'
                      )}
                    >
                      <MontoARS monto={sobrante} />
                    </span>{' '}
                    de más → diferencia por redondeo
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
