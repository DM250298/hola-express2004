'use client'

import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useResumenSemana } from '@/lib/hooks/useTareas'
import { cn } from '@/lib/utils'
import { NOMBRE_TURNO } from './asistenciaConstantes'
import { lunesDe, pctCumplimiento, sumarDias, valorTexto, type ContextoRegistro } from './registroLogica'
import type { NombreTurno } from '@/types/database'

type Cuenta = { hechas?: number; a_tiempo?: number; no_se_pudo?: number; sin_hacer?: number }
type ResumenDatos = {
  totales?: Cuenta & { tareas?: number; con_atraso?: number; abiertas?: number; canceladas?: number }
  por_turno?: (Cuenta & { turno_id: number; nombre: string | null })[]
  por_persona?: (Cuenta & { emp: number; nombre: string; tareas: number })[]
  no_se_pudo_motivos?: Record<string, number>
  mas_atrasadas?: { titulo: string; turno_id: number; veces: number }[]
  marcadas_por_otro?: number
  por_otro_quien?: Record<string, number>
  cambios_rutina?: number
  cambios_agenda?: number
  pedidos?: { creados?: number; aprobados?: number; rechazados?: number; pendientes?: number }
  avisos?: number
}

const ddmm = (f: string) => f.split('-').reverse().slice(0, 2).join('/')

/**
 * Resumen de la semana (Tareas v2, Etapa 5). Por defecto, la semana pasada:
 * la foto que guarda el sistema los lunes a las 08:00. La semana en curso
 * se calcula en el momento.
 */
export function ResumenSemanal({ hoy, lunes, onLunes, ctx }: {
  hoy: string
  lunes: string
  onLunes: (l: string) => void
  ctx: ContextoRegistro
}) {
  const { data, isLoading, error } = useResumenSemana(lunes)
  const { data: anterior } = useResumenSemana(sumarDias(lunes, -7))
  const enCurso = lunes === lunesDe(hoy)
  const d = (data?.datos ?? {}) as ResumenDatos
  const t = d.totales ?? {}
  const pct = pctCumplimiento(t)
  const pctAnt = pctCumplimiento(((anterior?.datos ?? {}) as ResumenDatos).totales)
  const nombreTurno = (n: string | null, id: number) =>
    (n && NOMBRE_TURNO[n as NombreTurno]) ?? ctx.turnos.get(id)?.nombre ?? `Turno ${id}`

  return (
    <section aria-label="Resumen de la semana" className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-base font-extrabold text-[#391511]">Resumen de la semana</h3>
          <p className="text-xs text-[#6f3a2a]">
            Del lunes {ddmm(lunes)} al domingo {ddmm(sumarDias(lunes, 6))} ·{' '}
            {enCurso ? 'semana en curso, calculado ahora' : data?.guardado ? 'foto del lunes 08:00' : 'calculado ahora'}
          </p>
        </div>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => onLunes(sumarDias(lunes, -7))} aria-label="Semana anterior"
            className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-[#e4c9b0] hover:bg-[#fdfaf6]">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => onLunes(sumarDias(lunes, 7))} aria-label="Semana siguiente" disabled={enCurso}
            className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-[#e4c9b0] hover:bg-[#fdfaf6] disabled:opacity-40">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-[#6f3a2a]"><Loader2 className="h-4 w-4 animate-spin" /> Calculando…</p>
      ) : error ? (
        <p className="text-sm text-[#a3271d]">No se pudo armar el resumen: {(error as Error).message}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-[auto_1fr] items-center">
            <div className="rounded-xl bg-[#fdfaf6] border border-[#e4c9b0]/60 px-4 py-3 text-center">
              <p className="text-3xl font-extrabold tabular-nums text-[#391511]">{pct === null ? '—' : `${pct}%`}</p>
              <p className="text-[11px] text-[#6f3a2a]">se hizo</p>
              {pct !== null && pctAnt !== null && (
                <p className={cn('text-[11px] font-bold', pct >= pctAnt ? 'text-[#2f7d4f]' : 'text-[#a3271d]')}>
                  {pct >= pctAnt ? '▲' : '▼'} {Math.abs(pct - pctAnt)} puntos vs. la anterior ({pctAnt}%)
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Dato titulo="Hechas a tiempo" valor={t.a_tiempo} tono="verde" />
              <Dato titulo="Hechas con atraso" valor={t.con_atraso} tono="ambar" />
              <Dato titulo="No se pudo" valor={t.no_se_pudo} />
              <Dato titulo="Quedaron sin hacer" valor={t.sin_hacer} tono="rojo" />
            </div>
          </div>
          <p className="text-[11px] text-[#8a6a5a]">
            El % es como en Cumplimiento: hechas sobre hechas + sin hacer. No cuentan los recordatorios,
            las canceladas ni las “No se pudo”.
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            <Tabla
              titulo="Por turno"
              columnas={['Turno', 'Hechas', 'Sin hacer', '%']}
              filas={(d.por_turno ?? []).map((x) => [nombreTurno(x.nombre, x.turno_id), x.hechas ?? 0, x.sin_hacer ?? 0, fmtPct(x)])}
            />
            <Tabla
              titulo="Por persona"
              columnas={['Persona', 'Hechas', 'A tiempo', 'No se pudo', 'Sin hacer', '%']}
              filas={(d.por_persona ?? []).map((x) => [x.nombre, `${x.hechas ?? 0} de ${x.tareas}`, x.a_tiempo ?? 0, x.no_se_pudo ?? 0, x.sin_hacer ?? 0, fmtPct(x)])}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-[13px]">
            <Lista titulo="Las que más se atrasan" vacio="Ninguna se atrasó."
              items={(d.mas_atrasadas ?? []).map((x) => `${x.titulo} (${nombreTurno(null, x.turno_id)}): ${x.veces} ${x.veces === 1 ? 'vez' : 'veces'}`)} />
            <Lista titulo="No se pudo, por motivo" vacio="Ninguna."
              items={Object.entries(d.no_se_pudo_motivos ?? {}).map(([m, n]) => `${valorTexto('motivo', m, ctx, null)}: ${n}`)} />
            <Lista titulo={`Marcadas por otro (${d.marcadas_por_otro ?? 0})`} vacio="Cada uno marcó lo suyo."
              items={Object.entries(d.por_otro_quien ?? {}).map(([q, n]) => `${q}: ${n}`)} />
            <Lista titulo="Cambios y avisos" vacio=""
              items={[
                `Cambios a la rutina: ${d.cambios_rutina ?? 0}`,
                `Cambios en la agenda: ${d.cambios_agenda ?? 0}`,
                `Pedidos de quitar: ${d.pedidos?.creados ?? 0} (${d.pedidos?.aprobados ?? 0} aprobados, ${d.pedidos?.rechazados ?? 0} rechazados)`,
                `Avisos de atraso: ${d.avisos ?? 0}`,
              ]} />
          </div>
        </>
      )}
    </section>
  )
}

function fmtPct(c: Cuenta): string {
  const p = pctCumplimiento(c)
  return p === null ? '—' : `${p}%`
}

function Dato({ titulo, valor, tono }: { titulo: string; valor?: number; tono?: 'verde' | 'ambar' | 'rojo' }) {
  return (
    <div className={cn('rounded-xl border px-3 py-2',
      tono === 'verde' ? 'border-[#2f7d4f]/30 bg-[#e6f3ea]' : tono === 'rojo' ? 'border-[#c43e2c]/30 bg-[#fbe2df]'
        : tono === 'ambar' ? 'border-[#f3d395] bg-[#fff6e5]' : 'border-[#e4c9b0]/60 bg-[#fdfaf6]')}>
      <p className="text-xl font-extrabold tabular-nums text-[#391511]">{valor ?? 0}</p>
      <p className="text-[11px] text-[#6f3a2a]">{titulo}</p>
    </div>
  )
}

function Tabla({ titulo, columnas, filas }: { titulo: string; columnas: string[]; filas: (string | number)[][] }) {
  return (
    <div className="min-w-0">
      <h4 className="text-[12px] font-bold uppercase tracking-wider text-[#6f3a2a] mb-1.5">{titulo}</h4>
      {filas.length === 0 ? (
        <p className="text-[13px] text-[#8a6a5a]">Sin tareas esa semana.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#e4c9b0]/60">
          <table className="w-full text-[13px]">
            <thead className="bg-[#fdfaf6] text-[#6f3a2a]">
              <tr>{columnas.map((c, i) => <th key={c} className={cn('px-2.5 py-1.5 font-semibold', i === 0 ? 'text-left' : 'text-right')}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={i} className="border-t border-[#e4c9b0]/40">
                  {f.map((v, j) => <td key={j} className={cn('px-2.5 py-1.5', j === 0 ? 'text-[#391511] font-semibold' : 'text-right tabular-nums text-[#6f3a2a]')}>{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Lista({ titulo, items, vacio }: { titulo: string; items: string[]; vacio: string }) {
  return (
    <div>
      <h4 className="text-[12px] font-bold uppercase tracking-wider text-[#6f3a2a] mb-1.5">{titulo}</h4>
      {items.length === 0 ? (
        <p className="text-[#8a6a5a]">{vacio}</p>
      ) : (
        <ul className="space-y-1 text-[#391511]">{items.map((x) => <li key={x}>{x}</li>)}</ul>
      )}
    </div>
  )
}
