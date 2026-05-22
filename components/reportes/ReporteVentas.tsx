'use client'

import {
  Banknote,
  CreditCard,
  Download,
  Receipt,
  ShoppingCart,
  Smartphone,
  Sun,
  Sunset,
  Moon,
  Wallet,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import { formatearMonto } from '@/lib/utils/formato'
import { useReporteVentas } from '@/lib/hooks/useReportes'
import {
  agregarBloqueKPIs,
  agregarTabla,
  crearDocumentoConHeader,
  guardarPDF,
} from '@/lib/utils/pdf'
import { etiquetaMedioFallback } from '@/lib/utils/iconosMedioPago'

interface Props {
  desde: string
  hasta: string
}

const ICONOS_BASE: Record<string, React.ElementType> = {
  efectivo: Banknote,
  debito: CreditCard,
  credito: Wallet,
  transferencia: Smartphone,
}

function confMedio(codigo: string): { etiqueta: string; icono: React.ElementType } {
  return {
    etiqueta: etiquetaMedioFallback(codigo),
    icono: ICONOS_BASE[codigo] ?? Wallet,
  }
}

interface PropsTooltip {
  active?: boolean
  label?: string
  payload?: Array<{ value?: number }>
}

export function ReporteVentas({ desde, hasta }: Props) {
  const { data, isLoading, isError } = useReporteVentas(desde, hasta)

  function exportarPDF() {
    if (!data) return
    const doc = crearDocumentoConHeader({
      titulo: 'Reporte de ventas',
      desde,
      hasta,
      archivo: 'reporte',
    })
    let y = agregarBloqueKPIs(doc, 62, [
      { etiqueta: 'Total', valor: formatearMonto(data.total) },
      { etiqueta: 'Tickets', valor: String(data.cantidad) },
      {
        etiqueta: 'Promedio',
        valor: formatearMonto(data.ticket_promedio),
      },
    ])

    // Por día
    if (data.por_dia.length > 0) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(57, 21, 17)
      doc.text('Ventas por día', 14, y + 4)
      y = agregarTabla(
        doc,
        y + 6,
        ['Fecha', 'Tickets', 'Total'],
        data.por_dia.map((d) => [
          format(parseISO(d.fecha), 'dd/MM/yyyy'),
          d.cantidad,
          formatearMonto(d.total),
        ])
      )
    }

    // Por medio de pago
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('Por medio de pago', 14, y + 8)
    y = agregarTabla(
      doc,
      y + 10,
      ['Medio', 'Tickets', 'Total'],
      Object.keys(data.por_medio_pago).map((m) => [
        confMedio(m).etiqueta,
        data.por_medio_pago[m].cantidad,
        formatearMonto(data.por_medio_pago[m].total),
      ])
    )

    // Por franja
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('Por franja horaria', 14, y + 8)
    agregarTabla(
      doc,
      y + 10,
      ['Franja', 'Horario', 'Tickets', 'Total'],
      [
        [
          'Mañana',
          '06–12',
          data.por_franja.manana.cantidad,
          formatearMonto(data.por_franja.manana.total),
        ],
        [
          'Tarde',
          '12–19',
          data.por_franja.tarde.cantidad,
          formatearMonto(data.por_franja.tarde.total),
        ],
        [
          'Noche',
          '19–06',
          data.por_franja.noche.cantidad,
          formatearMonto(data.por_franja.noche.total),
        ],
      ]
    )

    guardarPDF(doc, `ventas_${desde.slice(0, 10)}_${hasta.slice(0, 10)}`)
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl bg-[#f9d2a2]/30" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-2xl bg-[#f9d2a2]/30" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="p-10 text-center text-[#c43e2c] text-sm">
        No se pudo cargar el reporte.
      </div>
    )
  }

  const sinDatos = data.cantidad === 0

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-[#391511] font-bold text-lg">Ventas del período</h2>
        <Button
          onClick={exportarPDF}
          disabled={sinDatos}
          variant="outline"
          className="border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#fdfaf6] gap-1.5"
        >
          <Download className="h-3.5 w-3.5" />
          Exportar PDF
        </Button>
      </div>

      {sinDatos ? (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-10 text-center">
          <ShoppingCart className="h-6 w-6 text-[#c8a58a] mx-auto mb-2" />
          <p className="text-[#391511] font-semibold">Sin ventas en el período</p>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <CardSimple
              icono={ShoppingCart}
              etiqueta="Ventas totales"
              valor={<MontoARS monto={data.total} />}
              color="#f9b44c"
              destacar
            />
            <CardSimple
              icono={Receipt}
              etiqueta="Tickets"
              valor={String(data.cantidad)}
              color="#6f3a2a"
            />
            <CardSimple
              icono={Banknote}
              etiqueta="Ticket promedio"
              valor={<MontoARS monto={data.ticket_promedio} />}
              color="#6f3a2a"
            />
          </div>

          {/* Gráfico por día */}
          <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 shadow-sm">
            <h3 className="text-[#391511] font-bold mb-3">Ventas por día</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.por_dia}
                  margin={{ top: 5, right: 15, bottom: 5, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#e4c9b0"
                    opacity={0.5}
                  />
                  <XAxis
                    dataKey="fecha"
                    tickFormatter={(v: string) =>
                      format(parseISO(v), 'dd/MM', { locale: es })
                    }
                    stroke="#6f3a2a"
                    tick={{ fontSize: 11 }}
                    axisLine={{ stroke: '#e4c9b0' }}
                    tickLine={{ stroke: '#e4c9b0' }}
                    interval="preserveStartEnd"
                    minTickGap={20}
                  />
                  <YAxis
                    tickFormatter={(v: number) =>
                      v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)
                    }
                    stroke="#6f3a2a"
                    tick={{ fontSize: 11 }}
                    axisLine={{ stroke: '#e4c9b0' }}
                    tickLine={{ stroke: '#e4c9b0' }}
                  />
                  <Tooltip content={<TooltipDia />} />
                  <Bar dataKey="total" fill="#f9b44c" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Medio de pago + franja */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DesgloseCard
              titulo="Por medio de pago"
              total={data.total}
              filas={Object.keys(data.por_medio_pago).map((m) => {
                const conf = confMedio(m)
                return {
                  etiqueta: conf.etiqueta,
                  icono: conf.icono,
                  monto: data.por_medio_pago[m].total,
                  cantidad: data.por_medio_pago[m].cantidad,
                }
              })}
            />
            <DesgloseCard
              titulo="Por franja horaria"
              total={data.total}
              filas={[
                {
                  etiqueta: 'Mañana (6–12)',
                  icono: Sun,
                  monto: data.por_franja.manana.total,
                  cantidad: data.por_franja.manana.cantidad,
                },
                {
                  etiqueta: 'Tarde (12–19)',
                  icono: Sunset,
                  monto: data.por_franja.tarde.total,
                  cantidad: data.por_franja.tarde.cantidad,
                },
                {
                  etiqueta: 'Noche (19–6)',
                  icono: Moon,
                  monto: data.por_franja.noche.total,
                  cantidad: data.por_franja.noche.cantidad,
                },
              ]}
            />
          </div>
        </>
      )}
    </div>
  )
}

function TooltipDia({ active, payload, label }: PropsTooltip) {
  if (!active || !payload || payload.length === 0) return null
  const valor = payload[0]?.value ?? 0
  return (
    <div className="bg-white border border-[#e4c9b0] rounded-lg shadow-md px-3 py-2 text-xs">
      <div className="font-semibold text-[#391511]">
        {label ? format(parseISO(label), "d 'de' MMM", { locale: es }) : ''}
      </div>
      <div className="text-[#391511] font-bold tabular-nums mt-0.5">
        {formatearMonto(valor)}
      </div>
    </div>
  )
}

function CardSimple({
  etiqueta,
  valor,
  icono: Icono,
  color,
  destacar,
}: {
  etiqueta: string
  valor: React.ReactNode
  icono: React.ElementType
  color: string
  destacar?: boolean
}) {
  return (
    <div
      className={`rounded-2xl border-2 p-4 flex flex-col gap-2 bg-white ${
        destacar ? 'border-[#f9b44c]' : 'border-[#e4c9b0]/60'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
          {etiqueta}
        </span>
        <div
          className="p-1.5 rounded-lg"
          style={{ backgroundColor: `${color}22` }}
        >
          <Icono className="h-3.5 w-3.5" style={{ color }} />
        </div>
      </div>
      <div className="font-extrabold text-[#391511] tabular-nums text-2xl">
        {valor}
      </div>
    </div>
  )
}

function DesgloseCard({
  titulo,
  total,
  filas,
}: {
  titulo: string
  total: number
  filas: Array<{
    etiqueta: string
    icono: React.ElementType
    monto: number
    cantidad: number
  }>
}) {
  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 shadow-sm">
      <h3 className="text-[#391511] font-bold mb-3">{titulo}</h3>
      <ul className="space-y-2">
        {filas.map((f) => {
          const porcentaje = total > 0 ? (f.monto / total) * 100 : 0
          const Icono = f.icono
          return (
            <li key={f.etiqueta} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <Icono className="h-3.5 w-3.5 text-[#c8a58a] shrink-0" />
                  <span className="text-[#391511] truncate">{f.etiqueta}</span>
                </div>
                <div className="text-right shrink-0">
                  <span className="font-bold text-[#391511] tabular-nums">
                    <MontoARS monto={f.monto} />
                  </span>
                  <span className="text-[#6f3a2a] text-xs ml-2 tabular-nums">
                    {porcentaje.toFixed(0)}%
                  </span>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-[#fdfaf6] overflow-hidden">
                <div
                  className="h-full bg-[#f9b44c] rounded-full transition-all"
                  style={{ width: `${porcentaje}%` }}
                />
              </div>
              <div className="text-[10px] text-[#c8a58a] tabular-nums">
                {f.cantidad} {f.cantidad === 1 ? 'venta' : 'ventas'}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
