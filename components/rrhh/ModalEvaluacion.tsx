'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useGuardarEvaluacion } from '@/lib/hooks/useDesempeno'
import { useUsuario } from '@/lib/hooks/useUsuario'
import type { EvaluacionCalculadaRow } from '@/types/database'
import { ScoreBadge, formatearScore } from './ScoreDesempeno'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Empleado a evaluar (con sus componentes auto ya calculados). */
  fila: EvaluacionCalculadaRow | null
  /** Período YYYY-MM. */
  periodo: string
}

const nombreCompleto = (f: EvaluacionCalculadaRow) =>
  [f.nombre, f.apellido].filter(Boolean).join(' ')

export function ModalEvaluacion({
  abierto,
  onCambioAbierto,
  fila,
  periodo,
}: Props) {
  const { data: usuario } = useUsuario()
  const guardar = useGuardarEvaluacion()

  const [manual, setManual] = useState('')
  const [comentario, setComentario] = useState('')

  useEffect(() => {
    if (abierto && fila) {
      setManual(fila.puntaje_manual != null ? String(fila.puntaje_manual) : '')
      setComentario(fila.comentario ?? '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, fila?.empleado_id])

  if (!fila) return null

  const manualTrim = manual.trim()
  const manualNum = manualTrim === '' ? null : Number(manualTrim)
  const manualInvalido =
    manualNum != null && (Number.isNaN(manualNum) || manualNum < 0 || manualNum > 100)
  const puedeGuardar = !manualInvalido && !guardar.isPending

  function onGuardar() {
    if (!puedeGuardar || !fila) return
    guardar.mutate(
      {
        empleadoId: fila.empleado_id,
        periodo,
        puntajeManual: manualNum,
        comentario: comentario.trim() || null,
        usuarioId: usuario?.id ?? null,
      },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !guardar.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">
            Evaluar a {nombreCompleto(fila)}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Desempeño del período {periodo}. La asistencia y las tareas se
            calculan solas; vos cargás la evaluación personal.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5">
          {/* Componentes automáticos */}
          <div className="grid grid-cols-2 gap-3">
            <ComponenteAuto
              titulo="Asistencia"
              valor={fila.puntaje_asistencia}
              detalle={`${fila.tardanzas} tard. · ${fila.ausencias} aus. · ${fila.incompletos} inc.`}
            />
            <ComponenteAuto
              titulo="Tareas"
              valor={fila.puntaje_tareas}
              detalle={`${fila.tareas_completadas}/${fila.tareas_asignadas} completadas`}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Evaluación personal (0 a 100)
            </Label>
            <Input
              type="number"
              min="0"
              max="100"
              step="1"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="Ej: 85 — dejá vacío si no la evaluás todavía"
              disabled={guardar.isPending}
              className="tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
            {manualInvalido && (
              <p className="text-[#c43e2c] text-xs">
                El puntaje debe estar entre 0 y 100.
              </p>
            )}
            <p className="text-[#c8a58a] text-xs">
              Trato al cliente, prolijidad, actitud, iniciativa. Si la dejás
              vacía, el total se calcula sólo con asistencia y tareas.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Comentario (opcional)
            </Label>
            <textarea
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              rows={3}
              placeholder="Notas para el legajo: logros, cosas a mejorar…"
              disabled={guardar.isPending}
              className="w-full rounded-md border border-[#e4c9b0] bg-white px-3 py-2 text-sm text-[#391511] placeholder:text-[#c8a58a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c] disabled:opacity-50 resize-none"
            />
          </div>
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={guardar.isPending}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={onGuardar}
            disabled={!puedeGuardar}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            {guardar.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando…
              </>
            ) : (
              'Guardar evaluación'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ComponenteAuto({
  titulo,
  valor,
  detalle,
}: {
  titulo: string
  valor: number | null
  detalle: string
}) {
  return (
    <div className="rounded-xl border border-[#e4c9b0]/60 bg-white p-3 flex items-center gap-3">
      <ScoreBadge valor={valor} size="md" />
      <div className="min-w-0">
        <p className="text-[#391511] text-sm font-semibold">{titulo}</p>
        <p className="text-[#6f3a2a] text-xs truncate">{detalle}</p>
      </div>
    </div>
  )
}
