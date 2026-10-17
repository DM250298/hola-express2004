'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import { PanelRutina } from './PanelRutina'
import { DIAS_SEMANA } from './tareasConstantes'
import { hoyAr } from './asistenciaConstantes'
import { horaDeMinutos } from './tareasAgenda'
import { AREAS, areaDe, carriles, esTodoElTurno, marcasHora, rangoTurno, ubicar, type Bloque } from './calendarioTurno'
import {
  aplicaEnDia,
  comoTareaAgenda,
  estirar,
  indiceCarril,
  largoTurno,
  mover,
  proximoDia,
} from './rutinaCalendario'
import { isoMasDias } from '@/lib/utils/periodos'
import { cn } from '@/lib/utils'
import type { PlantillaConAsignados } from '@/lib/queries/tareas'
import type { AreaTarea, TurnoPlantillaRow } from '@/types/database'

interface Props {
  plantillas: PlantillaConAsignados[]
  turno: TurnoPlantillaRow
  esGestor: boolean
  esAdmin: boolean
  nombres: Map<number, string>
}

/** Píxeles por minuto (igual que la agenda). */
const PX = 1.6
/** Cuánto hay que mover el puntero para que cuente como arrastre y no como toque. */
const UMBRAL_PX = 4

/** Cambio en curso hecho con el mouse (todavía sin guardar). */
export interface Borrador {
  id: string
  /** Minutos desde el inicio del turno. */
  inicio: number
  duracion: number
  area: AreaTarea | null
}

interface Arrastre {
  id: string
  tipo: 'mover' | 'estirar'
  x0: number
  y0: number
  inicio0: number
  dur0: number
  area0: AreaTarea | null
  movido: boolean
}

/**
 * Rutina del turno como calendario (Tareas v2, Etapa 4): carriles por área,
 * arrastrar para cambiar hora o área y estirar el borde de abajo para la
 * duración (de a 15 min, sin salirse del turno). Nada se guarda al soltar:
 * el cambio queda en el panel y se confirma con "Guardar cambios".
 */
export function CalendarioRutina({ plantillas, turno, esGestor, esAdmin, nombres }: Props) {
  const manana = isoMasDias(hoyAr(), 1)
  const [dow, setDow] = useState<number | null>(null)
  const [seleccionId, setSeleccionId] = useState<string | null>(null)
  const [borrador, setBorrador] = useState<Borrador | null>(null)
  const arrastre = useRef<Arrastre | null>(null)
  const carrilesRef = useRef<HTMLDivElement>(null)

  const rango = rangoTurno(turno, 'hoy')
  const largo = largoTurno(turno)
  const alto = largo * PX
  const marcas = marcasHora(rango.desde, rango.hasta)

  // Solo lo que está en la rutina: las quitadas se ven (y se reactivan) en la vista Lista.
  const items = useMemo(
    () => plantillas.filter((p) => p.activa).map((p) => comoTareaAgenda(p, turno)),
    [plantillas, turno]
  )
  const lanes = useMemo(() => carriles(items, 'area', []), [items])
  const franja = items.filter(esTodoElTurno)
  const fechaDia = dow === null ? null : proximoDia(manana, dow)
  const seAtenua = (id: string) => {
    const p = plantillas.find((x) => x.id === id)
    return !!p && (!p.activa || (fechaDia !== null && !aplicaEnDia(p, fechaDia)))
  }
  const seleccion = plantillas.find((p) => p.id === seleccionId) ?? null

  // Si cambia el turno, se descarta lo que estaba a medio editar.
  useEffect(() => {
    setSeleccionId(null)
    setBorrador(null)
  }, [turno.id])

  useEffect(() => {
    function alMover(e: PointerEvent) {
      const a = arrastre.current
      if (!a) return
      const dy = e.clientY - a.y0
      const dx = e.clientX - a.x0
      if (!a.movido && Math.abs(dy) < UMBRAL_PX && Math.abs(dx) < UMBRAL_PX) return
      a.movido = true
      const deltaMin = dy / PX
      if (a.tipo === 'estirar') {
        setBorrador({ id: a.id, inicio: a.inicio0, duracion: estirar(a.inicio0, a.dur0, deltaMin, largo), area: a.area0 })
        return
      }
      let area = a.area0
      const cont = carrilesRef.current
      const deAreas = lanes.filter((c) => !c.privado && c.clave !== 'sin_area')
      if (cont && deAreas.length) {
        const r = cont.getBoundingClientRect()
        const i = indiceCarril(e.clientX - r.left, r.width, lanes.length)
        const clave = lanes[i]?.clave
        if (clave && AREAS.some((x) => x.clave === clave && clave !== 'sin_area')) area = clave as AreaTarea
      }
      setBorrador({ id: a.id, inicio: mover(a.inicio0, a.dur0, deltaMin, largo), duracion: a.dur0, area })
    }
    function alSoltar() {
      const a = arrastre.current
      if (!a) return
      arrastre.current = null
      document.body.style.userSelect = ''
      setSeleccionId(a.id)
    }
    window.addEventListener('pointermove', alMover)
    window.addEventListener('pointerup', alSoltar)
    return () => {
      window.removeEventListener('pointermove', alMover)
      window.removeEventListener('pointerup', alSoltar)
    }
  }, [largo, lanes])

  function empezar(e: React.PointerEvent, b: Bloque, tipo: 'mover' | 'estirar') {
    if (!esGestor) {
      setSeleccionId(b.item.tarea.id)
      return
    }
    e.preventDefault()
    e.stopPropagation()
    const base = borrador && borrador.id === b.item.tarea.id ? borrador : null
    arrastre.current = {
      id: b.item.tarea.id,
      tipo,
      x0: e.clientX,
      y0: e.clientY,
      inicio0: base ? base.inicio : b.top,
      dur0: base ? base.duracion : b.item.tarea.duracion_min ?? 30,
      area0: base ? base.area : b.item.tarea.area,
      movido: false,
    }
    if (borrador && borrador.id !== b.item.tarea.id) setBorrador(null)
    document.body.style.userSelect = 'none'
  }

  /** Bloques de un carril, con el borrador aplicado a la tarea que se está moviendo. */
  function bloquesDe(clave: string): Bloque[] {
    const lane = lanes.find((c) => c.clave === clave)
    if (!lane) return []
    let lista = lane.tareas.filter((x) => !borrador || x.tarea.id !== borrador.id)
    if (borrador) {
      const x = items.find((i) => i.tarea.id === borrador.id)
      const destino = x?.tarea.privada ? 'privadas' : borrador.area ?? 'sin_area'
      if (x && destino === clave) {
        lista = [
          ...lista,
          {
            tarea: { ...x.tarea, area: borrador.area, duracion_min: borrador.duracion },
            derivado: { ...x.derivado, inicio: rango.desde + borrador.inicio },
          },
        ]
      }
    }
    return ubicar(lista, rango.desde)
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] items-start">
      <div className="space-y-3 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-[#6f3a2a]">Ver cómo queda el</span>
          <div className="inline-flex flex-wrap rounded-lg border border-[#e4c9b0] bg-white p-0.5" role="group" aria-label="Día de la semana">
            <button
              type="button"
              aria-pressed={dow === null}
              onClick={() => setDow(null)}
              className={cn('px-2.5 min-h-8 rounded-md text-xs font-semibold', dow === null ? 'bg-[#f9b44c] text-[#391511]' : 'text-[#6f3a2a]')}
            >
              Todos
            </button>
            {DIAS_SEMANA.map((d) => (
              <button
                key={d.n}
                type="button"
                aria-pressed={dow === d.n}
                onClick={() => setDow(d.n)}
                className={cn('px-2.5 min-h-8 rounded-md text-xs font-semibold', dow === d.n ? 'bg-[#f9b44c] text-[#391511]' : 'text-[#6f3a2a]')}
              >
                {d.largo}
              </button>
            ))}
          </div>
        </div>
        {esGestor && (
          <p className="text-[11px] text-[#8a6a5a]">
            Arrastrá una tarea para cambiarle la hora o el área y estirá su borde de abajo para cambiar la duración. Nada se
            guarda hasta que toques “Guardar cambios”.
          </p>
        )}

        {franja.length > 0 && (
          <div className="rounded-xl border border-[#e4c9b0]/60 bg-[#fdfaf6] px-3 py-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#6f3a2a] mb-1.5">Todo el turno</p>
            <div className="flex flex-wrap gap-1.5">
              {franja.map((x) => {
                const area = areaDe(x.tarea.area)
                return (
                  <button
                    key={x.tarea.id}
                    type="button"
                    onClick={() => setSeleccionId(x.tarea.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs min-h-8',
                      seAtenua(x.tarea.id) && 'opacity-40',
                      seleccionId === x.tarea.id && 'ring-2 ring-[#f9b44c]'
                    )}
                    style={{ borderColor: area.color, background: area.fondo }}
                  >
                    <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: area.color }} />
                    {x.tarea.titulo}
                    {x.tarea.tipo_actividad === 'continua' && <span className="text-[10px] text-[#6f3a2a]">· recordatorio</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-x-auto">
          <div className="grid min-w-full" style={{ gridTemplateColumns: `56px minmax(0, 1fr)` }}>
            <div className="border-b border-[#e4c9b0]/60" />
            <div className="grid border-b border-[#e4c9b0]/60" style={{ gridTemplateColumns: `repeat(${lanes.length}, minmax(140px, 1fr))` }}>
              {lanes.map((c) => (
                <div key={c.clave} className="border-l border-[#e4c9b0]/60 px-2.5 py-2 min-w-0">
                  <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-[#391511] truncate">
                    {c.privado ? (
                      <Lock className="h-3.5 w-3.5 shrink-0" style={{ color: c.color }} />
                    ) : (
                      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px] shrink-0" style={{ background: c.color }} />
                    )}
                    <span className="truncate">{c.titulo}</span>
                  </p>
                  <p className="text-[11px] text-[#6f3a2a]">{c.tareas.length} en la rutina</p>
                </div>
              ))}
            </div>

            <div className="relative" style={{ height: alto }}>
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
            <div
              ref={carrilesRef}
              className="grid touch-none"
              style={{ gridTemplateColumns: `repeat(${lanes.length}, minmax(140px, 1fr))` }}
            >
              {lanes.map((c) => (
                <div key={c.clave} className="relative border-l border-[#e4c9b0]/60" style={{ height: alto }}>
                  {marcas.map((m) => (
                    <div key={m} aria-hidden="true" className="absolute inset-x-0 border-t border-[#efe5da]" style={{ top: (m - rango.desde) * PX }} />
                  ))}
                  {bloquesDe(c.clave).map((b) => (
                    <BloqueRutina
                      key={b.item.tarea.id}
                      b={b}
                      privado={!!c.privado}
                      inicioTurno={rango.desde}
                      editado={borrador?.id === b.item.tarea.id}
                      elegida={seleccionId === b.item.tarea.id}
                      atenuada={seAtenua(b.item.tarea.id)}
                      editable={esGestor}
                      onEmpezar={empezar}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <aside className="xl:sticky xl:top-20">
        {seleccion ? (
          <PanelRutina
            key={seleccion.id}
            plantilla={seleccion}
            turno={turno}
            borrador={borrador?.id === seleccion.id ? borrador : null}
            esGestor={esGestor}
            esAdmin={esAdmin}
            nombres={nombres}
            onCerrar={() => {
              setSeleccionId(null)
              setBorrador(null)
            }}
            onGuardado={() => setBorrador(null)}
          />
        ) : (
          <section className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-4 space-y-1">
            <h3 className="text-[13px] font-extrabold text-[#391511]">Elegí una tarea</h3>
            <p className="text-xs text-[#6f3a2a]">Tocá una tarea del calendario o de “Todo el turno” para editarla.</p>
          </section>
        )}
      </aside>
    </div>
  )
}

function BloqueRutina({
  b,
  privado,
  inicioTurno,
  editado,
  elegida,
  atenuada,
  editable,
  onEmpezar,
}: {
  b: Bloque
  privado: boolean
  inicioTurno: number
  editado: boolean
  elegida: boolean
  atenuada: boolean
  editable: boolean
  onEmpezar: (e: React.PointerEvent, b: Bloque, tipo: 'mover' | 'estirar') => void
}) {
  const t = b.item.tarea
  const area = privado ? { color: '#7a1f2b', fondo: '#f8e5e7' } : areaDe(t.area)
  const ini = inicioTurno + b.top
  const ancho = 100 / b.cols
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${horaDeMinutos(ini)} ${t.titulo}${editado ? ', con cambios sin guardar' : ''}`}
      onPointerDown={(e) => onEmpezar(e, b, 'mover')}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onEmpezar(e as unknown as React.PointerEvent, b, 'mover')
      }}
      className={cn(
        'absolute z-[5] overflow-hidden rounded-lg border text-left px-2 select-none',
        editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        b.compacta ? 'py-0.5 flex items-center gap-1.5' : 'py-1.5',
        atenuada && 'opacity-35',
        editado && 'border-2 border-dashed shadow-lg z-[7]',
        elegida && !editado && 'ring-2 ring-[#391511] z-[6]'
      )}
      style={{
        top: b.top * PX + 1,
        height: b.alto * PX - 2,
        left: `calc(${b.col * ancho}% + 3px)`,
        width: `calc(${ancho}% - 6px)`,
        borderColor: editado ? '#391511' : area.color,
        background: area.fondo,
      }}
    >
      {b.compacta ? (
        <>
          <span className="font-mono text-[10.5px] font-semibold shrink-0">{horaDeMinutos(ini)}</span>
          <span className="truncate text-[11.5px] font-semibold">{t.titulo}</span>
        </>
      ) : (
        <>
          <span className="block font-mono text-[10.5px] font-semibold text-[#6f3a2a]">
            {horaDeMinutos(ini)}–{horaDeMinutos(ini + (t.duracion_min ?? 30))}
            {t.prioridad === 'alta' && <span className="text-[#c43e2c]"> ● alta</span>}
          </span>
          <span className="block text-[12.5px] font-bold leading-snug line-clamp-2">{t.titulo}</span>
        </>
      )}
      {editable && (
        <span
          aria-hidden="true"
          onPointerDown={(e) => onEmpezar(e, b, 'estirar')}
          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
        />
      )}
    </div>
  )
}
