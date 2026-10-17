'use client'

import { useState } from 'react'
import { Check, CheckCircle2, ChevronDown, Loader2, Play, Users, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SubirEvidencia } from './SubirEvidencia'
import { formatoHora, esCobertura } from './tareasConstantes'
import { horaDeMinutos, type TareaAgenda } from './tareasAgenda'
import { horaAr } from './asistenciaConstantes'
import { pasosHechos } from './miTurnoLogica'
import { useChecklistPaso, useCompletarTarea, useIniciarTarea, useNoSePudo } from '@/lib/hooks/useTareas'
import { cn } from '@/lib/utils'
import type { MotivoNoSePudo } from '@/types/database'

export const MOTIVOS_NO_SE_PUDO: { clave: MotivoNoSePudo; label: string }[] = [
  { clave: 'falto_insumo', label: 'Faltó insumo o mercadería' },
  { clave: 'no_alcanzo_tiempo', label: 'No alcanzó el tiempo' },
  { clave: 'se_rompio', label: 'Se rompió algo' },
  { clave: 'otro', label: 'Otro motivo' },
]

type Tono = 'rojo' | 'ahora' | 'normal'

/**
 * Tarjeta de una tarea en el celular (Tareas v2, Etapa 6). `grande` la muestra
 * abierta con los botones grandes (Completar / No se pudo); si no, se abre al
 * tocarla. Una tarea cerrada se ve chica, con la hora real o el motivo.
 */
export function TarjetaTareaMovil({
  item,
  empleadoId,
  grande = false,
  tono = 'normal',
  minutosTarde = 0,
}: {
  item: TareaAgenda
  empleadoId: number
  grande?: boolean
  tono?: Tono
  minutosTarde?: number
}) {
  const t = item.tarea
  const d = item.derivado
  const [abierta, setAbierta] = useState(grande)
  const [evidencia, setEvidencia] = useState<string | null>(t.evidencia_url)
  const [noSePudo, setNoSePudo] = useState(false)
  const [motivo, setMotivo] = useState<MotivoNoSePudo | null>(null)
  const [detalle, setDetalle] = useState('')
  const [conNota, setConNota] = useState(false)
  const [nota, setNota] = useState('')
  const completar = useCompletarTarea()
  const iniciar = useIniciarTarea()
  const noPudo = useNoSePudo()
  const paso = useChecklistPaso()
  const ocupado = completar.isPending || iniciar.isPending || noPudo.isPending
  const grupal = t.empleado_id === null
  const esBloque = t.tipo_actividad === 'bloque'
  const cerrada = ['completada', 'no_se_pudo', 'omitida', 'trasladada'].includes(d.estado)
  const hechos = pasosHechos(t.checklist ?? [], t.checklist_estado)
  const horario =
    d.inicio === null ? 'Todo el turno' : `${formatoHora(t.hora)}–${horaDeMinutos(d.limite ?? d.inicio)}`

  if (cerrada) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-[#e4c9b0]/50 bg-white/70 px-3 py-2.5">
        {d.estado === 'completada' ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#2f7d4f]" />
        ) : (
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#c8a58a]" />
        )}
        <div className="min-w-0 text-sm">
          <p className={cn('font-semibold text-[#391511]', d.estado === 'completada' && 'line-through decoration-[#2f7d4f]/50')}>
            {t.titulo}
          </p>
          <p className="text-xs text-[#6f3a2a]">
            {d.estado === 'completada'
              ? `Hecha a las ${horaAr(t.completada_at)}${grupal && t.completada_por !== empleadoId ? ' por un compañero' : ''}`
              : d.estado === 'no_se_pudo'
                ? `No se pudo: ${MOTIVOS_NO_SE_PUDO.find((m) => m.clave === t.motivo_no_se_pudo)?.label ?? 'otro motivo'}${t.detalle_motivo ? ` (“${t.detalle_motivo}”)` : ''}`
                : d.estado === 'trasladada'
                  ? 'Pasó al turno siguiente'
                  : 'Omitida'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'rounded-2xl border shadow-sm',
        tono === 'rojo' ? 'border-[#c43e2c]/50 bg-[#fbe2df]/60' : tono === 'ahora' ? 'border-[#f9b44c] bg-[#fff6e5]' : 'border-[#e4c9b0]/60 bg-white'
      )}
    >
      <button
        type="button"
        onClick={() => !grande && setAbierta((v) => !v)}
        aria-expanded={abierta}
        className={cn('flex w-full items-start gap-3 p-4 text-left', grande && 'cursor-default')}
      >
        <div className="min-w-0 flex-1">
          <p className={cn('text-[11px] font-bold uppercase tracking-wide', tono === 'rojo' ? 'text-[#a3271d]' : 'text-[#6f3a2a]')}>
            {horario}
            {d.estado === 'en_curso' && ' · en curso'}
            {minutosTarde > 0 && ` · ${minutosTarde} min tarde`}
          </p>
          <p className={cn('font-bold leading-snug text-[#391511]', grande ? 'text-lg' : 'text-[15px]', esBloque && 'italic')}>
            {t.titulo}
          </p>
          {t.prioridad === 'alta' && <span className="mt-1 inline-block rounded bg-[#c43e2c]/12 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#a3271d]">Importante</span>}
        </div>
        {!grande && <ChevronDown className={cn('mt-1 h-5 w-5 shrink-0 text-[#c8a58a] transition-transform', abierta && 'rotate-180')} />}
      </button>

      {abierta && (
        <div className="space-y-3 px-4 pb-4">
          {t.descripcion && <p className="text-sm text-[#6f3a2a]">{t.descripcion}</p>}
          {esCobertura(t.notas) && <p className="text-xs font-semibold text-[#2f7d4f]">↺ {t.notas}</p>}
          {grupal && (
            <p className="flex items-center gap-1 text-xs text-[#a06b00]">
              <Users className="h-3.5 w-3.5" /> Grupal: con que uno la marque alcanza.
            </p>
          )}
          {t.rechazos_count > 0 && t.motivo_rechazo && (
            <p className="rounded-xl border border-[#c43e2c]/25 bg-[#c43e2c]/8 px-3 py-2 text-sm text-[#6f3a2a]">
              <span className="font-bold text-[#a3271d]">Te la devolvieron:</span> “{t.motivo_rechazo}”
            </p>
          )}

          {(t.checklist ?? []).length > 0 && (
            <ul className="space-y-1.5">
              {t.checklist.map((c, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => paso.mutate({ id: t.id, paso: i, hecho: !hechos[i] })}
                    disabled={paso.isPending}
                    aria-pressed={hechos[i]}
                    className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-[#e4c9b0]/70 bg-white px-3 py-2 text-left text-sm text-[#391511]"
                  >
                    <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2', hechos[i] ? 'border-[#2f7d4f] bg-[#2f7d4f] text-white' : 'border-[#c8a58a]')}>
                      {hechos[i] && <Check className="h-4 w-4" />}
                    </span>
                    <span className={cn(hechos[i] && 'line-through text-[#6f3a2a]')}>{c}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {t.requiere_evidencia && <SubirEvidencia value={evidencia} onChange={setEvidencia} disabled={ocupado} />}

          {noSePudo ? (
            <div className="space-y-2 rounded-xl border border-[#e4c9b0] bg-white p-3">
              <p className="text-sm font-bold text-[#391511]">¿Por qué no se pudo?</p>
              <div className="grid grid-cols-2 gap-2">
                {MOTIVOS_NO_SE_PUDO.map((m) => (
                  <button
                    key={m.clave}
                    type="button"
                    onClick={() => setMotivo(m.clave)}
                    aria-pressed={motivo === m.clave}
                    className={cn('min-h-14 rounded-xl border-2 px-2 text-sm font-semibold', motivo === m.clave ? 'border-[#391511] bg-[#391511] text-white' : 'border-[#e4c9b0] bg-white text-[#391511]')}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <textarea
                value={detalle}
                onChange={(e) => setDetalle(e.target.value)}
                rows={2}
                placeholder="Detalle (opcional). Lo ve la encargada."
                className="w-full rounded-lg border border-[#e4c9b0] px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setNoSePudo(false)} className="h-12 flex-1 border-[#e4c9b0]">
                  Volver
                </Button>
                <Button
                  onClick={() => motivo && noPudo.mutate({ id: t.id, motivo, detalle: detalle.trim() || null })}
                  disabled={!motivo || ocupado}
                  className="h-12 flex-[2] bg-[#391511] font-bold text-white hover:bg-[#2a0f0c]"
                >
                  {noPudo.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Confirmar'}
                </Button>
              </div>
            </div>
          ) : (
            <>
              {conNota ? (
                <textarea
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                  rows={2}
                  placeholder="Nota para el próximo turno (se manda al completar)."
                  className="w-full rounded-lg border border-[#e4c9b0] px-3 py-2 text-sm"
                />
              ) : (
                !esBloque && (
                  <button type="button" onClick={() => setConNota(true)} className="text-xs text-[#6f3a2a] underline underline-offset-2">
                    Dejar una nota para el próximo turno
                  </button>
                )
              )}
              <div className="flex gap-2">
                <Button
                  onClick={() => completar.mutate({ id: t.id, evidenciaUrl: evidencia, nota: nota.trim() || null })}
                  disabled={ocupado || (t.requiere_evidencia && !evidencia)}
                  className="h-14 flex-[2] gap-2 bg-[#2f7d4f] text-base font-bold text-white hover:bg-[#276b43] disabled:opacity-50"
                >
                  {completar.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                  {t.requiere_evidencia && !evidencia ? 'Sacá la foto' : esBloque ? 'Hecho' : 'Completar'}
                </Button>
                {!esBloque && (
                  <Button
                    variant="outline"
                    onClick={() => setNoSePudo(true)}
                    disabled={ocupado}
                    className="h-14 flex-1 border-[#c43e2c]/40 font-bold text-[#a3271d]"
                  >
                    No se pudo
                  </Button>
                )}
              </div>
              {d.estado !== 'en_curso' && !esBloque && (
                <button
                  type="button"
                  onClick={() => iniciar.mutate(t.id)}
                  disabled={ocupado}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#6f3a2a]"
                >
                  <Play className="h-3.5 w-3.5" /> Marcar que la empecé
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
