'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Lock, Pin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DetalleTarea } from './DetalleTarea'
import { ROLES_OPERATIVOS } from './constantes'
import { horaAr } from './asistenciaConstantes'
import { horaDeMinutos, type ContextoReloj, type TareaAgenda } from './tareasAgenda'
import {
  AREAS,
  areaDe,
  avancePorPersona,
  carriles,
  esTodoElTurno,
  estiloCalendario,
  filtrarTipo,
  marcasHora,
  minutosAtraso,
  panelLateral,
  tareasJuntas,
  ubicar,
  type Bloque,
  type Carril,
  type FiltroTipo,
  type Persona,
  type VerPor,
} from './calendarioTurno'
import {
  useAvisosTareas,
  useCambiosSemana,
  usePedidosPendientes,
  usePersonasTurno,
  useResolverPedidoConDeshacer,
} from '@/lib/hooks/useTareas'
import { textoAvisado } from './avisosLogica'
import { cn } from '@/lib/utils'
import type { RolOperativo, TurnoPlantillaRow } from '@/types/database'
import type { TareaConParticipantes } from '@/lib/queries/tareas'

interface Props {
  lista: TareaAgenda[]
  turno: TurnoPlantillaRow
  /** Rango del turno en la línea del día (calendarioTurno.rangoTurno). */
  rango: { desde: number; hasta: number }
  /** Fecha en que empieza el turno seleccionado. */
  fechaTurno: string
  reloj: ContextoReloj
  nombres: Map<number, string>
  esGestor: boolean
  esAdmin: boolean
  empleadoActualId: number | null
  actorNombre: string | null
  onEditar: (t: TareaConParticipantes) => void
  /** Lleva a Tareas › Registro de cambios (solo administradores). */
  onVerRegistro?: () => void
}

/** Píxeles por minuto: un turno de 8 h mide ~770 px. */
const PX = 1.6

/**
 * Agenda del turno como calendario (Tareas v2, Etapa 2): horas en vertical,
 * un carril por área o por persona, la franja "Todo el turno" arriba, la
 * línea de ahora y el panel lateral (Para revisar, detalle, Ahora,
 * Atrasadas, Lo que sigue y Avance por persona).
 */
export function CalendarioAgenda({
  lista,
  turno,
  rango,
  fechaTurno,
  reloj,
  nombres,
  esGestor,
  esAdmin,
  empleadoActualId,
  actorNombre,
  onEditar,
  onVerRegistro,
}: Props) {
  const [verPor, setVerPor] = useState<VerPor>('area')
  const [filtro, setFiltro] = useState<FiltroTipo>('todas')
  const [seleccionId, setSeleccionId] = useState<string | null>(null)

  const { data: enTurno, error: errorPersonas } = usePersonasTurno(fechaTurno, turno.id, esGestor)
  const personas: Persona[] = useMemo(
    () =>
      (enTurno ?? []).map((p) => ({
        id: p.empleado_id,
        nombre: p.nombre,
        puesto: ROLES_OPERATIVOS[p.rol_operativo as RolOperativo] ?? p.rol_operativo,
      })),
    [enTurno]
  )
  const nombresTodos = useMemo(() => {
    const m = new Map(nombres)
    for (const p of personas) if (!m.has(p.id)) m.set(p.id, p.nombre)
    return m
  }, [nombres, personas])

  const visibles = useMemo(() => filtrarTipo(lista, filtro), [lista, filtro])
  const franja = visibles.filter(esTodoElTurno)
  const lanes = useMemo(() => carriles(visibles, verPor, personas), [visibles, verPor, personas])
  const panel = useMemo(() => panelLateral(lista), [lista])
  const avance = useMemo(() => avancePorPersona(lista, personas), [lista, personas])
  const juntas = useMemo(() => tareasJuntas(lista), [lista])
  const seleccion = lista.find((x) => x.tarea.id === seleccionId) ?? null
  // A quién se avisó cada atraso (Etapa 5). La encargada no ve los avisos que van al admin.
  const { data: avisos } = useAvisosTareas(esGestor)
  const avisoDe = useMemo(() => new Map((avisos ?? []).map((a) => [a.tarea_turno_id, a])), [avisos])

  const alto = (rango.hasta - rango.desde) * PX
  const marcas = marcasHora(rango.desde, rango.hasta)
  const ahoraVisible = Number.isFinite(reloj.ahora) && reloj.ahora >= rango.desde && reloj.ahora <= rango.hasta

  const nombreDe = (id: number) => nombresTodos.get(id) ?? `Legajo ${id}`
  const quienDe = (x: TareaAgenda) => {
    if (x.tarea.privada) return 'Administradores'
    if (x.tarea.empleado_id !== null) return nombreDe(x.tarea.empleado_id).split(' ')[0]
    const ps = (x.tarea.tareas_turno_participantes ?? []).map((p) => nombreDe(p.empleado_id).split(' ')[0])
    return ps.length ? ps.join(' y ') : 'Sin asignar'
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px] items-start">
      <div className="space-y-3 min-w-0">
        {esGestor && !esAdmin && (
          <p className="rounded-xl border border-[#f3d395] bg-[#fff6e5] px-3.5 py-2 text-[13px] text-[#4a3008]">
            Lo que cambies queda en el registro y los administradores lo ven. Si marcás una tarea de otra
            persona, queda a tu nombre.
          </p>
        )}

        {/* Barra de herramientas */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Segmentado
            etiqueta="Ver por"
            opciones={[
              ['area', 'Área'],
              ['persona', 'Persona'],
            ]}
            valor={verPor}
            onCambio={(v) => setVerPor(v as VerPor)}
          />
          <Segmentado
            etiqueta="Mostrar"
            opciones={[
              ['todas', 'Todas'],
              ['rutina', 'Rutina'],
              ['puntuales', 'Puntuales'],
            ]}
            valor={filtro}
            onCambio={(v) => setFiltro(v as FiltroTipo)}
          />
          <Leyenda />
        </div>

        {verPor === 'persona' && errorPersonas && (
          <p className="text-xs text-[#a3271d]">
            No se pudo leer quién trabaja este turno: {(errorPersonas as Error).message}
          </p>
        )}
        {verPor === 'persona' &&
          juntas.map((j) => (
            <p key={j.id} className="flex items-center gap-1.5 text-xs text-[#a06b00]">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />A {nombreDe(j.id)} se le juntan {j.cantidad} tareas a
              la vez desde las {horaDeMinutos(j.desde)}.
            </p>
          ))}

        {/* Todo el turno */}
        {franja.length > 0 && (
          <div className="rounded-xl border border-[#e4c9b0]/60 bg-[#fdfaf6] px-3 py-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#6f3a2a] mb-1.5">Todo el turno</p>
            <div className="flex flex-wrap gap-1.5">
              {franja.map((x) => {
                const area = areaDe(x.tarea.area)
                const estilo = estiloCalendario(x)
                return (
                  <button
                    key={x.tarea.id}
                    type="button"
                    onClick={() => setSeleccionId(x.tarea.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs min-h-8 text-left',
                      estilo === 'hecha' && 'opacity-60 line-through',
                      seleccionId === x.tarea.id && 'ring-2 ring-[#f9b44c]'
                    )}
                    style={{ borderColor: area.color, background: area.fondo }}
                  >
                    <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: area.color }} />
                    {x.tarea.titulo}
                    {x.tarea.tipo_actividad === 'continua' ? (
                      <span className="text-[10px] text-[#6f3a2a]">· recordatorio</span>
                    ) : (
                      <span className="text-[10px] text-[#6f3a2a]">· {quienDe(x)}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Calendario */}
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-x-auto">
          <div
            className="grid min-w-full"
            style={{ gridTemplateColumns: `56px repeat(${lanes.length}, minmax(150px, 1fr))` }}
          >
            {/* Cabeceras */}
            <div className="sticky left-0 z-20 bg-white border-b border-[#e4c9b0]/60" />
            {lanes.map((c) => (
              <div key={c.clave} className="border-b border-l border-[#e4c9b0]/60 px-2.5 py-2 min-w-0">
                <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-[#391511] truncate">
                  {c.privado ? (
                    <Lock className="h-3.5 w-3.5 shrink-0" style={{ color: c.color }} />
                  ) : (
                    <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px] shrink-0" style={{ background: c.color }} />
                  )}
                  <span className="truncate">{c.titulo}</span>
                </p>
                <p className="text-[11px] text-[#6f3a2a] truncate">
                  {c.subtitulo ?? `${c.tareas.filter((x) => x.tarea.estado === 'completada').length} de ${c.tareas.filter((x) => x.tarea.tipo_actividad !== 'continua').length} hechas`}
                </p>
              </div>
            ))}

            {/* Eje de horas */}
            <div className="sticky left-0 z-20 bg-white relative" style={{ height: alto }}>
              {marcas.map((m) => (
                <span
                  key={m}
                  className="absolute right-2 -translate-y-1/2 text-[10.5px] font-mono text-[#8a6a5a] tabular-nums"
                  style={{ top: (m - rango.desde) * PX }}
                >
                  {horaDeMinutos(m)}
                </span>
              ))}
            </div>

            {/* Carriles */}
            {lanes.map((c) => (
              <CarrilCalendario
                key={c.clave}
                carril={c}
                bloques={ubicar(c.tareas, rango.desde)}
                alto={alto}
                marcas={marcas.map((m) => m - rango.desde)}
                ahora={ahoraVisible ? reloj.ahora - rango.desde : null}
                reloj={reloj}
                verPor={verPor}
                quienDe={quienDe}
                seleccionId={seleccionId}
                onElegir={setSeleccionId}
              />
            ))}
          </div>
        </div>
        <p className="text-[11px] text-[#8a6a5a]">El alto de cada tarea es su duración. Tocá una para ver el detalle.</p>
      </div>

      {/* Panel lateral */}
      <aside className="space-y-3 xl:sticky xl:top-20">
        {esAdmin && <ParaRevisar onVerRegistro={onVerRegistro} />}
        {seleccion && (
          <DetalleTarea
            item={seleccion}
            reloj={reloj}
            nombres={nombresTodos}
            esGestor={esGestor}
            empleadoActualId={empleadoActualId}
            actorNombre={actorNombre}
            onEditar={esGestor ? () => onEditar(seleccion.tarea) : undefined}
            onCerrar={() => setSeleccionId(null)}
          />
        )}
        <Bloquecito titulo={Number.isFinite(reloj.ahora) ? `Ahora · ${horaDeMinutos(reloj.ahora)}` : 'Ahora'}>
          {panel.ahora.length === 0 ? (
            <Vacio>Nada en curso en este momento.</Vacio>
          ) : (
            panel.ahora.map((x) => (
              <ItemPanel key={x.tarea.id} x={x} detalle={quienDe(x)} onElegir={setSeleccionId} />
            ))
          )}
        </Bloquecito>
        {panel.atrasadas.length > 0 && (
          <Bloquecito titulo={`Atrasadas (${panel.atrasadas.length})`} tono="rojo">
            {panel.atrasadas.map((x) => {
              const min = minutosAtraso(x, reloj)
              const aviso = avisoDe.get(x.tarea.id)
              const avisado = aviso
                ? ` · ${textoAvisado(aviso, horaAr)}`
                : x.tarea.aviso_atraso_enviado_at
                  ? ` · Avisado ${horaAr(x.tarea.aviso_atraso_enviado_at)}`
                  : ''
              return (
                <ItemPanel
                  key={x.tarea.id}
                  x={x}
                  detalle={`${quienDe(x)}${min > 0 ? ` · ${min} min` : ''}${avisado}`}
                  onElegir={setSeleccionId}
                  rojo
                />
              )
            })}
          </Bloquecito>
        )}
        <Bloquecito titulo="Lo que sigue">
          {panel.sigue.length === 0 ? (
            <Vacio>No quedan tareas por empezar.</Vacio>
          ) : (
            panel.sigue.map((x) => (
              <ItemPanel
                key={x.tarea.id}
                x={x}
                detalle={`${horaDeMinutos(x.derivado.inicio ?? 0)} · ${quienDe(x)}`}
                onElegir={setSeleccionId}
              />
            ))
          )}
        </Bloquecito>
        {avance.length > 0 && (
          <Bloquecito titulo="Avance por persona">
            <ul className="space-y-2">
              {avance.map((a) => (
                <li key={a.id} className="space-y-1">
                  <div className="flex justify-between text-[12.5px]">
                    <span className="font-semibold text-[#391511]">{a.nombre}</span>
                    <span className="tabular-nums text-[#6f3a2a]">
                      {a.hechas} de {a.total}
                    </span>
                  </div>
                  <div
                    className="h-1.5 rounded-full bg-[#f3ece4] overflow-hidden"
                    role="progressbar"
                    aria-label={`Avance de ${a.nombre}`}
                    aria-valuemin={0}
                    aria-valuemax={a.total}
                    aria-valuenow={a.hechas}
                  >
                    <div className="h-full bg-[#2f7d4f]" style={{ width: `${(a.hechas / a.total) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </Bloquecito>
        )}
      </aside>
    </div>
  )
}

// ─── Piezas ────────────────────────────────────────────────────────────────

function CarrilCalendario({
  carril,
  bloques,
  alto,
  marcas,
  ahora,
  reloj,
  verPor,
  quienDe,
  seleccionId,
  onElegir,
}: {
  carril: Carril
  bloques: Bloque[]
  alto: number
  marcas: number[]
  ahora: number | null
  reloj: ContextoReloj
  verPor: VerPor
  quienDe: (x: TareaAgenda) => string
  seleccionId: string | null
  onElegir: (id: string) => void
}) {
  return (
    <div className="relative border-l border-[#e4c9b0]/60" style={{ height: alto }}>
      {marcas.map((m) => (
        <div key={m} aria-hidden="true" className="absolute inset-x-0 border-t border-[#efe5da]" style={{ top: m * PX }} />
      ))}
      {ahora !== null && (
        <div aria-hidden="true" className="absolute inset-x-0 z-10 border-t-2 border-[#c43e2c]" style={{ top: ahora * PX }} />
      )}
      {bloques.map((b) => (
        <BloqueTarea
          key={b.item.tarea.id}
          b={b}
          privado={!!carril.privado}
          reloj={reloj}
          detalle={verPor === 'area' ? quienDe(b.item) : areaDe(b.item.tarea.area).nombre}
          elegida={seleccionId === b.item.tarea.id}
          onElegir={onElegir}
        />
      ))}
    </div>
  )
}

function BloqueTarea({
  b,
  privado,
  reloj,
  detalle,
  elegida,
  onElegir,
}: {
  b: Bloque
  privado: boolean
  reloj: ContextoReloj
  detalle: string
  elegida: boolean
  onElegir: (id: string) => void
}) {
  const t = b.item.tarea
  const area = privado ? { color: '#7a1f2b', fondo: '#f8e5e7' } : areaDe(t.area)
  const estilo = estiloCalendario(b.item)
  const inicio = b.item.derivado.inicio ?? 0
  const hora = horaDeMinutos(inicio)
  const fin = horaDeMinutos(inicio + (t.duracion_min ?? 30))
  const atraso = minutosAtraso(b.item, reloj)
  const ancho = 100 / b.cols

  const estado =
    estilo === 'atrasada'
      ? `Atrasada ${atraso} min`
      : estilo === 'hecha'
        ? `Hecha${t.completada_at ? ` ${horaAr(t.completada_at)}` : ''}`
        : estilo === 'no_se_pudo'
          ? 'No se pudo'
          : estilo === 'en_curso'
            ? 'En curso'
            : estilo === 'cancelada'
              ? 'Cancelada'
              : null

  return (
    <button
      type="button"
      onClick={() => onElegir(t.id)}
      aria-label={`${hora} ${t.titulo}${estado ? `, ${estado}` : ''}`}
      className={cn(
        'absolute z-[5] overflow-hidden rounded-lg border text-left px-2 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#391511]',
        b.compacta ? 'py-0.5 flex items-center gap-1.5' : 'py-1.5',
        t.origen === 'puntual' && 'border-dashed',
        estilo === 'en_curso' && 'border-2 border-[#f5a524]',
        estilo === 'atrasada' && 'border-[#c43e2c] bg-[#fbe2df]! text-[#8f1f16]',
        estilo === 'hecha' && 'opacity-55',
        estilo === 'cancelada' && 'opacity-40 line-through',
        elegida && 'ring-2 ring-[#391511] z-[6]'
      )}
      style={{
        top: b.top * PX + 1,
        height: b.alto * PX - 2,
        left: `calc(${b.col * ancho}% + 3px)`,
        width: `calc(${ancho}% - 6px)`,
        borderColor: estilo === 'atrasada' || estilo === 'en_curso' ? undefined : area.color,
        background:
          estilo === 'no_se_pudo'
            ? 'repeating-linear-gradient(135deg, #f1ebe5 0 6px, #e6ddd3 6px 12px)'
            : estilo === 'hecha'
              ? '#efe9e3'
              : estilo === 'atrasada'
                ? undefined
                : area.fondo,
      }}
    >
      {b.compacta ? (
        <>
          <span className="font-mono text-[10.5px] font-semibold shrink-0">{hora}</span>
          <span className="truncate text-[11.5px] font-semibold">{t.titulo}</span>
          {estilo === 'hecha' && <Check className="h-3 w-3 shrink-0 text-[#2f7d4f]" />}
        </>
      ) : (
        <>
          <span className="flex items-center gap-1 font-mono text-[10.5px] font-semibold text-[#6f3a2a]">
            {hora}–{fin}
            {t.origen === 'puntual' && <Pin className="h-3 w-3" aria-label="Puntual" />}
            {t.prioridad === 'alta' && <span className="text-[#c43e2c]">● alta</span>}
          </span>
          <span className="block text-[12.5px] font-bold leading-snug line-clamp-2">{t.titulo}</span>
          <span className="block truncate text-[11px] text-[#6f3a2a]">{detalle}</span>
          {estado && <span className="block text-[10.5px] font-bold mt-0.5">{estado}</span>}
        </>
      )}
    </button>
  )
}

function ParaRevisar({ onVerRegistro }: { onVerRegistro?: () => void }) {
  const { data: todos } = usePedidosPendientes()
  const { data: cambios } = useCambiosSemana()
  const { decidir, enEspera } = useResolverPedidoConDeshacer()
  const pedidos = (todos ?? []).filter((p) => !enEspera.has(p.id))
  const n = pedidos.length
  if (n === 0 && !cambios) return null
  return (
    <section className="rounded-2xl border border-[#f3d395] bg-[#fff6e5] p-3.5 space-y-2.5">
      <h3 className="text-[13px] font-extrabold text-[#4a3008]">Para revisar</h3>
      {n > 0 &&
        pedidos.map((p) => (
          <div key={p.id} className="rounded-xl bg-white border border-[#f3d395] p-2.5 space-y-2">
            <p className="text-[12.5px] text-[#391511]">
              <strong>{p.pedido_por_nombre ?? 'La encargada'}</strong> pidió quitar de la rutina “
              {p.tareas_recurrentes?.titulo ?? 'una tarea'}”.
              {p.motivo && <span className="block text-[#6f3a2a] mt-0.5">“{p.motivo}”</span>}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => decidir(p.id, true)}
                title="La tarea sale de la rutina desde mañana (no se borra). Tenés unos segundos para deshacer."
                className="bg-[#391511] hover:bg-[#2a0f0c] text-white"
              >
                Aprobar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => decidir(p.id, false)}
                className="border-[#e4c9b0]"
              >
                Rechazar
              </Button>
            </div>
          </div>
        ))}
      {!!cambios && (
        <p className="text-[12.5px] text-[#4a3008]">
          Esta semana hubo {cambios} {cambios === 1 ? 'cambio' : 'cambios'} en tareas y rutina hechos por personas.
          {onVerRegistro && (
            <>
              {' '}
              <button type="button" onClick={onVerRegistro} className="font-bold underline underline-offset-2">
                Ver el registro
              </button>
            </>
          )}
        </p>
      )}
    </section>
  )
}

function Segmentado({
  etiqueta,
  opciones,
  valor,
  onCambio,
}: {
  etiqueta: string
  opciones: [string, string][]
  valor: string
  onCambio: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label={etiqueta}>
      <span className="text-xs font-semibold text-[#6f3a2a]">{etiqueta}</span>
      <div className="inline-flex rounded-lg border border-[#e4c9b0] bg-white p-0.5">
        {opciones.map(([v, l]) => (
          <button
            key={v}
            type="button"
            onClick={() => onCambio(v)}
            aria-pressed={valor === v}
            className={cn(
              'px-3 min-h-8 rounded-md text-xs font-semibold',
              valor === v ? 'bg-[#f9b44c] text-[#391511]' : 'text-[#6f3a2a] hover:bg-[#fdfaf6]'
            )}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  )
}

function Leyenda() {
  return (
    <details className="text-xs text-[#6f3a2a]">
      <summary className="cursor-pointer font-semibold">Cómo se lee</summary>
      <ul className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1">
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-5 rounded border" style={{ background: AREAS[0].fondo, borderColor: AREAS[0].color }} /> Por hacer (color del área)
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-5 rounded border-2 border-[#f5a524]" /> En curso
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-5 rounded border border-[#c43e2c] bg-[#fbe2df]" /> Atrasada
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-5 rounded border bg-[#efe9e3] opacity-60" /> Hecha
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="h-3 w-5 rounded border"
            style={{ background: 'repeating-linear-gradient(135deg, #f1ebe5 0 4px, #e6ddd3 4px 8px)' }}
          />{' '}
          No se pudo
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-5 rounded border border-dashed border-[#8a2733]" /> Puntual: solo ese día
        </li>
      </ul>
    </details>
  )
}

function Bloquecito({
  titulo,
  tono,
  children,
}: {
  titulo: string
  tono?: 'rojo'
  children: React.ReactNode
}) {
  return (
    <section
      className={cn(
        'rounded-2xl border bg-white p-3.5 space-y-2',
        tono === 'rojo' ? 'border-[#c43e2c]/40' : 'border-[#e4c9b0]/60'
      )}
    >
      <h3 className={cn('text-[13px] font-extrabold', tono === 'rojo' ? 'text-[#a3271d]' : 'text-[#391511]')}>
        {titulo}
      </h3>
      {children}
    </section>
  )
}

function ItemPanel({
  x,
  detalle,
  onElegir,
  rojo,
}: {
  x: TareaAgenda
  detalle: string
  onElegir: (id: string) => void
  rojo?: boolean
}) {
  const area = areaDe(x.tarea.area)
  return (
    <button
      type="button"
      onClick={() => onElegir(x.tarea.id)}
      className="w-full flex items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[#fdfaf6] min-h-11"
    >
      <span aria-hidden="true" className="mt-1.5 h-2 w-2 rounded-full shrink-0" style={{ background: area.color }} />
      <span className="min-w-0">
        <span className={cn('block text-[12.5px] font-semibold leading-snug', rojo && 'text-[#a3271d]')}>
          {x.tarea.titulo}
        </span>
        <span className="block text-[11px] text-[#6f3a2a] truncate">{detalle}</span>
      </span>
    </button>
  )
}

function Vacio({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-[#8a6a5a]">{children}</p>
}
