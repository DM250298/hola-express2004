'use client'

import { useEffect, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { AlertTriangle, ShieldCheck, TrendingDown, Wallet } from 'lucide-react'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import { formatearMonto } from '@/lib/utils/formato'
import { useFlujoProyectado } from '@/lib/hooks/useFlujoProyectado'
import { cn } from '@/lib/utils'
import type { SemanaFlujo } from '@/lib/queries/flujoProyectado'

const LS_SUELDOS = 'hex_flujo_sueldos'

interface PuntoGrafico {
  x: string
  saldo: number
  semana?: SemanaFlujo
  esInicial?: boolean
}

interface PropsTooltip {
  active?: boolean
  payload?: Array<{ payload?: PuntoGrafico }>
}

export function TabFlujoProyectado() {
  const [horizonte, setHorizonte] = useState(8)
  const [sueldos, setSueldos] = useState('')

  // Persistir sueldos estimados en el navegador
  useEffect(() => {
    const v = window.localStorage.getItem(LS_SUELDOS)
    if (v) setSueldos(v)
  }, [])

  function onSueldos(v: string) {
    setSueldos(v)
    window.localStorage.setItem(LS_SUELDOS, v)
  }

  const { data, isLoading } = useFlujoProyectado({
    horizonteSemanas: horizonte,
    sueldosMensuales: Number(sueldos) || 0,
    diaPagoSueldos: 5,
  })

  const datosGrafico: PuntoGrafico[] = data
    ? [
        { x: data.semanas[0]?.desde ?? '', saldo: data.saldo_inicial, esInicial: true },
        ...data.semanas.map((s) => ({ x: s.hasta, saldo: s.saldo_acumulado, semana: s })),
      ]
    : []

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[#391511] font-bold">Flujo de caja proyectado</h2>
          <p className="text-[#6f3a2a] text-sm">
            Qué entra y qué sale las próximas semanas, para anticipar
            faltantes de caja.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Sueldos / mes
            </Label>
            <Input
              type="number"
              min="0"
              step="1000"
              value={sueldos}
              onChange={(e) => onSueldos(e.target.value)}
              placeholder="0"
              className="w-32 h-9 border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Horizonte
            </Label>
            <Select
              value={String(horizonte)}
              onValueChange={(v) => setHorizonte(Number(v) || 8)}
            >
              <SelectTrigger className="w-[130px] h-9 border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="4">4 semanas</SelectItem>
                <SelectItem value="8">8 semanas</SelectItem>
                <SelectItem value="13">13 semanas</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-2xl bg-[#f9d2a2]/30" />
          <Skeleton className="h-64 rounded-2xl bg-[#f9d2a2]/30" />
          <Skeleton className="h-48 rounded-2xl bg-[#f9d2a2]/30" />
        </div>
      ) : (
        <>
          {/* Alerta de quiebre */}
          {data.primer_quiebre ? (
            <div className="rounded-2xl border-2 border-[#c43e2c]/40 bg-[#c43e2c]/8 p-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-[#c43e2c] shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-[#c43e2c]">
                  Quiebre de caja proyectado
                </div>
                <div className="text-sm text-[#6f3a2a]">
                  La semana del{' '}
                  {format(parseISO(data.primer_quiebre.desde), "d 'de' MMMM", {
                    locale: es,
                  })}{' '}
                  el saldo caería a{' '}
                  <span className="font-bold text-[#c43e2c]">
                    <MontoARS monto={data.primer_quiebre.saldo_acumulado} />
                  </span>
                  . Conviene adelantar cobranzas, reprogramar pagos o reforzar
                  caja.
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border-2 border-[#2f8f4e]/40 bg-[#2f8f4e]/8 p-4 flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-[#2f8f4e] shrink-0" />
              <div className="text-sm text-[#391511]">
                <span className="font-bold">Caja sana.</span> No se proyectan
                faltantes en las próximas {horizonte} semanas.
              </div>
            </div>
          )}

          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <KpiCard
              icono={Wallet}
              titulo="Saldo hoy"
              monto={data.saldo_inicial}
              color="#391511"
            />
            <KpiCard
              icono={TrendingDown}
              titulo="Saldo mínimo proyectado"
              monto={data.saldo_minimo}
              color={data.saldo_minimo < 0 ? '#c43e2c' : '#2f8f4e'}
            />
            <KpiCard
              icono={Wallet}
              titulo="Venta semanal estimada"
              monto={data.ventas_promedio_semanal}
              color="#6f3a2a"
              sub="promedio últimas 8 sem."
            />
          </div>

          {/* Gráfico de saldo acumulado */}
          <div className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-4">
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold mb-2">
              Saldo proyectado al cierre de cada semana
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={datosGrafico}
                  margin={{ top: 5, right: 15, bottom: 5, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#e4c9b0"
                    opacity={0.5}
                  />
                  <XAxis
                    dataKey="x"
                    tickFormatter={(v: string) =>
                      v ? format(parseISO(v), 'dd MMM', { locale: es }) : ''
                    }
                    stroke="#6f3a2a"
                    tick={{ fontSize: 11 }}
                    axisLine={{ stroke: '#e4c9b0' }}
                    tickLine={{ stroke: '#e4c9b0' }}
                    minTickGap={20}
                  />
                  <YAxis
                    tickFormatter={(v: number) =>
                      Math.abs(v) >= 1000
                        ? `${Math.round(v / 1000)}k`
                        : String(v)
                    }
                    stroke="#6f3a2a"
                    tick={{ fontSize: 11 }}
                    axisLine={{ stroke: '#e4c9b0' }}
                    tickLine={{ stroke: '#e4c9b0' }}
                  />
                  <Tooltip content={<TooltipFlujo />} />
                  <ReferenceLine y={0} stroke="#c43e2c" strokeDasharray="4 4" />
                  <Line
                    type="monotone"
                    dataKey="saldo"
                    stroke="#391511"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: '#f9b44c', stroke: '#391511' }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Tabla semanal */}
          <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                  <TableHead className="text-[#391511] font-semibold">
                    Semana
                  </TableHead>
                  <TableHead className="text-right text-[#2f8f4e] font-semibold">
                    Ingresos
                  </TableHead>
                  <TableHead className="text-right text-[#c43e2c] font-semibold">
                    Egresos
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Neto
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Saldo
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.semanas.map((s) => (
                  <TableRow
                    key={s.indice}
                    className={cn(
                      'border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6]',
                      s.quiebre && 'bg-[#c43e2c]/[0.05] hover:bg-[#c43e2c]/[0.08]'
                    )}
                  >
                    <TableCell className="text-sm text-[#391511] font-medium tabular-nums">
                      {format(parseISO(s.desde), 'dd MMM', { locale: es })}
                    </TableCell>
                    <TableCell className="text-right text-[#2f8f4e] tabular-nums">
                      <MontoARS monto={s.ingresos_total} />
                    </TableCell>
                    <TableCell className="text-right text-[#c43e2c] tabular-nums">
                      <MontoARS monto={s.egresos_total} />
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums font-medium',
                        s.neto < 0 ? 'text-[#c43e2c]' : 'text-[#391511]'
                      )}
                    >
                      <MontoARS monto={s.neto} />
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums font-bold',
                        s.quiebre ? 'text-[#c43e2c]' : 'text-[#391511]'
                      )}
                    >
                      <MontoARS monto={s.saldo_acumulado} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="text-[11px] text-[#c8a58a] leading-relaxed">
            <strong>Supuestos:</strong> ingresos = venta semanal estimada
            (promedio de las últimas 8 semanas) + cobranzas de tarjeta ya
            agendadas. Egresos = cuentas a pagar por vencimiento + IVA/IIBB del
            mes en curso + sueldos estimados (día 5). Lo vencido se imputa a la
            primera semana. Es una estimación para anticipar, no una predicción
            exacta.
          </p>
        </>
      )}
    </div>
  )
}

function KpiCard({
  icono: Icono,
  titulo,
  monto,
  color,
  sub,
}: {
  icono: React.ElementType
  titulo: string
  monto: number
  color: string
  sub?: string
}) {
  return (
    <div className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-4">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
          {titulo}
        </span>
        <Icono className="h-4 w-4" style={{ color }} />
      </div>
      <div className="text-2xl font-extrabold tabular-nums" style={{ color }}>
        <MontoARS monto={monto} />
      </div>
      {sub && <div className="text-[10px] text-[#c8a58a] mt-0.5">{sub}</div>}
    </div>
  )
}

function TooltipFlujo({ active, payload }: PropsTooltip) {
  if (!active || !payload || payload.length === 0) return null
  const punto = payload[0]?.payload
  if (!punto) return null

  if (punto.esInicial) {
    return (
      <div className="bg-white border border-[#e4c9b0] rounded-lg shadow-md px-3 py-2 text-xs">
        <div className="font-semibold text-[#391511]">Saldo hoy</div>
        <div className="text-[#391511] font-bold tabular-nums">
          {formatearMonto(punto.saldo)}
        </div>
      </div>
    )
  }

  const s = punto.semana
  if (!s) return null
  return (
    <div className="bg-white border border-[#e4c9b0] rounded-lg shadow-md px-3 py-2 text-xs space-y-0.5 min-w-[180px]">
      <div className="font-semibold text-[#391511] mb-1">
        Semana del {format(parseISO(s.desde), "d 'de' MMM", { locale: es })}
      </div>
      <Fila label="Ventas est." monto={s.ingresos_ventas} color="#2f8f4e" />
      <Fila label="Cobranzas" monto={s.ingresos_cobranzas} color="#2f8f4e" />
      <Fila label="Proveedores" monto={-s.egresos_proveedores} color="#c43e2c" />
      <Fila label="Impuestos" monto={-s.egresos_impuestos} color="#c43e2c" />
      <Fila label="Sueldos" monto={-s.egresos_sueldos} color="#c43e2c" />
      <div className="border-t border-[#e4c9b0]/60 mt-1 pt-1 flex justify-between font-bold">
        <span className="text-[#391511]">Saldo</span>
        <span
          className={cn(
            'tabular-nums',
            s.saldo_acumulado < 0 ? 'text-[#c43e2c]' : 'text-[#391511]'
          )}
        >
          {formatearMonto(s.saldo_acumulado)}
        </span>
      </div>
    </div>
  )
}

function Fila({
  label,
  monto,
  color,
}: {
  label: string
  monto: number
  color: string
}) {
  if (monto === 0) return null
  return (
    <div className="flex justify-between gap-4 text-[#6f3a2a]">
      <span>{label}</span>
      <span className="tabular-nums" style={{ color }}>
        {formatearMonto(monto)}
      </span>
    </div>
  )
}
