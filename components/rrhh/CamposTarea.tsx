'use client'

import { Lock } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { MultiSelectEmpleados } from './MultiSelectEmpleados'
import { NOMBRE_TURNO, hoyAr } from './asistenciaConstantes'
import { DIAS_SEMANA, PRIORIDAD_TAREA } from './tareasConstantes'
import { AREAS } from './calendarioTurno'
import { PUESTOS_TAREA, variosPosibles, type FormNuevaTarea } from './nuevaTareaLogica'
import { isoMasDias } from '@/lib/utils/periodos'
import { cn } from '@/lib/utils'
import type { AreaTarea, PrioridadTarea, RolOperativo, TurnoPlantillaRow } from '@/types/database'

const claseInput = 'border-[#e4c9b0] focus-visible:ring-[#f9b44c]'

interface Props {
  f: FormNuevaTarea
  set: (p: Partial<FormNuevaTarea>) => void
  /** Administrador de tareas: puede marcar "Privada". */
  esAdmin: boolean
  turnos: TurnoPlantillaRow[]
  /** Empleados activos (para elegir personas). */
  empleados: { id: number; nombre: string }[]
  /** A quién le toca por puesto (o las personas elegidas), ya resuelto. */
  quienes: string[]
  buscando: boolean
  /** En la rutina, "privada" no se cambia desde el formulario de edición. */
  ocultarPrivada?: boolean
}

function toggle<T>(lista: T[], v: T): T[] {
  return lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]
}

/**
 * Campos de una tarea (Tareas v2): los comparten "Nueva tarea" (Etapa 3) y
 * el panel de edición de la rutina en calendario (Etapa 4).
 */
export function CamposTarea({ f, set, esAdmin, turnos, empleados, quienes, buscando, ocultarPrivada = false }: Props) {
  const activosTurnos = turnos
  const activos = empleados
  return (
    <>
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

      {esAdmin && !ocultarPrivada && (
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
              opciones={activos}
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

    </>
  )
}

export function Opcion({ activa, onClick, titulo, ayuda }: { activa: boolean; onClick: () => void; titulo: string; ayuda: string }) {
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

