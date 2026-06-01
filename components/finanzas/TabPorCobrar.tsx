'use client'

import { useMemo, useState } from 'react'
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  Receipt,
  TrendingDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { MontoARS } from '@/components/shared/MontoARS'
import {
  useAcreditaciones,
  useAcreditarLote,
  useResumenPorCobrar,
} from '@/lib/hooks/useAcreditaciones'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { useMediosPago } from '@/lib/hooks/useMediosPago'
import { formatearFechaCorta } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import type { EstadoAcreditacion } from '@/types/database'

const TODAS = '__todas__'

export function TabPorCobrar() {
  const { data: usuario } = useUsuario()
  const { data: medios } = useMediosPago()
  const { data: resumen } = useResumenPorCobrar()
  const [filtroEstado, setFiltroEstado] = useState<string>('pendiente')
  const { data: acreditaciones, isLoading } = useAcreditaciones(
    filtroEstado === TODAS
      ? {}
      : { estado: filtroEstado as EstadoAcreditacion }
  )
  const acreditarLote = useAcreditarLote()

  const [seleccion, setSeleccion] = useState<Set<number>>(new Set())

  const nombreMedio = useMemo(() => {
    const m = new Map<string, string>()
    for (const x of medios ?? []) m.set(x.codigo, x.nombre)
    return m
  }, [medios])

  const totalSel = useMemo(() => {
    if (!acreditaciones) return 0
    return acreditaciones
      .filter((a) => seleccion.has(a.id))
      .reduce((acc, a) => acc + Number(a.monto_neto), 0)
  }, [acreditaciones, seleccion])

  function toggle(id: number) {
    setSeleccion((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleTodos() {
    const pendientes = (acreditaciones ?? []).filter(
      (a) => a.estado === 'pendiente'
    )
    if (!pendientes.length) return
    setSeleccion((prev) =>
      prev.size === pendientes.length
        ? new Set()
        : new Set(pendientes.map((a) => a.id))
    )
  }

  function acreditar() {
    if (!usuario || seleccion.size === 0) return
    acreditarLote.mutate(
      {
        ids: Array.from(seleccion),
        usuarioId: usuario.id,
        fecha: null,
      },
      { onSuccess: () => setSeleccion(new Set()) }
    )
  }

  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          icono={CreditCard}
          etiqueta="Pendientes"
          valor={resumen?.pendientes ?? 0}
          monto={resumen?.monto_bruto ?? 0}
          detalle="Bruto a cobrar"
        />
        <Kpi
          icono={Receipt}
          etiqueta="Neto a recibir"
          monto={resumen?.monto_neto ?? 0}
          detalle="Total ya descontada la comisión"
          destacado
        />
        <Kpi
          icono={CalendarClock}
          etiqueta="Próximos 7 días"
          monto={resumen?.proximos_7_dias ?? 0}
          detalle="Entran al banco esta semana"
        />
        <Kpi
          icono={TrendingDown}
          etiqueta="Comisión retenida"
          monto={resumen?.comision_total ?? 0}
          detalle="Costo de los procesadores"
        />
      </div>

      {/* Por medio de pago */}
      {resumen && resumen.por_medio.length > 0 && (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-4 shadow-sm">
          <h3 className="text-[#391511] font-semibold text-sm mb-3">
            Pendiente por medio de pago
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {resumen.por_medio.map((m) => (
              <div
                key={m.medio_pago}
                className="rounded-xl border border-[#e4c9b0]/60 bg-[#fdfaf6] px-3 py-2"
              >
                <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  {nombreMedio.get(m.medio_pago) ?? m.medio_pago}
                </div>
                <div className="font-bold text-[#391511] tabular-nums">
                  <MontoARS monto={m.monto_neto} />
                </div>
                <div className="text-[11px] text-[#6f3a2a]">
                  {m.cantidad} pago{m.cantidad === 1 ? '' : 's'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabla + acciones */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Select
              value={filtroEstado}
              onValueChange={(v) => setFiltroEstado(v ?? 'pendiente')}
            >
              <SelectTrigger className="h-9 w-[180px] border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pendiente">Pendientes</SelectItem>
                <SelectItem value="acreditada">Acreditadas</SelectItem>
                <SelectItem value="cancelada">Canceladas</SelectItem>
                <SelectItem value={TODAS}>Todas</SelectItem>
              </SelectContent>
            </Select>
            {seleccion.size > 0 && (
              <span className="text-xs text-[#6f3a2a]">
                <span className="font-bold text-[#391511]">
                  {seleccion.size}
                </span>{' '}
                seleccionada(s) ·{' '}
                <span className="font-bold text-[#391511]">
                  <MontoARS monto={totalSel} />
                </span>
              </span>
            )}
          </div>
          <Button
            size="sm"
            onClick={acreditar}
            disabled={seleccion.size === 0 || acreditarLote.isPending}
            className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5 disabled:opacity-40"
          >
            {acreditarLote.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            Marcar como acreditadas ({seleccion.size})
          </Button>
        </div>

        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={6} columnas={7} />
          </div>
        ) : !acreditaciones || acreditaciones.length === 0 ? (
          <div className="p-12 text-center text-[#6f3a2a] text-sm">
            No hay acreditaciones en este estado.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      checked={
                        seleccion.size > 0 &&
                        seleccion.size ===
                          acreditaciones.filter(
                            (a) => a.estado === 'pendiente'
                          ).length
                      }
                      onChange={toggleTodos}
                      className="accent-[#f9b44c] h-4 w-4"
                    />
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Venta
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Medio
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Bruto
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Comisión
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Neto
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Acreditación
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Estado
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {acreditaciones.map((a) => {
                  const fechaEst = new Date(`${a.fecha_estimada}T00:00:00`)
                  const vencido =
                    a.estado === 'pendiente' && fechaEst < hoy
                  const proximo =
                    a.estado === 'pendiente' &&
                    fechaEst >= hoy &&
                    (fechaEst.getTime() - hoy.getTime()) /
                      (1000 * 60 * 60 * 24) <=
                      7
                  return (
                    <TableRow
                      key={a.id}
                      className={cn(
                        'border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6]',
                        vencido && 'bg-[#c43e2c]/5'
                      )}
                    >
                      <TableCell>
                        {a.estado === 'pendiente' ? (
                          <input
                            type="checkbox"
                            checked={seleccion.has(a.id)}
                            onChange={() => toggle(a.id)}
                            className="accent-[#f9b44c] h-4 w-4"
                          />
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-[#6f3a2a] tabular-nums">
                        #{a.venta_id ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm text-[#391511]">
                        {nombreMedio.get(a.medio_pago) ?? a.medio_pago}
                        {a.cuenta_nombre && (
                          <div className="text-[11px] text-[#6f3a2a]">
                            → {a.cuenta_nombre}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-[#6f3a2a]">
                        <MontoARS monto={a.monto_bruto} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-[#c43e2c]">
                        −<MontoARS monto={a.comision_monto} />
                        <div className="text-[10px] text-[#c8a58a]">
                          {a.comision_pct}%
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-bold text-[#391511]">
                        <MontoARS monto={a.monto_neto} />
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        <div
                          className={cn(
                            'flex items-center gap-1',
                            vencido && 'text-[#c43e2c] font-semibold',
                            proximo && 'text-[#9e6b15] font-semibold'
                          )}
                        >
                          {vencido && (
                            <AlertCircle className="h-3.5 w-3.5" />
                          )}
                          {proximo && !vencido && (
                            <Clock className="h-3.5 w-3.5" />
                          )}
                          {formatearFechaCorta(a.fecha_estimada)}
                        </div>
                        {a.fecha_real && (
                          <div className="text-[10px] text-[#2f7d4f]">
                            real: {formatearFechaCorta(a.fecha_real)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <BadgeEstado estado={a.estado} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}

function Kpi({
  icono: Icono,
  etiqueta,
  valor,
  monto,
  detalle,
  destacado,
}: {
  icono: React.ElementType
  etiqueta: string
  valor?: number
  monto?: number
  detalle: string
  destacado?: boolean
}) {
  return (
    <div
      className={
        destacado
          ? 'rounded-2xl border-2 border-[#f9b44c]/50 bg-[#f9b44c]/10 p-4'
          : 'rounded-2xl border border-[#e4c9b0]/60 bg-white p-4 shadow-sm'
      }
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
        <Icono className="h-3.5 w-3.5 text-[#f9b44c]" />
        {etiqueta}
      </div>
      <div className="text-xl font-extrabold text-[#391511] tabular-nums mt-1">
        {valor !== undefined ? (
          <span>
            {valor}{' '}
            {monto !== undefined && (
              <span className="text-sm font-normal text-[#6f3a2a]">
                · <MontoARS monto={monto} />
              </span>
            )}
          </span>
        ) : (
          <MontoARS monto={monto ?? 0} />
        )}
      </div>
      <div className="text-[11px] text-[#6f3a2a] mt-0.5">{detalle}</div>
    </div>
  )
}

function BadgeEstado({ estado }: { estado: EstadoAcreditacion }) {
  const cfg: Record<EstadoAcreditacion, { etiqueta: string; clase: string }> = {
    pendiente: {
      etiqueta: 'Pendiente',
      clase: 'bg-[#f9b44c]/20 text-[#9e6b15] border-[#f9b44c]/50',
    },
    acreditada: {
      etiqueta: 'Acreditada',
      clase: 'bg-[#2f7d4f]/15 text-[#2f7d4f] border-[#2f7d4f]/40',
    },
    cancelada: {
      etiqueta: 'Cancelada',
      clase: 'bg-[#c43e2c]/15 text-[#9e2f25] border-[#c43e2c]/40',
    },
  }
  const c = cfg[estado]
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        c.clase
      )}
    >
      {c.etiqueta}
    </span>
  )
}
