'use client'

import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  CalendarClock,
  Landmark,
  Receipt,
  ShieldCheck,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import { useConfigFiscal, useResumenFiscal } from '@/lib/hooks/useFiscal'
import { cn } from '@/lib/utils'

function mesActual(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Fecha de vencimiento (mes siguiente al período) en ISO local. */
function vencimientoIso(mesPeriodo: string, dia: number): string {
  const [anio, m] = mesPeriodo.split('-').map(Number)
  const sigAnio = m === 12 ? anio + 1 : anio
  const sigMes = m === 12 ? 1 : m + 1
  const diaClamp = Math.min(Math.max(dia, 1), 28)
  return `${sigAnio}-${String(sigMes).padStart(2, '0')}-${String(diaClamp).padStart(2, '0')}`
}

function diasHasta(iso: string): number {
  const [a, m, d] = iso.split('-').map(Number)
  const objetivo = new Date(a, m - 1, d)
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  return Math.round((objetivo.getTime() - hoy.getTime()) / 86_400_000)
}

function formatoFechaCorta(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
}

interface Vencimiento {
  etiqueta: string
  iso: string
  monto: number
}

export function TabImpuestos() {
  const [mes, setMes] = useState(mesActual())
  const { data: cfg } = useConfigFiscal()

  const { desde, hastaExcl } = useMemo(() => {
    const [anio, m] = mes.split('-').map(Number)
    const sig =
      m === 12 ? `${anio + 1}-01` : `${anio}-${String(m + 1).padStart(2, '0')}`
    return { desde: `${mes}-01`, hastaExcl: `${sig}-01` }
  }, [mes])

  const alicuotaIibb = cfg?.iibb_alicuota ?? 3
  const jurisdiccion = cfg?.iibb_jurisdiccion ?? 'La Rioja'
  const alicuotaIva = cfg?.iva_alicuota_general ?? 21

  const { data, isLoading } = useResumenFiscal(
    desde,
    hastaExcl,
    alicuotaIibb,
    jurisdiccion,
    alicuotaIva
  )

  const ivaPosicion = data?.iva.posicion ?? 0
  const ivaAPagar = ivaPosicion > 0.009
  const ivaAFavor = ivaPosicion < -0.009

  const vencimientos: Vencimiento[] = useMemo(() => {
    if (!data) return []
    const lista: Vencimiento[] = []
    if (ivaAPagar) {
      lista.push({
        etiqueta: 'IVA',
        iso: vencimientoIso(mes, cfg?.iva_dia_vencimiento ?? 18),
        monto: Math.abs(ivaPosicion),
      })
    }
    if (data.iibb.a_pagar > 0.009) {
      lista.push({
        etiqueta: `IIBB ${jurisdiccion}`,
        iso: vencimientoIso(mes, cfg?.iibb_dia_vencimiento ?? 22),
        monto: data.iibb.a_pagar,
      })
    }
    return lista.sort((a, b) => a.iso.localeCompare(b.iso))
  }, [data, mes, cfg, ivaAPagar, ivaPosicion, jurisdiccion])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[#391511] font-bold">Impuestos del período</h2>
          <p className="text-[#6f3a2a] text-sm">
            IVA, Ingresos Brutos {jurisdiccion} y retenciones soportadas.
          </p>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
            Período
          </Label>
          <Input
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value || mesActual())}
            className="w-[170px] border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
          />
        </div>
      </div>

      {isLoading || !data ? (
        <div className="space-y-3">
          <Skeleton className="h-20 rounded-2xl bg-[#f9d2a2]/30" />
          <Skeleton className="h-28 rounded-2xl bg-[#f9d2a2]/30" />
          <Skeleton className="h-40 rounded-2xl bg-[#f9d2a2]/30" />
        </div>
      ) : (
        <>
          {/* Próximos vencimientos */}
          <div className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-4">
            <div className="flex items-center gap-2 mb-3">
              <CalendarClock className="h-4 w-4 text-[#f9b44c]" />
              <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Vencimientos de este período
              </span>
            </div>
            {vencimientos.length === 0 ? (
              <p className="text-sm text-[#6f3a2a]">
                Sin obligaciones a pagar en el período (o saldo a favor).
              </p>
            ) : (
              <div className="space-y-2">
                {vencimientos.map((v) => {
                  const dias = diasHasta(v.iso)
                  const tono =
                    dias < 3
                      ? { dot: '#c43e2c', bg: 'bg-[#c43e2c]/8' }
                      : dias <= 7
                        ? { dot: '#f9b44c', bg: 'bg-[#f9b44c]/10' }
                        : { dot: '#2f8f4e', bg: 'bg-[#2f8f4e]/8' }
                  return (
                    <div
                      key={v.etiqueta}
                      className={cn(
                        'flex items-center justify-between gap-3 rounded-xl px-3 py-2',
                        tono.bg
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: tono.dot }}
                        />
                        <span className="font-semibold text-[#391511] text-sm">
                          {v.etiqueta}
                        </span>
                        <span className="text-xs text-[#6f3a2a] tabular-nums">
                          vence {formatoFechaCorta(v.iso)}
                        </span>
                        <span className="text-[11px] text-[#6f3a2a]">
                          {dias < 0
                            ? `vencido hace ${Math.abs(dias)} día(s)`
                            : dias === 0
                              ? 'vence hoy'
                              : `en ${dias} día(s)`}
                        </span>
                      </div>
                      <span className="font-bold text-[#391511] tabular-nums">
                        <MontoARS monto={v.monto} />
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* 3 cards resumen */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <CardImpuesto
              icono={Receipt}
              titulo="IVA"
              monto={Math.abs(ivaPosicion)}
              leyenda={
                ivaAPagar
                  ? 'A pagar'
                  : ivaAFavor
                    ? 'Saldo a favor'
                    : 'Sin saldo'
              }
              tono={ivaAPagar ? 'rojo' : ivaAFavor ? 'verde' : 'neutro'}
            />
            <CardImpuesto
              icono={Landmark}
              titulo={`IIBB ${jurisdiccion}`}
              monto={data.iibb.a_pagar}
              leyenda={`Determinado ${alicuotaIibb}% − retenciones`}
              tono={data.iibb.a_pagar > 0.009 ? 'rojo' : 'verde'}
            />
            <CardImpuesto
              icono={ShieldCheck}
              titulo="Retenciones sufridas"
              monto={data.retenciones_totales}
              leyenda="IIBB retenido por MP / bancos"
              tono="neutro"
            />
          </div>

          {/* Detalle IVA */}
          <div className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-5 space-y-3">
            <h3 className="text-[#391511] font-bold text-sm">
              Detalle de IVA
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FilaDetalle
                icono={ArrowUpCircle}
                color="#2f8f4e"
                label="IVA Débito (ventas)"
                sub={
                  <>
                    Ventas netas: <MontoARS monto={data.iva.ventas_neto} />
                  </>
                }
                monto={data.iva.iva_debito}
              />
              <FilaDetalle
                icono={ArrowDownCircle}
                color="#c43e2c"
                label="IVA Crédito (compras)"
                sub={
                  <>
                    Compras netas: <MontoARS monto={data.iva.compras_neto} />
                  </>
                }
                monto={data.iva.iva_credito}
              />
            </div>
            <div
              className={cn(
                'rounded-xl border-2 p-3 flex items-center justify-between',
                ivaAPagar
                  ? 'border-[#c43e2c]/40 bg-[#c43e2c]/8'
                  : ivaAFavor
                    ? 'border-[#2f8f4e]/40 bg-[#2f8f4e]/8'
                    : 'border-[#f9b44c]/40 bg-[#f9b44c]/10'
              )}
            >
              <span className="text-sm font-semibold text-[#391511]">
                {ivaAPagar
                  ? 'IVA a pagar'
                  : ivaAFavor
                    ? 'Saldo a favor próximo período'
                    : 'IVA compensado'}
              </span>
              <span
                className={cn(
                  'text-xl font-extrabold tabular-nums',
                  ivaAPagar
                    ? 'text-[#c43e2c]'
                    : ivaAFavor
                      ? 'text-[#2f8f4e]'
                      : 'text-[#391511]'
                )}
              >
                <MontoARS monto={Math.abs(ivaPosicion)} />
              </span>
            </div>
          </div>

          {/* Detalle IIBB */}
          <div className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-5 space-y-3">
            <h3 className="text-[#391511] font-bold text-sm">
              Detalle de Ingresos Brutos — {jurisdiccion}
            </h3>
            <div className="space-y-1.5 text-sm">
              <FilaIibb label="Base imponible (ventas netas)" monto={data.iibb.base} />
              <FilaIibb
                label={`Determinado (${alicuotaIibb}%)`}
                monto={data.iibb.determinado}
              />
              <FilaIibb
                label="(−) Retenciones sufridas"
                monto={-data.iibb.retenciones_sufridas}
              />
              <div className="h-px bg-[#e4c9b0]/60 my-1.5" />
              {data.iibb.saldo_favor > 0.009 ? (
                <div className="flex items-center justify-between font-bold">
                  <span className="text-[#2f8f4e]">Saldo a favor</span>
                  <span className="text-[#2f8f4e] tabular-nums text-lg">
                    <MontoARS monto={data.iibb.saldo_favor} />
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-between font-bold">
                  <span className="text-[#391511]">IIBB a pagar</span>
                  <span className="text-[#c43e2c] tabular-nums text-lg">
                    <MontoARS monto={data.iibb.a_pagar} />
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-start gap-2 text-[11px] text-[#c8a58a]">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <p>
              Estimación orientativa. El IVA débito asume precios de venta con{' '}
              {alicuotaIva}% incluido; el IIBB usa la alícuota configurada en
              Configuración → Datos fiscales. Validá la liquidación final con tu
              contador.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function CardImpuesto({
  icono: Icono,
  titulo,
  monto,
  leyenda,
  tono,
}: {
  icono: React.ElementType
  titulo: string
  monto: number
  leyenda: string
  tono: 'rojo' | 'verde' | 'neutro'
}) {
  const color =
    tono === 'rojo' ? '#c43e2c' : tono === 'verde' ? '#2f8f4e' : '#6f3a2a'
  const bg =
    tono === 'rojo'
      ? 'bg-[#c43e2c]/8'
      : tono === 'verde'
        ? 'bg-[#2f8f4e]/8'
        : 'bg-white'
  return (
    <div className={cn('rounded-2xl border-2 border-[#e4c9b0]/60 p-4', bg)}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
          {titulo}
        </span>
        <div className="p-1.5 rounded-lg" style={{ backgroundColor: `${color}22` }}>
          <Icono className="h-3.5 w-3.5" style={{ color }} />
        </div>
      </div>
      <div
        className="text-2xl font-extrabold tabular-nums"
        style={{ color: tono === 'neutro' ? '#391511' : color }}
      >
        <MontoARS monto={monto} />
      </div>
      <div className="text-[10px] text-[#6f3a2a] mt-1">{leyenda}</div>
    </div>
  )
}

function FilaDetalle({
  icono: Icono,
  color,
  label,
  sub,
  monto,
}: {
  icono: React.ElementType
  color: string
  label: string
  sub: React.ReactNode
  monto: number
}) {
  return (
    <div className="rounded-xl border border-[#e4c9b0]/60 bg-[#fdfaf6] p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icono className="h-4 w-4" style={{ color }} />
        <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
          {label}
        </span>
      </div>
      <div className="text-xl font-extrabold text-[#391511] tabular-nums">
        <MontoARS monto={monto} />
      </div>
      <div className="text-xs text-[#6f3a2a] mt-0.5">{sub}</div>
    </div>
  )
}

function FilaIibb({ label, monto }: { label: string; monto: number }) {
  return (
    <div className="flex items-center justify-between text-[#6f3a2a]">
      <span>{label}</span>
      <span className="tabular-nums font-medium text-[#391511]">
        <MontoARS monto={monto} />
      </span>
    </div>
  )
}
