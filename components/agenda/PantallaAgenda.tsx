'use client'

import { useMemo, useState } from 'react'
import {
  CalendarClock,
  CheckCircle2,
  Inbox,
  Loader2,
  Repeat,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { ModalTarea } from '@/components/proyectos/ModalTarea'
import { useAgenda } from '@/lib/hooks/useAgenda'
import { useCompletarTarea } from '@/lib/hooks/useProyectos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { tienePermiso } from '@/lib/permisos'
import { cn } from '@/lib/utils'
import type { TareaAgenda } from '@/lib/queries/agenda'

const COLOR_PRIORIDAD: Record<string, string> = {
  alta: 'bg-[#c43e2c]/15 text-[#c43e2c]',
  media: 'bg-[#f9b44c]/20 text-[#6f3a2a]',
  baja: 'bg-[#e4c9b0]/40 text-[#6f3a2a]',
}

interface Grupo {
  clave: string
  titulo: string
  subtitulo?: string
  tareas: TareaAgenda[]
  rojo?: boolean
}

export function PantallaAgenda() {
  const { data: usuario } = useUsuario()
  const esAdmin = tienePermiso(usuario?.permisos, 'configuracion')

  const [verTodas, setVerTodas] = useState(false)

  const { data: tareas, isLoading } = useAgenda(
    usuario?.id,
    esAdmin && verTodas
  )

  const [tareaSel, setTareaSel] = useState<TareaAgenda | null>(null)

  const grupos = useMemo(() => agruparTareas(tareas ?? []), [tareas])

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[#391511] text-2xl font-bold">Mi día</h1>
          <p className="text-[#6f3a2a] text-sm mt-1">
            Todo lo que tenés para hacer hoy, lo que está vencido y lo que viene.
          </p>
        </div>
        {esAdmin && (
          <div className="flex items-center gap-2">
            <Switch
              id="ver-todas"
              checked={verTodas}
              onCheckedChange={setVerTodas}
            />
            <Label
              htmlFor="ver-todas"
              className="text-xs text-[#6f3a2a] cursor-pointer"
            >
              Ver tareas de todos
            </Label>
          </div>
        )}
      </header>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 rounded-xl bg-[#f9d2a2]/30" />
          ))}
        </div>
      ) : (tareas ?? []).length === 0 ? (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-12 text-center">
          <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
            <Inbox className="h-6 w-6 text-[#6f3a2a]" />
          </div>
          <p className="text-[#391511] font-semibold">No hay tareas pendientes</p>
          <p className="text-[#6f3a2a] text-sm mt-1">
            Todo al día. Andá a un tablero para crear nuevas.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grupos.map((g) => (
            <GrupoSeccion
              key={g.clave}
              grupo={g}
              onAbrirTarea={(t) => setTareaSel(t)}
            />
          ))}
        </div>
      )}

      {tareaSel && (
        <ModalTarea
          abierto={!!tareaSel}
          onCambioAbierto={(v) => !v && setTareaSel(null)}
          proyectoId={tareaSel.proyecto_id}
          tarea={tareaSel}
        />
      )}
    </div>
  )
}

function GrupoSeccion({
  grupo,
  onAbrirTarea,
}: {
  grupo: Grupo
  onAbrirTarea: (t: TareaAgenda) => void
}) {
  if (grupo.tareas.length === 0) return null

  return (
    <section>
      <div className="flex items-baseline gap-2 px-1 pb-2 border-b border-[#e4c9b0]/60">
        <h2
          className={cn(
            'text-sm font-bold',
            grupo.rojo ? 'text-[#c43e2c]' : 'text-[#391511]'
          )}
        >
          {grupo.titulo}
        </h2>
        {grupo.subtitulo && (
          <span className="text-[11px] text-[#c8a58a]">{grupo.subtitulo}</span>
        )}
        <span className="ml-auto text-[11px] text-[#6f3a2a] tabular-nums">
          {grupo.tareas.length}
        </span>
      </div>

      <ul>
        {grupo.tareas.map((t) => (
          <FilaTarea key={t.id} tarea={t} onAbrir={() => onAbrirTarea(t)} />
        ))}
      </ul>
    </section>
  )
}

function FilaTarea({
  tarea,
  onAbrir,
}: {
  tarea: TareaAgenda
  onAbrir: () => void
}) {
  const completar = useCompletarTarea()

  const hoy = new Date().toISOString().slice(0, 10)
  const vencida = tarea.fecha_limite != null && tarea.fecha_limite < hoy

  return (
    <li className="group flex items-start gap-2 py-2.5 px-1 border-b border-[#e4c9b0]/40 hover:bg-[#fdfaf6] rounded">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          completar.mutate(tarea)
        }}
        disabled={completar.isPending}
        className="h-4 w-4 mt-1 shrink-0 rounded-full border-2 border-[#c8a58a] hover:border-[#2f8f4e] flex items-center justify-center transition-colors disabled:opacity-50"
        aria-label="Marcar como hecha"
      >
        {completar.isPending && (
          <Loader2 className="h-3 w-3 animate-spin text-[#6f3a2a]" />
        )}
      </button>

      <button
        type="button"
        onClick={onAbrir}
        className="flex-1 text-left min-w-0"
      >
        <p className="text-sm font-medium text-[#391511] leading-snug truncate">
          {tarea.titulo}
        </p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap text-[11px] text-[#6f3a2a]">
          {tarea.fecha_limite && (
            <span
              className={cn(
                'flex items-center gap-0.5 tabular-nums',
                vencida && 'text-[#c43e2c] font-bold'
              )}
            >
              <CalendarClock className="h-3 w-3" />
              {formatearDia(tarea.fecha_limite)}
            </span>
          )}
          {tarea.recurrencia !== 'none' && (
            <span className="flex items-center gap-0.5 text-[#c43e2c]">
              <Repeat className="h-3 w-3" />
              recurrente
            </span>
          )}
          <span className="text-[#c8a58a]">·</span>
          <span className="truncate">
            <span
              className="inline-block h-2 w-2 rounded-full mr-1 align-middle"
              style={{ backgroundColor: tarea.tablero_color }}
            />
            {tarea.tablero_nombre}
            {' / '}
            {tarea.proyecto_nombre}
          </span>
        </div>
      </button>

      <span
        className={cn(
          'text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded shrink-0 mt-1',
          COLOR_PRIORIDAD[tarea.prioridad] ?? COLOR_PRIORIDAD.media
        )}
      >
        {tarea.prioridad}
      </span>
    </li>
  )
}

// ─── Agrupación por fecha ────────────────────────────────────────────────────

function agruparTareas(tareas: TareaAgenda[]): Grupo[] {
  const hoy = nuevoHoy()
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const hoyStr = fmt(hoy)

  const manana = new Date(hoy)
  manana.setDate(manana.getDate() + 1)
  const mananaStr = fmt(manana)

  const dentro7 = new Date(hoy)
  dentro7.setDate(dentro7.getDate() + 7)
  const dentro7Str = fmt(dentro7)

  const vencidas: TareaAgenda[] = []
  const hoyArr: TareaAgenda[] = []
  const mananaArr: TareaAgenda[] = []
  const proximos: TareaAgenda[] = []
  const masAdelante: TareaAgenda[] = []
  const sinFecha: TareaAgenda[] = []

  for (const t of tareas) {
    if (!t.fecha_limite) {
      sinFecha.push(t)
      continue
    }
    if (t.fecha_limite < hoyStr) vencidas.push(t)
    else if (t.fecha_limite === hoyStr) hoyArr.push(t)
    else if (t.fecha_limite === mananaStr) mananaArr.push(t)
    else if (t.fecha_limite <= dentro7Str) proximos.push(t)
    else masAdelante.push(t)
  }

  return [
    {
      clave: 'vencidas',
      titulo: 'Vencidas',
      subtitulo: vencidas.length > 0 ? 'Atrasadas — reprogramá' : undefined,
      tareas: vencidas,
      rojo: true,
    },
    {
      clave: 'hoy',
      titulo: 'Hoy',
      subtitulo: formatearLargo(hoy),
      tareas: hoyArr,
    },
    {
      clave: 'manana',
      titulo: 'Mañana',
      subtitulo: formatearLargo(manana),
      tareas: mananaArr,
    },
    {
      clave: 'proximos',
      titulo: 'Próximos 7 días',
      tareas: proximos,
    },
    {
      clave: 'mas-adelante',
      titulo: 'Más adelante',
      tareas: masAdelante,
    },
    {
      clave: 'sin-fecha',
      titulo: 'Sin fecha',
      tareas: sinFecha,
    },
  ]
}

function nuevoHoy(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const MESES = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
]

function formatearDia(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return `${d.getDate()} ${MESES[d.getMonth()]}`
}

function formatearLargo(d: Date): string {
  return `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]}`
}

// Mantener iconos importados.
void CheckCircle2
