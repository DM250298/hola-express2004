'use client'

import { useEffect, useState } from 'react'
import { Loader2, Lock, Pencil, Pin, Repeat, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SubirEvidencia } from './SubirEvidencia'
import { ESTADO_DERIVADO, PRIORIDAD_TAREA, formatoDuracion } from './tareasConstantes'
import { horaDeMinutos, type TareaAgenda } from './tareasAgenda'
import { areaDe, minutosAtraso } from './calendarioTurno'
import { horaAr } from './asistenciaConstantes'
import {
  useChecklistPaso,
  useCompletarTarea,
  useHistorialTarea,
  useIniciarTarea,
  useNoSePudo,
  useNotaTarea,
  useReabrirTarea,
} from '@/lib/hooks/useTareas'
import { cn } from '@/lib/utils'
import type { ContextoReloj } from './tareasAgenda'
import type { MotivoNoSePudo, TareaHistorialRow } from '@/types/database'

interface Props {
  item: TareaAgenda
  reloj: ContextoReloj
  /** id → nombre de los empleados (para dueños e historial). */
  nombres: Map<number, string>
  /** Encargada o administrador: opera cualquier tarea y puede reabrir y editar. */
  esGestor: boolean
  /** Legajo de quien mira (para "en nombre de"). */
  empleadoActualId: number | null
  /** Nombre corto de quien mira, para el aviso "marcada por X". */
  actorNombre: string | null
  onEditar?: () => void
  onCerrar: () => void
}

const MOTIVOS: { clave: MotivoNoSePudo; label: string }[] = [
  { clave: 'falto_insumo', label: 'Faltó insumo o mercadería' },
  { clave: 'no_alcanzo_tiempo', label: 'No alcanzó el tiempo' },
  { clave: 'se_rompio', label: 'Se rompió algo' },
  { clave: 'otro', label: 'Otro motivo' },
]

const VERBO: Record<string, string> = {
  creada: 'la cargó',
  editada: 'la editó',
  iniciada: 'la inició',
  completada: 'la completó',
  no_se_pudo: 'marcó "No se pudo"',
  reabierta: 'la volvió a abrir',
  cancelada: 'la canceló',
  reasignada: 'la reasignó',
  rechazada: 'la rechazó',
  trasladada: 'la trasladó',
  hora_corregida: 'corrigió la hora',
  checklist_paso: 'tildó un paso',
  nota_editada: 'dejó una nota',
  aviso_atraso: 'avisó el atraso',
}

function textoEvento(h: TareaHistorialRow): string {
  const quien = h.actor_nombre ?? 'HEX'
  const verbo = VERBO[h.tipo] ?? h.tipo.replace(/_/g, ' ')
  const nombre = h.en_nombre_de ? ` en nombre de ${h.en_nombre_de}` : ''
  const motivo = h.motivo ? `: ${h.motivo}` : ''
  return `${quien} ${verbo}${nombre}${motivo}`
}

/** Detalle de una tarea en el panel lateral de la agenda (Tareas v2, Etapa 2). */
export function DetalleTarea({
  item,
  reloj,
  nombres,
  esGestor,
  empleadoActualId,
  actorNombre,
  onEditar,
  onCerrar,
}: Props) {
  const t = item.tarea
  const d = item.derivado
  const iniciar = useIniciarTarea()
  const completar = useCompletarTarea()
  const reabrir = useReabrirTarea()
  const noSePudo = useNoSePudo()
  const paso = useChecklistPaso()
  const nota = useNotaTarea()
  const { data: historial, isLoading: cargandoHist } = useHistorialTarea(t.id)

  const [motivoAbierto, setMotivoAbierto] = useState(false)
  const [motivo, setMotivo] = useState<MotivoNoSePudo>('falto_insumo')
  const [detalle, setDetalle] = useState('')
  const [textoNota, setTextoNota] = useState(t.nota_proximo_turno ?? '')
  const [evidencia, setEvidencia] = useState<string | null>(null)

  useEffect(() => {
    setMotivoAbierto(false)
    setDetalle('')
    setTextoNota(t.nota_proximo_turno ?? '')
    setEvidencia(null)
  }, [t.id, t.nota_proximo_turno])

  const duenos =
    t.empleado_id !== null ? [t.empleado_id] : (t.tareas_turno_participantes ?? []).map((p) => p.empleado_id)
  const esMia = empleadoActualId !== null && duenos.includes(empleadoActualId)
  const puedeOperar = esGestor || esMia
  const recordatorio = t.tipo_actividad === 'continua'
  const abierta = ['pendiente', 'en_curso', 'vencida'].includes(t.estado)
  const cerrada = ['completada', 'no_se_pudo', 'cancelada', 'vencida'].includes(t.estado)
  const ocupado = iniciar.isPending || completar.isPending || reabrir.isPending || noSePudo.isPending
  const atraso = minutosAtraso(item, reloj)
  const area = areaDe(t.area)

  const horario =
    d.inicio === null
      ? 'Todo el turno'
      : `${horaDeMinutos(d.inicio)} a ${horaDeMinutos(d.inicio + (t.duracion_min ?? 0))}${
          t.duracion_min ? ` · ${formatoDuracion(t.duracion_min)}` : ''
        }`
  const estado = ESTADO_DERIVADO[d.estado]
  const checklist = t.checklist ?? []
  const estadoPasos = (t.checklist_estado ?? []) as boolean[]
  const hechos = checklist.filter((_, i) => estadoPasos[i]).length
  const nombresDuenos = duenos.map((id) => nombres.get(id) ?? `Legajo ${id}`)
  const avisoEnNombre =
    abierta && !recordatorio && !esMia && duenos.length > 0 && puedeOperar
      ? `Si la marcás vos, queda registrado: marcada por ${actorNombre ?? 'vos'} en nombre de ${nombresDuenos.join(' y ')}.`
      : null

  return (
    <section
      aria-label="Detalle de la tarea"
      className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-4 space-y-4 text-sm text-[#391511]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-[#6f3a2a]">Detalle de la tarea</span>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar el detalle"
          className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-[#e4c9b0] hover:bg-[#fdfaf6]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {t.privada ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold rounded-full px-2.5 py-0.5 bg-[#7a1f2b] text-white">
            <Lock className="h-3 w-3" /> Privada
          </span>
        ) : t.origen === 'puntual' ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold rounded-full px-2.5 py-0.5 bg-[#f8e5e7] text-[#7a1f2b] border border-dashed border-[#8a2733]">
            <Pin className="h-3 w-3" /> Puntual · solo este día
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold rounded-full px-2.5 py-0.5 bg-[#f3ece5] text-[#5d4d44]">
            <Repeat className="h-3 w-3" /> Rutina
          </span>
        )}
        <span className={cn('text-[11px] font-bold rounded-full px-2.5 py-0.5', PRIORIDAD_TAREA[t.prioridad].clase)}>
          Prioridad {PRIORIDAD_TAREA[t.prioridad].label.toLowerCase()}
        </span>
        <span className={cn('text-[11px] font-bold rounded-full px-2.5 py-0.5', estado.clase)}>
          {recordatorio ? 'Recordatorio' : atraso > 0 ? `Atrasada ${atraso} min` : estado.label}
        </span>
      </div>

      <h2 className="text-lg font-extrabold leading-snug">{t.titulo}</h2>

      <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
        <dt className="text-[#6f3a2a] font-semibold">Horario</dt>
        <dd className="font-mono font-semibold">{horario}</dd>
        <dt className="text-[#6f3a2a] font-semibold">Área</dt>
        <dd className="flex items-center gap-2">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px] shrink-0" style={{ background: area.color }} />
          {area.nombre}
        </dd>
        <dt className="text-[#6f3a2a] font-semibold">Quién</dt>
        <dd>{t.privada ? 'Un administrador' : nombresDuenos.length ? nombresDuenos.join(', ') : 'Sin asignar'}</dd>
        <dt className="text-[#6f3a2a] font-semibold">Modo</dt>
        <dd>{t.empleado_id === null && !t.privada ? 'Grupal: con que uno la marque alcanza' : 'Individual'}</dd>
      </dl>

      {t.notas && <p className="text-xs text-[#6f3a2a]">↺ {t.notas}</p>}
      {t.descripcion && (
        <p className="rounded-lg bg-[#fdfaf6] px-3 py-2 text-[13px] text-[#4a2a20]">{t.descripcion}</p>
      )}
      {t.estado === 'no_se_pudo' && (
        <p className="rounded-lg bg-[#f1ebe5] px-3 py-2 text-[13px]">
          <strong>No se pudo:</strong>{' '}
          {MOTIVOS.find((m) => m.clave === t.motivo_no_se_pudo)?.label ?? 'Otro motivo'}
          {t.detalle_motivo ? ` · ${t.detalle_motivo}` : ''}
        </p>
      )}
      {recordatorio && (
        <p className="rounded-lg bg-[#fdfaf6] px-3 py-2 text-[13px] text-[#6f3a2a]">
          Es un recordatorio de todo el turno: no se marca.
        </p>
      )}

      {checklist.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[13px] font-extrabold">Pasos</h3>
            <span className="text-xs text-[#6f3a2a]">
              {hechos} de {checklist.length}
            </span>
          </div>
          {checklist.map((texto, i) => {
            const id = `paso-${t.id}-${i}`
            const hecho = !!estadoPasos[i]
            return (
              <label
                key={id}
                htmlFor={id}
                className="flex items-center gap-2.5 min-h-11 px-2.5 py-2 rounded-lg border border-[#e4c9b0]/70 cursor-pointer"
              >
                <input
                  id={id}
                  type="checkbox"
                  checked={hecho}
                  disabled={!abierta || !puedeOperar || paso.isPending}
                  onChange={() => paso.mutate({ id: t.id, paso: i, hecho: !hecho })}
                  className="h-[18px] w-[18px] accent-[#2f7d4f]"
                />
                <span className={cn(hecho && 'line-through text-[#6f3a2a]')}>{texto}</span>
              </label>
            )
          })}
        </div>
      )}

      {avisoEnNombre && (
        <p className="rounded-lg border border-[#f3d395] bg-[#fff6e5] px-3 py-2 text-[12.5px] text-[#4a3008]">
          {avisoEnNombre}
        </p>
      )}

      {/* Acciones */}
      {puedeOperar && !recordatorio && !motivoAbierto && (
        <div className="space-y-2">
          {abierta && t.requiere_evidencia && (
            <SubirEvidencia value={evidencia} onChange={setEvidencia} disabled={completar.isPending} />
          )}
          <div className="flex flex-wrap gap-2">
            {abierta && t.estado !== 'en_curso' && (
              <Button
                variant="outline"
                onClick={() => iniciar.mutate(t.id)}
                disabled={ocupado}
                className="min-h-11 border-[#391511] text-[#391511] font-bold"
              >
                Iniciar
              </Button>
            )}
            {abierta && (
              <Button
                onClick={() => completar.mutate({ id: t.id, evidenciaUrl: evidencia })}
                disabled={ocupado || (t.requiere_evidencia && !evidencia)}
                className="min-h-11 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-extrabold"
              >
                {completar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Completar'}
              </Button>
            )}
            {abierta && (
              <Button
                variant="outline"
                onClick={() => setMotivoAbierto(true)}
                disabled={ocupado}
                className="min-h-11 border-[#e2b3ad] text-[#a3271d] font-bold"
              >
                No se pudo
              </Button>
            )}
            {esGestor && cerrada && !t.trasladada_a && (
              <Button
                variant="outline"
                onClick={() => reabrir.mutate(t.id)}
                disabled={ocupado}
                className="min-h-11 border-[#e4c9b0] font-bold"
              >
                Volver a abrir
              </Button>
            )}
            {esGestor && onEditar && (
              <Button variant="ghost" onClick={onEditar} className="min-h-11 gap-1.5 text-[#6f3a2a]">
                <Pencil className="h-4 w-4" /> Editar
              </Button>
            )}
          </div>
        </div>
      )}

      {motivoAbierto && (
        <fieldset className="rounded-xl border border-[#e2b3ad] bg-[#fff7f6] px-3.5 pb-3.5 pt-2 space-y-2">
          <legend className="px-1.5 text-[13px] font-extrabold text-[#a3271d]">¿Por qué no se pudo?</legend>
          {MOTIVOS.map((m) => (
            <label key={m.clave} className="flex items-center gap-2.5 min-h-9 cursor-pointer">
              <input
                type="radio"
                name={`motivo-${t.id}`}
                checked={motivo === m.clave}
                onChange={() => setMotivo(m.clave)}
                className="h-4 w-4 accent-[#a3271d]"
              />
              {m.label}
            </label>
          ))}
          <label htmlFor={`detalle-${t.id}`} className="block text-xs font-bold text-[#6f3a2a] pt-1">
            Contá qué pasó (opcional)
          </label>
          <textarea
            id={`detalle-${t.id}`}
            rows={2}
            value={detalle}
            onChange={(e) => setDetalle(e.target.value)}
            placeholder="Ej.: no llegaron los carteles de la imprenta"
            className="w-full rounded-lg border border-[#e4c9b0] bg-white px-3 py-2 text-[13px]"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                noSePudo.mutate(
                  { id: t.id, motivo, detalle: detalle.trim() || null },
                  { onSuccess: () => setMotivoAbierto(false) }
                )
              }
              disabled={noSePudo.isPending}
              className="min-h-11 bg-[#a3271d] hover:bg-[#8a2018] text-white font-extrabold"
            >
              {noSePudo.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirmar'}
            </Button>
            <Button variant="outline" onClick={() => setMotivoAbierto(false)} className="min-h-11 border-[#e4c9b0]">
              Volver
            </Button>
          </div>
        </fieldset>
      )}

      {/* Nota para el próximo turno */}
      {puedeOperar && !t.privada && (
        <div className="space-y-1.5">
          <label htmlFor={`nota-${t.id}`} className="block text-[13px] font-extrabold">
            Nota para el próximo turno
          </label>
          <textarea
            id={`nota-${t.id}`}
            rows={2}
            value={textoNota}
            onChange={(e) => setTextoNota(e.target.value)}
            placeholder="Ej.: quedaron 10 milanesas sin rotular"
            className="w-full rounded-lg border border-[#e4c9b0] bg-white px-3 py-2 text-[13px]"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-[#6f3a2a]">Aparece en el pase de turno.</span>
            {textoNota.trim() !== (t.nota_proximo_turno ?? '') && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => nota.mutate({ id: t.id, nota: textoNota.trim() || null })}
                disabled={nota.isPending}
                className="border-[#e4c9b0]"
              >
                Guardar nota
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Historial */}
      <div className="border-t border-[#e4c9b0]/60 pt-3 space-y-1.5">
        <h3 className="text-[13px] font-extrabold">Historial</h3>
        {cargandoHist ? (
          <p className="text-xs text-[#6f3a2a]">Cargando…</p>
        ) : (historial ?? []).length === 0 ? (
          <p className="text-xs text-[#6f3a2a]">Sin cambios registrados. La generó la rutina.</p>
        ) : (
          <ol className="space-y-1">
            {(historial ?? []).map((h) => (
              <li key={h.id} className="flex gap-2.5 text-[12.5px]">
                <span className="font-mono font-semibold text-[#6f3a2a] shrink-0 min-w-[42px]">{horaAr(h.created_at)}</span>
                <span>{textoEvento(h)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
