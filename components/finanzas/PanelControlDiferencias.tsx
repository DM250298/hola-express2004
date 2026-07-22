'use client'

import { Fragment, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  Scale,
  Users,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
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
import { MontoARS } from '@/components/shared/MontoARS'
import { AyudaContextual } from '@/components/shared/AyudaContextual'
import {
  useDiferenciasCierrePorEmpleado,
  useArqueosPeriodo,
} from '@/lib/hooks/useCajaFuerte'
import {
  rangoPredefinido,
  rangoDesdeFechas,
  type ClavePeriodo,
} from '@/lib/utils/periodos'
import { formatearFechaHora } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import type { DiferenciaCierreEmpleado } from '@/lib/queries/cajaFuerte'

const PERIODOS: Record<string, string> = {
  hoy: 'Hoy',
  mes_actual: 'Este mes',
  mes_anterior: 'Mes anterior',
  ultimos_7: 'Últimos 7 días',
  personalizado: 'Personalizado',
}

function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Color de un monto de diferencia: verde sobrante, rojo faltante, neutro cero. */
function claseDif(n: number): string {
  if (Math.abs(n) < 0.01) return 'text-[#6f3a2a]'
  return n > 0 ? 'text-[#2f7d4f]' : 'text-[#c43e2c]'
}

function DifConSigno({ monto }: { monto: number }) {
  const cero = Math.abs(monto) < 0.01
  return (
    <span className={cn('font-semibold tabular-nums', claseDif(monto))}>
      {cero ? '' : monto > 0 ? '+' : '−'}
      <MontoARS monto={Math.abs(monto)} />
    </span>
  )
}

export function PanelControlDiferencias() {
  const [periodo, setPeriodo] = useState<ClavePeriodo>('mes_actual')
  const [desdeInput, setDesdeInput] = useState(hoyIso())
  const [hastaInput, setHastaInput] = useState(hoyIso())

  const rango = useMemo(() => {
    if (periodo === 'personalizado') {
      return rangoDesdeFechas(desdeInput, hastaInput)
    }
    return rangoPredefinido(periodo)
  }, [periodo, desdeInput, hastaInput])

  const { data: empleados, isPending: cargandoEmpleados } =
    useDiferenciasCierrePorEmpleado(rango.desde, rango.hasta)
  const { data: arqueos, isPending: cargandoArqueos } = useArqueosPeriodo(
    rango.desde,
    rango.hasta
  )

  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
      <div className="px-5 py-3 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-[#391511] font-semibold text-sm flex items-center gap-2">
          <Scale className="h-4 w-4 text-[#f9b44c]" />
          Control de diferencias
          <AyudaContextual titulo="Diferencias de caja">
            Dos controles distintos: <em>por empleado</em> es la diferencia de
            cada cierre de caja (lo que el cajero declaró vs. lo que las ventas
            dicen que debía haber). <em>Control del buzón</em> es lo que vos
            contaste del sobre vs. lo que el cajero declaró — puede juntar sobres
            de varios cajeros, por eso no se abre por empleado.
          </AyudaContextual>
        </h3>

        {/* Filtro de período LOCAL (independiente del período global de Finanzas) */}
        <div className="flex items-center gap-2">
          <Select
            value={periodo}
            onValueChange={(v) => setPeriodo((v ?? 'mes_actual') as ClavePeriodo)}
          >
            <SelectTrigger className="h-8 w-[150px] border-[#e4c9b0] focus:ring-[#f9b44c] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PERIODOS).map(([valor, etiqueta]) => (
                <SelectItem key={valor} value={valor}>
                  {etiqueta}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {periodo === 'personalizado' && (
            <>
              <Input
                type="date"
                value={desdeInput}
                onChange={(e) => setDesdeInput(e.target.value)}
                className="h-8 w-[140px] border-[#e4c9b0] focus-visible:ring-[#f9b44c] text-sm tabular-nums"
              />
              <span className="text-[#6f3a2a] text-sm">a</span>
              <Input
                type="date"
                value={hastaInput}
                onChange={(e) => setHastaInput(e.target.value)}
                className="h-8 w-[140px] border-[#e4c9b0] focus-visible:ring-[#f9b44c] text-sm tabular-nums"
              />
            </>
          )}
        </div>
      </div>

      <div className="p-4 space-y-5">
        {/* ── Por empleado (cierres de caja) ── */}
        <section>
          <div className="flex items-center gap-2 mb-2 text-[#391511] font-semibold text-sm">
            <Users className="h-4 w-4 text-[#6f3a2a]" />
            Por empleado (cierres de caja)
          </div>
          {cargandoEmpleados ? (
            <div className="flex items-center justify-center py-8 text-[#6f3a2a]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !empleados || empleados.length === 0 ? (
            <div className="py-8 text-center text-[#6f3a2a] text-sm">
              No hay cierres de caja en este período.
            </div>
          ) : (
            <TablaEmpleados empleados={empleados} />
          )}
        </section>

        {/* ── Control del buzón (arqueos de tesorería) ── */}
        <section>
          <div className="flex items-center gap-2 mb-2 text-[#391511] font-semibold text-sm">
            <ClipboardCheck className="h-4 w-4 text-[#6f3a2a]" />
            Control del buzón (arqueos)
          </div>
          {cargandoArqueos ? (
            <div className="flex items-center justify-center py-8 text-[#6f3a2a]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !arqueos || arqueos.arqueos.length === 0 ? (
            <div className="py-8 text-center text-[#6f3a2a] text-sm">
              No hay arqueos en este período.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <ResumenArqueo etiqueta="Esperado" monto={arqueos.totalEsperado} />
                <ResumenArqueo etiqueta="Contado" monto={arqueos.totalFisico} />
                <ResumenArqueo
                  etiqueta="Diferencia"
                  monto={arqueos.totalDiferencia}
                  dif
                />
              </div>
              <ul className="divide-y divide-[#e4c9b0]/40 border border-[#e4c9b0]/60 rounded-xl overflow-hidden">
                {arqueos.arqueos.map((a) => (
                  <li
                    key={a.id}
                    className="px-4 py-2.5 flex items-center justify-between gap-2 bg-white"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[#391511]">
                        {formatearFechaHora(a.created_at)}
                      </div>
                      <div className="text-xs text-[#6f3a2a]">
                        Declarado <MontoARS monto={a.monto_esperado} /> · contado{' '}
                        <MontoARS monto={a.monto_fisico} />
                      </div>
                    </div>
                    <DifConSigno monto={Number(a.diferencia)} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function TablaEmpleados({ empleados }: { empleados: DiferenciaCierreEmpleado[] }) {
  const [abierto, setAbierto] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setAbierto((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="overflow-x-auto border border-[#e4c9b0]/60 rounded-xl">
      <Table>
        <TableHeader>
          <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
            <TableHead className="text-[#391511] font-semibold">Empleado</TableHead>
            <TableHead className="text-center text-[#391511] font-semibold">
              Turnos
            </TableHead>
            <TableHead className="text-right text-[#391511] font-semibold">
              Sobrante
            </TableHead>
            <TableHead className="text-right text-[#391511] font-semibold">
              Faltante
            </TableHead>
            <TableHead className="text-right text-[#391511] font-semibold">
              Neto
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {empleados.map((e) => {
            const exp = abierto.has(e.usuario_id)
            return (
              <Fragment key={e.usuario_id}>
                <TableRow
                  className="border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6] cursor-pointer"
                  onClick={() => toggle(e.usuario_id)}
                >
                  <TableCell>
                    <div className="flex items-center gap-1.5 font-medium text-[#391511]">
                      {exp ? (
                        <ChevronDown className="h-3.5 w-3.5 text-[#c8a58a]" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-[#c8a58a]" />
                      )}
                      {e.usuario_nombre ?? '—'}
                    </div>
                  </TableCell>
                  <TableCell className="text-center text-sm text-[#6f3a2a] tabular-nums">
                    {e.turnos}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-[#2f7d4f]">
                    {e.sobrantes > 0 ? <MontoARS monto={e.sobrantes} /> : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-[#c43e2c]">
                    {e.faltantes > 0 ? <MontoARS monto={e.faltantes} /> : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <DifConSigno monto={e.neto} />
                  </TableCell>
                </TableRow>
                {exp &&
                  e.detalle.map((t) => (
                    <TableRow
                      key={`${e.usuario_id}-${t.turno_id}`}
                      className="border-b-[#e4c9b0]/30 bg-[#fdfaf6]/50"
                    >
                      <TableCell className="pl-8 text-xs text-[#6f3a2a]">
                        Turno #{t.turno_id}
                        {t.fecha_cierre
                          ? ` · ${formatearFechaHora(t.fecha_cierre)}`
                          : ''}
                      </TableCell>
                      <TableCell />
                      <TableCell
                        colSpan={2}
                        className="text-right text-xs text-[#6f3a2a] tabular-nums"
                      >
                        esperado <MontoARS monto={t.esperado} /> · contado{' '}
                        <MontoARS monto={t.contado} />
                      </TableCell>
                      <TableCell className="text-right">
                        <DifConSigno monto={t.diferencia} />
                      </TableCell>
                    </TableRow>
                  ))}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function ResumenArqueo({
  etiqueta,
  monto,
  dif,
}: {
  etiqueta: string
  monto: number
  dif?: boolean
}) {
  return (
    <div className="rounded-xl border border-[#e4c9b0]/60 bg-[#fdfaf6] p-3">
      <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
        {etiqueta}
      </div>
      <div className="text-base font-extrabold tabular-nums mt-0.5">
        {dif ? <DifConSigno monto={monto} /> : <MontoARS monto={monto} />}
      </div>
    </div>
  )
}
