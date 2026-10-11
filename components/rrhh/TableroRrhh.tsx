'use client'

import Link from 'next/link'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  CircleAlert,
  Clock,
  FileWarning,
  ListChecks,
  RefreshCw,
  ShieldAlert,
  UserCheck,
  UserX,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Semaforo } from '@/components/shared/Semaforo'
import { useDashboardRrhh } from '@/lib/hooks/useDesempeno'
import type { ClaseVencimiento } from '@/lib/queries/vencimientos'
import type {
  DocPorVencer,
  IncidenciasEmpleado30d,
  PaseNoConforme,
  PersonaAusente,
  PersonaTrabajando,
  RachaTardanzas,
  TareasVencidasEmpleado,
} from '@/lib/queries/desempeno'
import { INSTANCIA_INCIDENCIA } from './incidenciasConstantes'
import { fechaCortaLocal } from './constantes'
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

interface Props {
  /** Embebido como pestaña del hub Personal: sin padding exterior ni h1. */
  enHub?: boolean
}

export function TableroRrhh({ enHub = false }: Props = {}) {
  const { data, isLoading, isError, isFetching } = useDashboardRrhh()
  const clasePagina = cn(!enHub && 'p-4 sm:p-6', 'space-y-5')

  if (isLoading) {
    return (
      <div className={cn(!enHub && 'p-4 sm:p-6', 'space-y-4')}>
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
      <div className={cn(!enHub && 'p-6')}>
        <div className="bg-white border border-[#c43e2c]/30 rounded-2xl p-8 text-center text-[#c43e2c]">
          No se pudo cargar el tablero de RRHH.
        </div>
      </div>
    )
  }

  const {
    total: tareasTotal,
    completadas: tareasHechas,
    pendientes: tareasPend,
  } = data.tareas_hoy
  // Todo hecho: hubo tareas y no quedan pendientes → mostrar en verde, no "0".
  const tareasOk = tareasTotal > 0 && tareasPend === 0
  const vencidasTotal = data.tareas_vencidas.reduce((s, t) => s + t.cantidad, 0)
  const disc = data.disciplina

  return (
    <div className={clasePagina}>
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          {enHub ? (
            <h2 className="text-[#391511] text-lg font-bold">Hoy</h2>
          ) : (
            <h1 className="text-[#391511] text-2xl font-bold">Tablero RRHH</h1>
          )}
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
      <div className={cn('grid grid-cols-2 gap-3', disc ? 'lg:grid-cols-5' : 'lg:grid-cols-4')}>
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
        {tareasOk ? (
          <KpiCard
            icono={CheckCircle2}
            label="Tareas de hoy"
            valor={`${tareasHechas}/${tareasTotal}`}
            sufijo="hechas"
            color="#2f7d4f"
            tono="#2f7d4f"
            ok
          />
        ) : (
          <KpiCard
            icono={ListChecks}
            label="Tareas pendientes hoy"
            valor={tareasPend}
            sufijo={tareasTotal > 0 ? `/ ${tareasTotal}` : undefined}
            color="#e4a42a"
          />
        )}
        <KpiCard
          icono={AlertTriangle}
          label="Tareas vencidas (14d)"
          valor={vencidasTotal}
          color="#9e2f25"
          alerta={vencidasTotal > 0}
        />
        {disc && (
          <Link href="/rrhh?tab=incidencias" className="block">
            <KpiCard
              icono={ShieldAlert}
              label="Incidencias abiertas"
              valor={disc.incidencias_abiertas}
              sufijo={disc.reincidencias_30d > 0 ? `· ${disc.reincidencias_30d} reinc. 30d` : undefined}
              color="#c43e2c"
              alerta={disc.incidencias_abiertas > 0 || disc.reincidencias_30d > 0}
            />
          </Link>
        )}
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

        {disc && (
          <Panel titulo="Disciplina (30 días)" icono={ShieldAlert} color="#c43e2c">
            {disc.incidencias_empleados_30d.length === 0 ? (
              <Vacio texto="Sin incidencias registradas en los últimos 30 días." />
            ) : (
              <ul className="divide-y divide-[#e4c9b0]/40">
                {disc.incidencias_empleados_30d.map((e: IncidenciasEmpleado30d) => {
                  const def = INSTANCIA_INCIDENCIA[Math.min(3, Math.max(1, e.max_instancia))]
                  return (
                    <li key={e.empleado_id} className="flex items-center justify-between py-2.5 gap-2">
                      <Link
                        href={`/rrhh/empleados/${e.empleado_id}`}
                        className="text-[#391511] text-sm font-medium hover:underline truncate"
                      >
                        {nombre(e.nombre, e.apellido)}
                      </Link>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="text-[#6f3a2a] text-xs tabular-nums">
                          {e.cantidad} incid.
                        </span>
                        <span
                          className={cn(
                            'text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full',
                            e.escalada ? INSTANCIA_INCIDENCIA[3].clase : def.clase
                          )}
                        >
                          {e.escalada ? 'Escalada' : def.corta}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
            <Link href="/rrhh?tab=incidencias" className="block text-[#6f3a2a] text-xs mt-2 hover:underline">
              Ver todas las incidencias →
            </Link>
          </Panel>
        )}

        {disc && (
          <Panel titulo="Pase de turno" icono={ArrowLeftRight} color="#2f7d4f">
            <div className="space-y-3">
              <p className="text-sm">
                <span className={cn('font-bold tabular-nums text-lg', disc.pases_pendientes_recibir > 0 ? 'text-[#e4a42a]' : 'text-[#2f7d4f]')}>
                  {disc.pases_pendientes_recibir}
                </span>{' '}
                <span className="text-[#6f3a2a]">
                  {disc.pases_pendientes_recibir === 1 ? 'pase sin recibir' : 'pases sin recibir'} (48 h)
                </span>
              </p>
              {disc.pases_no_conformes_7d.length === 0 ? (
                <Vacio texto="Sin pases no conformes en la semana." />
              ) : (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold mb-1.5">
                    No conformes (7 días)
                  </p>
                  <ul className="space-y-1">
                    {disc.pases_no_conformes_7d.map((p: PaseNoConforme) => (
                      <li key={p.pase_id} className="flex items-center justify-between text-sm gap-2">
                        <span className="text-[#391511] font-medium truncate">
                          {fechaCortaLocal(p.fecha)} · <span className="capitalize">{p.turno}</span> · {nombre(p.nombre, p.apellido)}
                        </span>
                        <span className="text-[#c43e2c] font-bold tabular-nums shrink-0">
                          {p.no_conformes} no conf.
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Link href="/rrhh?tab=pase" className="block text-[#6f3a2a] text-xs hover:underline">
                Ver pases de turno →
              </Link>
            </div>
          </Panel>
        )}
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
  tono = '#391511',
  alerta = false,
  ok = false,
}: {
  icono: React.ElementType
  label: string
  valor: number | string
  sufijo?: string
  color: string
  /** Color del número grande (ej. verde cuando está todo hecho). */
  tono?: string
  alerta?: boolean
  /** Estado positivo: borde verde suave. */
  ok?: boolean
}) {
  return (
    <div
      className={cn(
        'bg-white border rounded-2xl shadow-sm p-4',
        alerta
          ? 'border-[#c43e2c]/30'
          : ok
            ? 'border-[#2f7d4f]/30'
            : 'border-[#e4c9b0]/60'
      )}
    >
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-[#c8a58a]">
        <Icono className="h-4 w-4" style={{ color }} />
        {label}
      </div>
      <p className="mt-1 text-3xl font-bold tabular-nums" style={{ color: tono }}>
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
