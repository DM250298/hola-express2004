'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  History,
  ListChecks,
  RefreshCw,
  Settings2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EstadoError } from '@/components/shared/EstadoError'
import { cn } from '@/lib/utils'
import { formatearFechaCortaISO, formatearFechaHora, formatearNumero } from '@/lib/utils/formato'
import { hoyIso } from '@/lib/utils/periodos'
import {
  useAlertas,
  useEvaluarAlertasAhora,
  useReabrirAlertas,
  useResumenAlertas,
} from '@/lib/hooks/useAlertas'
import {
  ETIQUETA_SEVERIDAD,
  SEVERIDADES,
  type Alerta,
} from '@/lib/queries/alertas'
import {
  ACCION_REGLA,
  COLOR_SEVERIDAD,
  SUGERENCIA_REGLA,
  conCantidad,
  describirAlerta,
  hace,
} from './presentacion'
import { ModalTareaAlertas } from './ModalTareaAlertas'
import { ModalPosponerAlertas } from './ModalPosponerAlertas'
import { TabReglasAlerta } from './TabReglasAlerta'

type Pestana = 'resolver' | 'en_curso' | 'pospuestas' | 'resueltas' | 'reglas'

const ITEMS_VISIBLES = 10

function agruparPor<T, K>(lista: T[], clave: (x: T) => K): [K, T[]][] {
  const mapa = new Map<K, T[]>()
  for (const x of lista) {
    const k = clave(x)
    const grupo = mapa.get(k)
    if (grupo) grupo.push(x)
    else mapa.set(k, [x])
  }
  return [...mapa]
}

function duracion(desde: string, hasta: string): string {
  const horas = (new Date(hasta).getTime() - new Date(desde).getTime()) / 3_600_000
  if (horas < 1) return 'menos de 1 h'
  if (horas < 48) return `${Math.round(horas)} h`
  return `${Math.round(horas / 24)} días`
}

const ETIQUETA_ESTADO_TAREA: Record<string, string> = {
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  hecha: 'Hecha',
}

/**
 * DATO → DIAGNÓSTICO → PRIORIDAD → ACCIÓN → RESULTADO.
 * HEX detecta y sugiere; la persona decide (tarea o posponer). Nada se
 * cierra a mano: la alerta se resuelve cuando el problema desaparece.
 */
export function PantallaAlertas({ puedeEditarReglas }: { puedeEditarReglas: boolean }) {
  const [pestana, setPestana] = useState<Pestana>('resolver')
  const { data, isLoading, isError, error, refetch } = useAlertas(30)
  const { data: resumen } = useResumenAlertas({ evaluar: false })
  const evaluar = useEvaluarAlertasAhora()

  const porEstado = useMemo(() => {
    const lista = data ?? []
    return {
      abierta: lista.filter((a) => a.estado === 'abierta'),
      en_curso: lista.filter((a) => a.estado === 'en_curso'),
      pospuesta: lista.filter((a) => a.estado === 'pospuesta'),
      resuelta: lista.filter((a) => a.estado === 'resuelta'),
    }
  }, [data])

  const pestanas: { clave: Pestana; etiqueta: string; cantidad?: number; icono: React.ElementType }[] = [
    { clave: 'resolver', etiqueta: 'Para resolver', cantidad: porEstado.abierta.length, icono: AlertTriangle },
    { clave: 'en_curso', etiqueta: 'Con tarea', cantidad: porEstado.en_curso.length, icono: ListChecks },
    { clave: 'pospuestas', etiqueta: 'Pospuestas', cantidad: porEstado.pospuesta.length, icono: Clock },
    { clave: 'resueltas', etiqueta: 'Resueltas (30 días)', cantidad: porEstado.resuelta.length, icono: History },
    { clave: 'reglas', etiqueta: 'Reglas', icono: Settings2 },
  ]

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#391511]">Alertas</h1>
          <p className="mt-1 text-sm text-[#6f3a2a]">
            HEX detecta y sugiere; vos decidís. Cada alerta se resuelve sola cuando el problema
            desaparece.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {resumen?.ultima_evaluacion && (
            <span className="text-xs text-[#6f3a2a]">
              Revisado {hace(resumen.ultima_evaluacion)}
            </span>
          )}
          <Button variant="outline" onClick={() => evaluar.mutate()} disabled={evaluar.isPending}>
            <RefreshCw className={cn('h-4 w-4', evaluar.isPending && 'animate-spin')} />
            Revisar ahora
          </Button>
        </div>
      </header>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 rounded-2xl bg-[#f9d2a2]/30" />
          <Skeleton className="h-40 rounded-2xl bg-[#f9d2a2]/30" />
          <Skeleton className="h-40 rounded-2xl bg-[#f9d2a2]/30" />
        </div>
      ) : isError ? (
        <EstadoError
          mensaje={
            error?.message?.includes('permiso')
              ? error.message
              : 'No pudimos cargar las alertas. Revisá tu conexión e intentá de nuevo.'
          }
          onReintentar={refetch}
        />
      ) : data === null || data === undefined ? (
        <div className="max-w-xl rounded-2xl border-2 border-[#e4a42a]/50 bg-[#f9b44c]/10 p-6">
          <h2 className="mb-1 font-bold text-[#391511]">Faltan correr las migraciones 183 a 189</h2>
          <p className="text-sm text-[#6f3a2a]">
            Corridas las migraciones, esta pantalla se habilita sola.
          </p>
        </div>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {SEVERIDADES.map((s) => {
              const cantidad = porEstado.abierta.filter((a) => a.severidad === s).length
              return (
                <div
                  key={s}
                  className={cn('rounded-2xl border bg-white p-3.5', COLOR_SEVERIDAD[s].borde)}
                >
                  <div
                    className={cn(
                      'flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider',
                      COLOR_SEVERIDAD[s].texto
                    )}
                  >
                    <span className={cn('h-2 w-2 rounded-full', COLOR_SEVERIDAD[s].punto)} />
                    {ETIQUETA_SEVERIDAD[s]}
                  </div>
                  <div className="text-2xl font-extrabold tabular-nums text-[#391511]">
                    {formatearNumero(cantidad)}
                  </div>
                  <div className="text-[11px] text-[#6f3a2a]">para resolver</div>
                </div>
              )
            })}
          </section>

          <nav className="flex flex-wrap gap-2">
            {pestanas.map((p) => (
              <button
                key={p.clave}
                type="button"
                onClick={() => setPestana(p.clave)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium',
                  pestana === p.clave
                    ? 'border-[#e4a42a] bg-[#f9b44c]/25 text-[#391511]'
                    : 'border-[#e4c9b0] bg-white text-[#6f3a2a] hover:border-[#c8a58a]'
                )}
              >
                <p.icono className="h-3.5 w-3.5" />
                {p.etiqueta}
                {p.cantidad !== undefined && (
                  <span className="rounded-full bg-[#391511]/10 px-1.5 text-xs tabular-nums">
                    {formatearNumero(p.cantidad)}
                  </span>
                )}
              </button>
            ))}
          </nav>

          {pestana === 'resolver' && <VistaParaResolver alertas={porEstado.abierta} />}
          {pestana === 'en_curso' && <VistaConTarea alertas={porEstado.en_curso} />}
          {pestana === 'pospuestas' && <VistaPospuestas alertas={porEstado.pospuesta} />}
          {pestana === 'resueltas' && <VistaResueltas alertas={porEstado.resuelta} />}
        </>
      )}

      {pestana === 'reglas' && <TabReglasAlerta puedeEditar={puedeEditarReglas} />}
    </div>
  )
}

// ─── Para resolver ───────────────────────────────────────────────────────────

function useSeleccion() {
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set())
  const alternar = (ids: number[], marcar: boolean) =>
    setSeleccion((prev) => {
      const nueva = new Set(prev)
      for (const id of ids) {
        if (marcar) nueva.add(id)
        else nueva.delete(id)
      }
      return nueva
    })
  const limpiar = () => setSeleccion(new Set())
  return { seleccion, alternar, limpiar }
}

function VistaParaResolver({ alertas }: { alertas: Alerta[] }) {
  const { seleccion, alternar, limpiar } = useSeleccion()
  const [modal, setModal] = useState<'tarea' | 'posponer' | null>(null)
  const seleccionadas = useMemo(
    () => alertas.filter((a) => seleccion.has(a.id)),
    [alertas, seleccion]
  )

  if (alertas.length === 0) {
    return <Vacio texto="Nada para resolver: no hay alertas abiertas." />
  }

  const cerrarYLimpiar = () => {
    setModal(null)
    limpiar()
  }

  return (
    <div className="space-y-5">
      {SEVERIDADES.map((s) => {
        const deSeveridad = alertas.filter((a) => a.severidad === s)
        if (deSeveridad.length === 0) return null
        return (
          <section key={s} className="space-y-2">
            <h2
              className={cn(
                'flex items-center gap-2 text-xs font-semibold uppercase tracking-wider',
                COLOR_SEVERIDAD[s].texto
              )}
            >
              <span className={cn('h-2 w-2 rounded-full', COLOR_SEVERIDAD[s].punto)} />
              {ETIQUETA_SEVERIDAD[s]} · {formatearNumero(deSeveridad.length)}
            </h2>
            {agruparPor(deSeveridad, (a) => a.regla_codigo).map(([codigo, delaRegla]) => (
              <TarjetaRegla
                key={codigo}
                alertas={delaRegla}
                seleccion={seleccion}
                onAlternar={alternar}
                abiertaInicial={s === 'critico' || s === 'atencion'}
              />
            ))}
          </section>
        )
      })}

      {seleccionadas.length > 0 && (
        <BarraSeleccion cantidad={seleccionadas.length} onLimpiar={limpiar}>
          <Button size="sm" onClick={() => setModal('tarea')}>
            <ListChecks className="h-4 w-4" />
            Crear tarea
          </Button>
          <Button size="sm" variant="outline" onClick={() => setModal('posponer')}>
            <Clock className="h-4 w-4" />
            Posponer
          </Button>
        </BarraSeleccion>
      )}

      {modal === 'tarea' && (
        <ModalTareaAlertas
          alertas={seleccionadas}
          onCerrar={() => setModal(null)}
          onListo={cerrarYLimpiar}
        />
      )}
      {modal === 'posponer' && (
        <ModalPosponerAlertas
          alertas={seleccionadas}
          onCerrar={() => setModal(null)}
          onListo={cerrarYLimpiar}
        />
      )}
    </div>
  )
}

function TarjetaRegla({
  alertas,
  seleccion,
  onAlternar,
  abiertaInicial,
  extra,
}: {
  alertas: Alerta[]
  seleccion: Set<number>
  onAlternar: (ids: number[], marcar: boolean) => void
  abiertaInicial: boolean
  extra?: (a: Alerta) => React.ReactNode
}) {
  const [abierta, setAbierta] = useState(abiertaInicial)
  const primera = alertas[0]
  const colores = COLOR_SEVERIDAD[primera.severidad]
  const accion = ACCION_REGLA[primera.regla_codigo]
  const ids = alertas.map((a) => a.id)
  const todas = ids.every((id) => seleccion.has(id))
  const grupos = agruparPor(alertas, (a) => a.grupo ?? '—')
  const resumenGrupos = grupos
    .slice(0, 3)
    .map(([g, items]) => `${g} ${formatearNumero(items.length)}`)
    .join(' · ')

  return (
    <div className={cn('overflow-hidden rounded-2xl border bg-white shadow-sm', colores.borde)}>
      <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3', colores.fondo)}>
        <input
          type="checkbox"
          checked={todas}
          onChange={(e) => onAlternar(ids, e.target.checked)}
          className="accent-[#e4a42a]"
          aria-label={`Seleccionar todas: ${primera.regla_nombre}`}
        />
        <button
          type="button"
          onClick={() => setAbierta((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {abierta ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-[#6f3a2a]" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-[#6f3a2a]" />
          )}
          <span className="font-semibold text-[#391511]">{primera.regla_nombre}</span>
          <span className="rounded-full bg-[#391511]/10 px-1.5 text-xs font-semibold tabular-nums text-[#391511]">
            {formatearNumero(alertas.length)}
          </span>
        </button>
        {accion && (
          <Link
            href={accion.href}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#9e6b15] hover:text-[#391511] hover:underline"
          >
            {accion.etiqueta}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
        <p className="basis-full pl-6 text-xs text-[#6f3a2a]">
          {grupos.length > 1 && <>{resumenGrupos} — </>}
          <span className="text-[#391511]">Sugerencia:</span>{' '}
          {SUGERENCIA_REGLA[primera.regla_codigo] ?? 'Revisar.'}
        </p>
      </div>

      {abierta && (
        <div className="divide-y divide-[#e4c9b0]/40">
          {grupos.map(([grupo, items]) => (
            <SubGrupo
              key={grupo}
              grupo={grupo}
              items={items}
              mostrarTitulo={grupos.length > 1}
              seleccion={seleccion}
              onAlternar={onAlternar}
              extra={extra}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SubGrupo({
  grupo,
  items,
  mostrarTitulo,
  seleccion,
  onAlternar,
  extra,
}: {
  grupo: string
  items: Alerta[]
  mostrarTitulo: boolean
  seleccion: Set<number>
  onAlternar: (ids: number[], marcar: boolean) => void
  extra?: (a: Alerta) => React.ReactNode
}) {
  const [verTodos, setVerTodos] = useState(false)
  const ids = items.map((a) => a.id)
  const visibles = verTodos ? items : items.slice(0, ITEMS_VISIBLES)

  return (
    <div className="py-1">
      {mostrarTitulo && (
        <label className="flex items-center gap-2 px-4 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[#c8a58a]">
          <input
            type="checkbox"
            checked={ids.every((id) => seleccion.has(id))}
            onChange={(e) => onAlternar(ids, e.target.checked)}
            className="accent-[#e4a42a]"
          />
          {grupo} · {formatearNumero(items.length)}
        </label>
      )}
      <ul>
        {visibles.map((a) => (
          <li key={a.id} className="flex items-start gap-3 px-4 py-2">
            <input
              type="checkbox"
              checked={seleccion.has(a.id)}
              onChange={(e) => onAlternar([a.id], e.target.checked)}
              className="mt-1 accent-[#e4a42a]"
              aria-label={`Seleccionar ${a.titulo}`}
            />
            <div className="min-w-0 flex-1">
              <NombreAlerta alerta={a} />
              <p className="text-xs text-[#6f3a2a]">{describirAlerta(a)}</p>
              {extra?.(a)}
            </div>
            <span
              className="shrink-0 text-[11px] text-[#c8a58a]"
              title={`Detectada ${formatearFechaHora(a.detectada_at)}`}
            >
              {hace(a.detectada_at)}
            </span>
          </li>
        ))}
      </ul>
      {items.length > ITEMS_VISIBLES && (
        <button
          type="button"
          onClick={() => setVerTodos((v) => !v)}
          className="px-4 pb-2 text-xs font-semibold text-[#9e6b15] hover:underline"
        >
          {verTodos ? 'Ver menos' : `Ver los ${formatearNumero(items.length)}`}
        </button>
      )}
    </div>
  )
}

function NombreAlerta({ alerta: a }: { alerta: Alerta }) {
  if (!a.producto_id) {
    return <p className="text-sm font-medium text-[#391511]">{a.titulo}</p>
  }
  return (
    <Link
      href={`/inventario/${a.producto_id}`}
      className="text-sm font-medium text-[#391511] hover:underline"
    >
      {a.titulo}
    </Link>
  )
}

function BarraSeleccion({
  cantidad,
  onLimpiar,
  children,
}: {
  cantidad: number
  onLimpiar: () => void
  children: React.ReactNode
}) {
  return (
    <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-[#e4a42a] bg-white px-4 py-3 shadow-lg">
      <span className="text-sm font-semibold text-[#391511]">
        {conCantidad(cantidad, 'seleccionada', 'seleccionadas')}
      </span>
      <div className="ml-auto flex flex-wrap gap-2">
        {children}
        <Button size="sm" variant="ghost" onClick={onLimpiar}>
          Limpiar
        </Button>
      </div>
    </div>
  )
}

function Vacio({ texto }: { texto: string }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-[#e4c9b0]/60 bg-white px-4 py-6 text-sm text-[#2f7d4f]">
      <CheckCircle2 className="h-4 w-4" />
      {texto}
    </div>
  )
}

// ─── Con tarea ───────────────────────────────────────────────────────────────

function VistaConTarea({ alertas }: { alertas: Alerta[] }) {
  if (alertas.length === 0) {
    return <Vacio texto="No hay alertas esperando una tarea." />
  }
  const hoy = hoyIso()
  return (
    <div className="space-y-3">
      {agruparPor(alertas, (a) => a.tarea_id ?? 0).map(([tareaId, items]) => {
        const t = items[0]
        const hecha = t.tarea_estado === 'hecha'
        const vencida = !hecha && !!t.tarea_fecha_limite && t.tarea_fecha_limite < hoy
        return (
          <div
            key={tareaId}
            className="overflow-hidden rounded-2xl border border-[#e4c9b0]/60 bg-white shadow-sm"
          >
            <div className="flex flex-wrap items-start gap-x-4 gap-y-1 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-[#391511]">{t.tarea_titulo ?? 'Tarea'}</p>
                <p className="text-xs text-[#6f3a2a]">
                  {t.tarea_responsable ?? 'Sin responsable'}
                  {t.tarea_fecha_limite && (
                    <span className={cn(vencida && 'font-semibold text-[#c43e2c]')}>
                      {' '}
                      · para el {formatearFechaCortaISO(t.tarea_fecha_limite)}
                      {vencida && ' (vencida)'}
                    </span>
                  )}
                  {t.decidida_por_nombre && t.decidida_at && (
                    <> · la creó {t.decidida_por_nombre} {hace(t.decidida_at)}</>
                  )}
                </p>
              </div>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-semibold',
                  hecha ? 'bg-[#2f7d4f]/10 text-[#2f7d4f]' : 'bg-[#f9b44c]/25 text-[#a06b00]'
                )}
              >
                {ETIQUETA_ESTADO_TAREA[t.tarea_estado ?? ''] ?? t.tarea_estado}
              </span>
            </div>
            {hecha && (
              <p className="flex items-center gap-2 border-b border-[#e4c9b0]/60 bg-[#c43e2c]/[0.05] px-4 py-2 text-xs text-[#9e2f25]">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                La tarea se marcó hecha pero el problema sigue en{' '}
                {conCantidad(items.length, 'caso', 'casos')}. Revisá si se hizo bien.
              </p>
            )}
            <ul className="divide-y divide-[#e4c9b0]/40">
              {items.map((a) => (
                <li key={a.id} className="px-4 py-2">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <NombreAlerta alerta={a} />
                    <span className="text-[11px] text-[#c8a58a]">{a.regla_nombre}</span>
                  </div>
                  <p className="text-xs text-[#6f3a2a]">{describirAlerta(a)}</p>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
      <p className="text-xs text-[#6f3a2a]">
        Las tareas están en el tablero{' '}
        <Link href="/proyectos" className="underline underline-offset-2 hover:text-[#391511]">
          Acciones de HEX
        </Link>{' '}
        y en el{' '}
        <Link href="/agenda" className="underline underline-offset-2 hover:text-[#391511]">
          Mi día
        </Link>{' '}
        de cada responsable.
      </p>
    </div>
  )
}

// ─── Pospuestas ──────────────────────────────────────────────────────────────

function VistaPospuestas({ alertas }: { alertas: Alerta[] }) {
  const { seleccion, alternar, limpiar } = useSeleccion()
  const reabrir = useReabrirAlertas()
  const seleccionadas = alertas.filter((a) => seleccion.has(a.id))

  if (alertas.length === 0) {
    return <Vacio texto="No hay alertas pospuestas." />
  }

  return (
    <div className="space-y-3">
      {agruparPor(alertas, (a) => a.regla_codigo).map(([codigo, items]) => (
        <TarjetaRegla
          key={codigo}
          alertas={items}
          seleccion={seleccion}
          onAlternar={alternar}
          abiertaInicial
          extra={(a) => (
            <p className="text-[11px] text-[#a06b00]">
              Pospuesta hasta el {a.pospuesta_hasta ? formatearFechaCortaISO(a.pospuesta_hasta) : '—'}
              {a.decidida_por_nombre && <> por {a.decidida_por_nombre}</>}
              {a.nota_decision && <> · “{a.nota_decision}”</>}
            </p>
          )}
        />
      ))}
      {seleccionadas.length > 0 && (
        <BarraSeleccion cantidad={seleccionadas.length} onLimpiar={limpiar}>
          <Button
            size="sm"
            onClick={() => reabrir.mutate(seleccionadas.map((a) => a.id), { onSuccess: limpiar })}
            disabled={reabrir.isPending}
          >
            Volver a "Para resolver"
          </Button>
        </BarraSeleccion>
      )}
    </div>
  )
}

// ─── Resueltas: el resultado ─────────────────────────────────────────────────

function VistaResueltas({ alertas }: { alertas: Alerta[] }) {
  const [verTodas, setVerTodas] = useState(false)

  if (alertas.length === 0) {
    return <Vacio texto="Todavía no se resolvió ninguna alerta en los últimos 30 días." />
  }

  const ordenadas = [...alertas].sort((a, b) =>
    (b.resuelta_at ?? '').localeCompare(a.resuelta_at ?? '')
  )
  const conTarea = alertas.filter((a) => a.decision === 'tarea').length
  const pospuestas = alertas.filter((a) => a.decision === 'posponer').length
  const solas = alertas.length - conTarea - pospuestas
  const horasPromedio =
    alertas.reduce(
      (acc, a) =>
        acc + (new Date(a.resuelta_at ?? a.detectada_at).getTime() - new Date(a.detectada_at).getTime()),
      0
    ) /
    alertas.length /
    3_600_000
  const visibles = verTodas ? ordenadas : ordenadas.slice(0, 50)

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Dato etiqueta="Resueltas" valor={formatearNumero(alertas.length)} />
        <Dato etiqueta="Con tarea" valor={formatearNumero(conTarea)} />
        <Dato etiqueta="Se resolvieron sin intervención" valor={formatearNumero(solas + pospuestas)} />
        <Dato
          etiqueta="Tiempo promedio hasta resolverse"
          valor={horasPromedio < 48 ? `${Math.round(horasPromedio)} h` : `${Math.round(horasPromedio / 24)} días`}
        />
      </section>

      <ul className="divide-y divide-[#e4c9b0]/40 overflow-hidden rounded-2xl border border-[#e4c9b0]/60 bg-white shadow-sm">
        {visibles.map((a) => (
          <li key={a.id} className="px-4 py-2.5">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className={cn('h-2 w-2 rounded-full', COLOR_SEVERIDAD[a.severidad].punto)} />
              <NombreAlerta alerta={a} />
              <span className="text-[11px] text-[#c8a58a]">{a.regla_nombre}</span>
            </div>
            <p className="text-xs text-[#6f3a2a]">
              Detectada {formatearFechaHora(a.detectada_at)}
              {a.decision === 'tarea' && (
                <>
                  {' '}
                  → tarea{a.tarea_responsable && <> de {a.tarea_responsable}</>}
                  {a.tarea_estado === 'hecha' ? ' (hecha)' : a.tarea_estado ? ` (${ETIQUETA_ESTADO_TAREA[a.tarea_estado] ?? a.tarea_estado})` : ''}
                </>
              )}
              {a.decision === 'posponer' && (
                <>
                  {' '}
                  → pospuesta{a.decidida_por_nombre && <> por {a.decidida_por_nombre}</>}
                </>
              )}
              {a.resuelta_at && (
                <>
                  {' '}
                  →{' '}
                  <span className="font-semibold text-[#2f7d4f]">
                    {a.resolucion === 'regla_desactivada' ? 'regla desactivada' : 'resuelta'}
                  </span>{' '}
                  {formatearFechaHora(a.resuelta_at)} · {duracion(a.detectada_at, a.resuelta_at)}
                </>
              )}
            </p>
          </li>
        ))}
      </ul>
      {ordenadas.length > 50 && (
        <button
          type="button"
          onClick={() => setVerTodas((v) => !v)}
          className="text-xs font-semibold text-[#9e6b15] hover:underline"
        >
          {verTodas ? 'Ver menos' : `Ver las ${formatearNumero(ordenadas.length)}`}
        </button>
      )}
    </div>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-3.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6f3a2a]">
        {etiqueta}
      </div>
      <div className="text-xl font-extrabold tabular-nums text-[#391511]">{valor}</div>
    </div>
  )
}
