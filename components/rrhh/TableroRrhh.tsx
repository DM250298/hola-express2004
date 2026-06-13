'use client'

import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  AlertTriangle,
  CircleAlert,
  Clock,
  FileWarning,
  ListChecks,
  RefreshCw,
  UserCheck,
  UserX,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Semaforo } from '@/components/shared/Semaforo'
import { useDashboardRrhh } from '@/lib/hooks/useDesempeno'
import type { ClaseVencimiento } from '@/lib/queries/vencimientos'
import type {
  DocPorVencer,
  PersonaAusente,
  PersonaTrabajando,
  RachaTardanzas,
  TareasVencidasEmpleado,
} from '@/lib/queries/desempeno'
import { cn } from '@/lib/utils'

const nombre = (n: string, a: string | null) => [n, a].filter(Boolean).join(' ')
const horaCorta = (hhmmss: string) => hhmmss.slice(0, 5)

function claseDoc(dias: number): ClaseVencimiento {
  if (dias < 0) return 'vencido'
  if (dias <= 7) return 'rojo'
  if (dias <= 15) return 'amarillo'
  return 'verde'
}
function etiquetaDoc(dias: number): string {
  if (dias < 0) return `Venció hace ${-dias}d`
  if (dias === 0) return 'Vence hoy'
  return `En ${dias}d`
}

export function TableroRrhh() {
  const { data, isLoading, isError, isFetching } = useDashboardRrhh()

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64 rounded-lg bg-[#f9d2a2]/30" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl bg-[#f9d2a2]/30" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-2xl bg-[#f9d2a2]/30" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="bg-white border border-[#c43e2c]/30 rounded-2xl p-8 text-center text-[#c43e2c]">
          No se pudo cargar el tablero de RRHH.
        </div>
      </div>
    )
  }

  const tareasPend = data.tareas_hoy.pendientes
  const vencidasTotal = data.tareas_vencidas.reduce((s, t) => s + t.cantidad, 0)

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[#391511] text-2xl font-bold">Tablero RRHH</h1>
          <p className="text-[#6f3a2a] text-sm mt-1 capitalize">
            {format(new Date(`${data.fecha}T00:00:00`), "EEEE d 'de' MMMM", {
              locale: es,
            })}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[#c8a58a] text-xs">
          <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
          Actualiza solo
        </div>
      </header>

      {/* Resumen */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icono={UserCheck}
          label="Trabajando ahora"
          valor={data.trabajando_ahora.length}
          color="#2f7d4f"
        />
        <KpiCard
          icono={UserX}
          label="Ausentes hoy"
          valor={data.ausentes_hoy.length}
          color="#c43e2c"
          alerta={data.ausentes_hoy.length > 0}
        />
        <KpiCard
          icono={ListChecks}
          label="Tareas pendientes hoy"
          valor={tareasPend}
          sufijo={`/ ${data.tareas_hoy.total}`}
          color="#e4a42a"
        />
        <KpiCard
          icono={AlertTriangle}
          label="Tareas vencidas (14d)"
          valor={vencidasTotal}
          color="#9e2f25"
          alerta={vencidasTotal > 0}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Trabajando ahora */}
        <Panel titulo="Trabajando ahora" icono={UserCheck} color="#2f7d4f">
          {data.trabajando_ahora.length === 0 ? (
            <Vacio texto="Nadie con turno abierto en este momento." />
          ) : (
            <ul className="divide-y divide-[#e4c9b0]/40">
              {data.trabajando_ahora.map((p: PersonaTrabajando) => (
                <li
                  key={p.empleado_id}
                  className="flex items-center justify-between py-2.5"
                >
                  <span className="text-[#391511] text-sm font-medium">
                    {nombre(p.nombre, p.apellido)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[#2f7d4f] text-xs font-semibold">
                    <Clock className="h-3.5 w-3.5" />
                    desde {format(new Date(p.desde), 'HH:mm')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Ausentes hoy */}
        <Panel titulo="Ausentes / sin fichar" icono={UserX} color="#c43e2c">
          {data.ausentes_hoy.length === 0 ? (
            <Vacio texto="Todos los del turno actual ficharon. 👌" />
          ) : (
            <ul className="divide-y divide-[#e4c9b0]/40">
              {data.ausentes_hoy.map((p: PersonaAusente) => (
                <li
                  key={p.empleado_id}
                  className="flex items-center justify-between py-2.5"
                >
                  <span className="text-[#391511] text-sm font-medium">
                    {nombre(p.nombre, p.apellido)}
                  </span>
                  <span className="text-[#c43e2c] text-xs font-semibold capitalize">
                    {p.turno} · {horaCorta(p.hora_inicio)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Documentos por vencer */}
        <Panel titulo="Documentos por vencer" icono={FileWarning} color="#e4a42a">
          {data.docs_por_vencer.length === 0 ? (
            <Vacio texto="Sin aptos ni certificados próximos a vencer." />
          ) : (
            <ul className="divide-y divide-[#e4c9b0]/40">
              {data.docs_por_vencer.map((d: DocPorVencer, i) => (
                <li
                  key={`${d.empleado_id}-${i}`}
                  className="flex items-center justify-between py-2.5 gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-[#391511] text-sm font-medium truncate">
                      {nombre(d.nombre, d.apellido)}
                    </p>
                    <p className="text-[#6f3a2a] text-xs capitalize">
                      {d.tipo.replace(/_/g, ' ')}
                    </p>
                  </div>
                  <Semaforo clase={claseDoc(d.dias)} etiqueta={etiquetaDoc(d.dias)} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Rachas de tardanzas + tareas vencidas por empleado */}
        <Panel titulo="Para hablar con el equipo" icono={CircleAlert} color="#9e2f25">
          {data.rachas_tardanzas.length === 0 &&
          data.tareas_vencidas.length === 0 ? (
            <Vacio texto="Sin rachas de tardanzas ni tareas vencidas." />
          ) : (
            <div className="space-y-3">
              {data.rachas_tardanzas.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold mb-1.5">
                    Racha de tardanzas (mes)
                  </p>
                  <ul className="space-y-1">
                    {data.rachas_tardanzas.map((r: RachaTardanzas) => (
                      <li
                        key={r.empleado_id}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="text-[#391511] font-medium">
                          {nombre(r.nombre, r.apellido)}
                        </span>
                        <span className="text-[#c43e2c] font-bold tabular-nums">
                          {r.tardanzas} tardanzas
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data.tareas_vencidas.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold mb-1.5">
                    Tareas vencidas (14 días)
                  </p>
                  <ul className="space-y-1">
                    {data.tareas_vencidas.map((t: TareasVencidasEmpleado) => (
                      <li
                        key={t.empleado_id}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="text-[#391511] font-medium">
                          {nombre(t.nombre, t.apellido)}
                        </span>
                        <span className="text-[#9e2f25] font-bold tabular-nums">
                          {t.cantidad} sin hacer
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

function KpiCard({
  icono: Icono,
  label,
  valor,
  sufijo,
  color,
  alerta = false,
}: {
  icono: React.ElementType
  label: string
  valor: number
  sufijo?: string
  color: string
  alerta?: boolean
}) {
  return (
    <div
      className={cn(
        'bg-white border rounded-2xl shadow-sm p-4',
        alerta ? 'border-[#c43e2c]/30' : 'border-[#e4c9b0]/60'
      )}
    >
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-[#c8a58a]">
        <Icono className="h-4 w-4" style={{ color }} />
        {label}
      </div>
      <p className="mt-1 text-3xl font-bold tabular-nums text-[#391511]">
        {valor}
        {sufijo && (
          <span className="text-base font-semibold text-[#c8a58a] ml-1">
            {sufijo}
          </span>
        )}
      </p>
    </div>
  )
}

function Panel({
  titulo,
  icono: Icono,
  color,
  children,
}: {
  titulo: string
  icono: React.ElementType
  color: string
  children: React.ReactNode
}) {
  return (
    <section className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-[#391511] font-bold mb-3">
        <Icono className="h-4.5 w-4.5" style={{ color }} size={18} />
        {titulo}
      </h2>
      {children}
    </section>
  )
}

function Vacio({ texto }: { texto: string }) {
  return <p className="text-[#6f3a2a] text-sm py-4 text-center">{texto}</p>
}
