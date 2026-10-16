'use client'

import { useEffect, useState } from 'react'
import { Clock, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { NOMBRE_TURNO } from './asistenciaConstantes'
import { useTurnos, useUpdateTurno } from '@/lib/hooks/useAsistencia'
import type { TurnoPlantillaRow } from '@/types/database'

const claseInput = 'border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums h-9'

function FilaTurno({ turno }: { turno: TurnoPlantillaRow }) {
  const guardar = useUpdateTurno()
  const [inicio, setInicio] = useState(turno.hora_inicio.slice(0, 5))
  const [fin, setFin] = useState(turno.hora_fin.slice(0, 5))
  const [activo, setActivo] = useState(turno.activo)

  useEffect(() => {
    setInicio(turno.hora_inicio.slice(0, 5))
    setFin(turno.hora_fin.slice(0, 5))
    setActivo(turno.activo)
  }, [turno])

  const cruza = fin <= inicio
  const cambiado =
    inicio !== turno.hora_inicio.slice(0, 5) ||
    fin !== turno.hora_fin.slice(0, 5) ||
    activo !== turno.activo
  const valido = /^\d{2}:\d{2}$/.test(inicio) && /^\d{2}:\d{2}$/.test(fin) && inicio !== fin

  return (
    <li className="grid grid-cols-[1fr_auto] sm:grid-cols-[120px_1fr_1fr_auto_auto] gap-2 sm:gap-3 items-center px-4 py-3">
      <div className="min-w-0">
        <p className="text-[#391511] text-sm font-semibold">{NOMBRE_TURNO[turno.nombre]}</p>
        <p className="text-[11px] text-[#c8a58a]">
          {cruza ? 'Termina al día siguiente' : 'Mismo día'}
        </p>
      </div>
      <div className="flex items-center gap-2 sm:hidden justify-end">
        <Switch checked={activo} onCheckedChange={setActivo} aria-label="Turno activo" />
      </div>
      <label className="text-xs text-[#6f3a2a] space-y-1 col-span-2 sm:col-span-1">
        <span>Desde</span>
        <Input type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} className={claseInput} />
      </label>
      <label className="text-xs text-[#6f3a2a] space-y-1 col-span-2 sm:col-span-1">
        <span>Hasta</span>
        <Input type="time" value={fin} onChange={(e) => setFin(e.target.value)} className={claseInput} />
      </label>
      <div className="hidden sm:flex items-center gap-2 text-xs text-[#6f3a2a]">
        <Switch checked={activo} onCheckedChange={setActivo} aria-label="Turno activo" />
        Activo
      </div>
      <div className="col-span-2 sm:col-span-1 flex justify-end">
        <Button
          size="sm"
          onClick={() =>
            guardar.mutate({ id: turno.id, datos: { hora_inicio: inicio, hora_fin: fin, activo } })
          }
          disabled={!cambiado || !valido || guardar.isPending}
          className="h-8 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold text-xs disabled:opacity-40"
        >
          {guardar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Guardar'}
        </Button>
      </div>
    </li>
  )
}

/**
 * Horarios de turno (turnos_plantilla). Cambiar la hora de inicio mueve las
 * recurrentes cargadas como "minutos desde el inicio" en la próxima
 * sincronización; las cargadas con hora fija no se mueven.
 */
export function EditorTurnos() {
  const { data: turnos, isLoading } = useTurnos()
  return (
    <section className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden">
      <header className="px-4 py-3 border-b border-[#e4c9b0]/40 flex items-start gap-2">
        <Clock className="h-4 w-4 text-[#6f3a2a] mt-0.5 shrink-0" />
        <div>
          <h3 className="text-[#391511] text-sm font-bold">Horarios de turno</h3>
          <p className="text-[11px] text-[#6f3a2a]">
            Definen la cobertura de las 24 h. Si cambiás una hora de inicio, las tareas cargadas
            como “minutos desde el inicio del turno” se mueven en la próxima sincronización.
          </p>
        </div>
      </header>
      {isLoading ? (
        <p className="p-4 text-xs text-[#c8a58a]">Cargando…</p>
      ) : (
        <ul className="divide-y divide-[#e4c9b0]/40">
          {(turnos ?? []).map((t) => (
            <FilaTurno key={t.id} turno={t} />
          ))}
        </ul>
      )}
    </section>
  )
}
