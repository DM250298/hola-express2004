'use client'

import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Loader2, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MultiSelectEmpleados } from './MultiSelectEmpleados'
import { nombreCompleto } from './constantes'
import { NOMBRE_TURNO, hoyAr } from './asistenciaConstantes'
import { DIAS_SEMANA, PRIORIDAD_TAREA } from './tareasConstantes'
import { AREAS } from './calendarioTurno'
import {
  PUESTOS_TAREA,
  aPuntual,
  aRutina,
  formularioVacio,
  resumen,
  validar,
  variosPosibles,
  type FormNuevaTarea,
  type Frecuencia,
} from './nuevaTareaLogica'
import { useEmpleados } from '@/lib/hooks/useRrhh'
import { useTurnos } from '@/lib/hooks/useAsistencia'
import { useAQuienLeToca, useCrearTareaPuntual, useGuardarPlantilla } from '@/lib/hooks/useTareas'
import { isoMasDias } from '@/lib/utils/periodos'
import { cn } from '@/lib/utils'
import type { AreaTarea, PrioridadTarea, RolOperativo } from '@/types/database'
import type { DatosRutina } from '@/lib/queries/tareas'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Día que se está mirando en la agenda. */
  fechaDefault: string
  turnoDefault?: number | null
  frecuenciaInicial?: Frecuencia
  /** Administrador de tareas: puede crear privadas. */
  esAdmin: boolean
}

const claseInput = 'border-[#e4c9b0] focus-visible:ring-[#f9b44c]'

/**
 * "Nueva tarea" (Tareas v2, Etapa 3): de una sola vez o de la rutina,
 * con horario, área, quién la hace (puesto según el cronograma o personas)
 * y el resumen "Así va a quedar". Editar sigue en ModalTarea / ModalPlantilla.
 */
export function NuevaTarea({
  abierto,
  onCambioAbierto,
  fechaDefault,
  turnoDefault = null,
  frecuenciaInicial = 'una_vez',
  esAdmin,
}: Props) {
  const { data: turnos } = useTurnos()
  const { data: empleados } = useEmpleados()
  const crear = useCrearTareaPuntual()
  const guardarRutina = useGuardarPlantilla()
  const activosTurnos = useMemo(() => (turnos ?? []).filter((t) => t.activo), [turnos])

  const [f, setF] = useState<FormNuevaTarea>(() => formularioVacio(fechaDefault, turnoDefault, frecuenciaInicial))
  const [intento, setIntento] = useState(false)
  const set = (p: Partial<FormNuevaTarea>) => setF((x) => ({ ...x, ...p }))

  useEffect(() => {
    if (!abierto) return
    setF(formularioVacio(fechaDefault, turnoDefault ?? activosTurnos[0]?.id ?? null, frecuenciaInicial))
    setIntento(false)
    // Solo al abrir: no pisar lo que se está cargando.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto])

  const turno = activosTurnos.find((t) => t.id === f.turnoId) ?? null
  // Para "le toca a": el día elegido; en la rutina, mañana (desde cuándo rige).
  const fechaConsulta = f.frecuencia === 'una_vez' ? f.fecha : isoMasDias(hoyAr(), 1)
  const { data: leToca, isFetching: buscando } = useAQuienLeToca(
    fechaConsulta,
    f.turnoId,
    !f.privada && f.quien === 'puesto' ? f.puestos : []
  )

  const activos = (empleados ?? []).filter((e) => e.activo)
  const nombrePorId = new Map(activos.map((e) => [e.id, nombreCompleto(e)]))
  const quienes =
    f.quien === 'puesto'
      ? (leToca ?? []).map((p) => p.nombre)
      : f.personas.map((id) => nombrePorId.get(id) ?? `Legajo ${id}`)

  const errores = validar(f, turno)
  const procesando = crear.isPending || guardarRutina.isPending
  const lineas = resumen(f, {
    turno,
    nombreTurno: turno ? NOMBRE_TURNO[turno.nombre] : 'sin turno',
    diaLegible: f.fecha ? format(parseISO(f.fecha), "EEEE d/MM", { locale: es }) : '—',
    nombreArea: AREAS.find((a) => a.clave === f.area)?.nombre ?? 'Sin área',
    quienes,
  })

  function guardar() {
    setIntento(true)
    if (errores.length > 0 || procesando) return
    const cerrar = { onSuccess: () => onCambioAbierto(false) }
    if (f.frecuencia === 'una_vez') {
      crear.mutate(aPuntual(f), cerrar)
    } else {
      const { datos, asignados } = aRutina(f, esAdmin)
      guardarRutina.mutate({ id: null, datos: datos as DatosRutina, asignados, aplicar: 'manana' }, cerrar)
    }
  }

  function toggle<T>(lista: T[], v: T): T[] {
    return lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !procesando && onCambioAbierto(v)}>
      <DialogContent className="sm:max-w-xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">Nueva tarea</DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Elegí si es algo de una sola vez o si entra en la rutina del turno.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5 max-h-[68vh] overflow-y-auto text-sm">
          {/* Frecuencia */}
          <fieldset className="space-y-1.5">
            <legend className="text-[#391511] font-semibold text-sm mb-1.5">¿Cada cuánto se hace?</legend>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['una_vez', 'Solo una vez', 'Para un día y un turno.'],
                  ['rutina', 'Se repite', 'Entra en la rutina del turno.'],
                ] as [Frecuencia, string, string][]
              ).map(([v, l, ayuda]) => (
                <Opcion key={v} activa={f.frecuencia === v} onClick={() => set({ frecuencia: v })} titulo={l} ayuda={ayuda} />
              ))}
            </div>
          </fieldset>

          {/* Qué */}
          <div className="space-y-1.5">
            <Label htmlFor="nt-titulo" className="text-[#391511] font-semibold">Qué hay que hacer</Label>
            <Input
              id="nt-titulo"
              value={f.titulo}
              onChange={(e) => set({ titulo: e.target.value })}
              placeholder="Ej.: Controlar la temperatura de la heladera 3"
              className={claseInput}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nt-detalle" className="text-[#391511] font-semibold">
              Detalle <span className="font-normal text-[#8a6a5a]">(opcional)</span>
            </Label>
            <textarea
              id="nt-detalle"
              rows={2}
              value={f.detalle}
              onChange={(e) => set({ detalle: e.target.value })}
              className="w-full rounded-lg border border-[#e4c9b0] bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c]"
            />
          </div>

          {esAdmin && (
            <label className="flex items-start justify-between gap-3 rounded-xl border border-[#e4c9b0]/60 px-3 py-2.5 cursor-pointer">
              <span>
                <span className="flex items-center gap-1.5 font-semibold text-[#391511]">
                  <Lock className="h-3.5 w-3.5" /> Privada: solo administradores
                </span>
                <span className="block text-xs text-[#6f3a2a]">
                  No aparece en la agenda de la encargada ni en los celulares del equipo.
                </span>
              </span>
              <Switch checked={f.privada} onCheckedChange={(v) => set({ privada: v })} />
            </label>
          )}

          {/* Cuándo */}
          <div className="grid grid-cols-2 gap-3">
            {f.frecuencia === 'una_vez' ? (
              <div className="space-y-1.5">
                <Label htmlFor="nt-dia" className="text-[#391511] font-semibold">Día</Label>
                <Input
                  id="nt-dia"
                  type="date"
                  value={f.fecha}
                  min={isoMasDias(hoyAr(), -1)}
                  onChange={(e) => set({ fecha: e.target.value })}
                  className={`${claseInput} tabular-nums`}
                />
              </div>
            ) : (
              <fieldset className="space-y-1.5 col-span-2">
                <legend className="text-[#391511] font-semibold mb-1.5">Qué días</legend>
                <div className="flex flex-wrap gap-1.5">
                  {DIAS_SEMANA.map((d) => (
                    <button
                      key={d.n}
                      type="button"
                      aria-pressed={f.dias.includes(d.n)}
                      onClick={() => set({ dias: toggle(f.dias, d.n) })}
                      className={cn(
                        'h-10 w-10 rounded-lg text-sm font-bold',
                        f.dias.includes(d.n) ? 'bg-[#f9b44c] text-[#391511]' : 'bg-[#fdfaf6] border border-[#e4c9b0] text-[#6f3a2a]'
                      )}
                    >
                      {d.corto}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-[#6f3a2a]">Se suma a la rutina desde la agenda de mañana. La de hoy no cambia.</p>
              </fieldset>
            )}
            <div className={cn('space-y-1.5', f.frecuencia === 'rutina' && 'col-span-2')}>
              <Label className="text-[#391511] font-semibold">Turno</Label>
              <div className="flex flex-wrap gap-1.5">
                {activosTurnos.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={f.turnoId === t.id}
                    onClick={() => set({ turnoId: t.id })}
                    className={cn(
                      'rounded-lg px-3 min-h-10 text-xs font-semibold',
                      f.turnoId === t.id ? 'bg-[#f9b44c] text-[#391511]' : 'bg-[#fdfaf6] border border-[#e4c9b0] text-[#6f3a2a]'
                    )}
                  >
                    {NOMBRE_TURNO[t.nombre]} · {t.hora_inicio.slice(0, 2)} a {t.hora_fin.slice(0, 2)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Horario */}
          <fieldset className="space-y-2">
            <legend className="text-[#391511] font-semibold mb-1.5">Horario</legend>
            <div className="grid grid-cols-2 gap-2">
              <Opcion activa={f.horario === 'con_horario'} onClick={() => set({ horario: 'con_horario' })} titulo="Con horario" ayuda="Desde y hasta." />
              <Opcion
                activa={f.horario === 'todo_el_turno'}
                onClick={() => set({ horario: 'todo_el_turno' })}
                titulo="En cualquier momento"
                ayuda="Del turno, sin hora fija."
              />
            </div>
            {f.horario === 'con_horario' ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="nt-desde" className="text-xs text-[#6f3a2a]">Desde</Label>
                  <Input id="nt-desde" type="time" value={f.desde} onChange={(e) => set({ desde: e.target.value })} className={`${claseInput} tabular-nums`} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="nt-hasta" className="text-xs text-[#6f3a2a]">Hasta</Label>
                  <Input id="nt-hasta" type="time" value={f.hasta} onChange={(e) => set({ hasta: e.target.value })} className={`${claseInput} tabular-nums`} />
                </div>
                <p className="col-span-2 text-xs text-[#6f3a2a]">En la agenda ocupa el alto de este horario.</p>
              </div>
            ) : (
              <label className="flex items-center justify-between gap-3 rounded-xl border border-[#e4c9b0]/60 px-3 py-2 cursor-pointer">
                <span className="text-xs text-[#6f3a2a]">
                  <strong className="text-[#391511]">Es un recordatorio</strong>: va en la franja “Todo el turno” y no se marca.
                </span>
                <Switch checked={f.recordatorio} onCheckedChange={(v) => set({ recordatorio: v })} />
              </label>
            )}
          </fieldset>

          {/* Área */}
          <fieldset className="space-y-1.5">
            <legend className="text-[#391511] font-semibold mb-1.5">Área</legend>
            <div className="grid grid-cols-2 gap-1.5">
              {AREAS.filter((a) => a.clave !== 'sin_area').map((a) => (
                <button
                  key={a.clave}
                  type="button"
                  aria-pressed={f.area === a.clave}
                  onClick={() => set({ area: a.clave as AreaTarea })}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 min-h-10 text-left text-xs font-semibold',
                    f.area === a.clave ? 'ring-2 ring-[#391511]' : ''
                  )}
                  style={{ borderColor: a.color, background: a.fondo }}
                >
                  <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px]" style={{ background: a.color }} />
                  {a.nombre}
                </button>
              ))}
            </div>
          </fieldset>

          {/* Quién */}
          {f.privada ? (
            <p className="rounded-xl bg-[#f8e5e7] px-3 py-2 text-xs text-[#7a1f2b]">
              <strong>Quién la hace:</strong> vos. Las privadas solo las ven y las hacen los administradores.
            </p>
          ) : (
            <fieldset className="space-y-2">
              <legend className="text-[#391511] font-semibold mb-1.5">Quién la hace</legend>
              <div className="grid grid-cols-2 gap-2">
                <Opcion activa={f.quien === 'puesto'} onClick={() => set({ quien: 'puesto' })} titulo="Por puesto" ayuda="Según el cronograma." />
                <Opcion activa={f.quien === 'persona'} onClick={() => set({ quien: 'persona' })} titulo="Persona" ayuda="Alguien en particular." />
              </div>
              {f.quien === 'puesto' ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {PUESTOS_TAREA.map((p) => (
                      <button
                        key={p.clave}
                        type="button"
                        aria-pressed={f.puestos.includes(p.clave)}
                        onClick={() => set({ puestos: toggle<RolOperativo>(f.puestos, p.clave) })}
                        className={cn(
                          'rounded-lg px-3 min-h-10 text-xs font-semibold',
                          f.puestos.includes(p.clave) ? 'bg-[#f9b44c] text-[#391511]' : 'bg-[#fdfaf6] border border-[#e4c9b0] text-[#6f3a2a]'
                        )}
                      >
                        {p.nombre}
                      </button>
                    ))}
                  </div>
                  {f.puestos.length > 0 && (
                    <p className="text-xs text-[#6f3a2a]">
                      {buscando
                        ? 'Buscando en el cronograma…'
                        : quienes.length
                          ? `${f.frecuencia === 'una_vez' ? 'Ese día' : 'Mañana'} le toca a ${quienes.join(', ')}. Si hay franco o cambio de turno, pasa sola a quien cubra.`
                          : 'Nadie de ese puesto figura en el cronograma de ese turno todavía.'}
                    </p>
                  )}
                </>
              ) : (
                <MultiSelectEmpleados
                  opciones={activos.map((e) => ({ id: e.id, nombre: nombreCompleto(e) }))}
                  seleccionados={f.personas}
                  onCambio={(ids) => set({ personas: ids })}
                  todos={false}
                  onCambioTodos={(v) => v && set({ personas: activos.map((e) => e.id) })}
                />
              )}
              {variosPosibles(f) && (
                <div className="grid grid-cols-2 gap-2">
                  <Opcion activa={f.modo === 'individual'} onClick={() => set({ modo: 'individual' })} titulo="Cada uno" ayuda="Cada uno marca la suya." />
                  <Opcion activa={f.modo === 'grupal'} onClick={() => set({ modo: 'grupal' })} titulo="Grupal" ayuda="Con que uno la marque alcanza." />
                </div>
              )}
            </fieldset>
          )}

          {/* Prioridad y extras */}
          <fieldset className="space-y-2">
            <legend className="text-[#391511] font-semibold mb-1.5">Prioridad</legend>
            <div className="flex gap-1.5">
              {(['baja', 'media', 'alta'] as PrioridadTarea[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={f.prioridad === p}
                  onClick={() => set({ prioridad: p, avisar: p === 'alta' ? true : f.avisar })}
                  className={cn(
                    'rounded-lg px-4 min-h-10 text-xs font-bold',
                    f.prioridad === p ? PRIORIDAD_TAREA[p].clase + ' ring-2 ring-[#391511]' : 'bg-[#fdfaf6] border border-[#e4c9b0] text-[#6f3a2a]'
                  )}
                >
                  {PRIORIDAD_TAREA[p].label}
                </button>
              ))}
            </div>
            {!(f.horario === 'todo_el_turno' && f.recordatorio) && (
              <>
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span className="text-[#391511]">Avisar si se atrasa más de 15 minutos</span>
                  <Switch checked={f.avisar} onCheckedChange={(v) => set({ avisar: v })} />
                </label>
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span className="text-[#391511]">Pedir foto al completarla</span>
                  <Switch checked={f.foto} onCheckedChange={(v) => set({ foto: v })} />
                </label>
              </>
            )}
          </fieldset>

          {/* Así va a quedar */}
          <section className="rounded-xl border border-[#e4c9b0] bg-[#fdfaf6] px-3.5 py-3 space-y-1">
            <h3 className="text-[13px] font-extrabold text-[#391511]">Así va a quedar</h3>
            {lineas.map((l, i) => (
              <p key={i} className={cn('text-[13px]', i === 0 ? 'font-semibold text-[#391511]' : 'text-[#6f3a2a]')}>
                {l}
              </p>
            ))}
          </section>

          {intento && errores.length > 0 && (
            <ul className="rounded-xl border border-[#c43e2c]/40 bg-[#c43e2c]/5 px-3.5 py-2.5 text-xs text-[#a3271d] space-y-0.5" role="alert">
              {errores.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {!esAdmin && (
            <p className="text-xs text-[#6f3a2a]">Lo que cargues queda en el registro de cambios y los administradores lo ven.</p>
          )}
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button variant="outline" onClick={() => onCambioAbierto(false)} disabled={procesando} className="flex-1 border-[#e4c9b0] text-[#6f3a2a]">
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={procesando} className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold">
            {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar tarea'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Opcion({ activa, onClick, titulo, ayuda }: { activa: boolean; onClick: () => void; titulo: string; ayuda: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={cn(
        'rounded-xl border px-3 py-2.5 text-left transition-colors',
        activa ? 'border-[#f9b44c] bg-[#f9b44c]/15' : 'border-[#e4c9b0]/60 bg-[#fdfaf6]'
      )}
    >
      <span className="block text-sm font-semibold text-[#391511]">{titulo}</span>
      <span className="block text-[11px] text-[#6f3a2a] mt-0.5">{ayuda}</span>
    </button>
  )
}
