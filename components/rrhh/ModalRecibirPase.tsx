'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useRecibirPaseTurno } from '@/lib/hooks/usePaseTurno'
import { BLOQUES_PASE } from './paseTurnoConstantes'
import { fechaCortaLocal } from './constantes'
import type { PaseTurnoRow } from '@/types/database'
import { cn } from '@/lib/utils'

interface Props {
  pase: PaseTurnoRow | null
  onCerrar: () => void
  nombrePorId: Map<number, string>
  nombreTurno: (id: number | null) => string
  /** Con 'rrhh': recibir a nombre de otro. */
  entranteEmpleadoId?: number | null
}

const claseTextarea =
  'w-full rounded-md border border-[#e4c9b0] bg-white px-3 py-2 text-sm text-[#391511] placeholder:text-[#c8a58a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c] disabled:opacity-50 resize-none'

type Claves = 'reposicion' | 'orden' | 'novedades' | 'pendientes'

function Toggle({
  valor,
  onChange,
  disabled,
}: {
  valor: boolean | null
  onChange: (v: boolean) => void
  disabled: boolean
}) {
  return (
    <div className="flex gap-1 shrink-0">
      <button
        type="button"
        onClick={() => onChange(true)}
        disabled={disabled}
        className={cn(
          'h-8 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1 border transition-colors',
          valor === true
            ? 'bg-[#2f7d4f] border-[#2f7d4f] text-white'
            : 'bg-white border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#2f7d4f]/10'
        )}
      >
        <Check className="h-3.5 w-3.5" /> Conforme
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        disabled={disabled}
        className={cn(
          'h-8 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1 border transition-colors',
          valor === false
            ? 'bg-[#c43e2c] border-[#c43e2c] text-white'
            : 'bg-white border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#c43e2c]/10'
        )}
      >
        <X className="h-3.5 w-3.5" /> No
      </button>
    </div>
  )
}

export function ModalRecibirPase({ pase, onCerrar, nombrePorId, nombreTurno, entranteEmpleadoId }: Props) {
  const recibir = useRecibirPaseTurno()
  const [conf, setConf] = useState<Record<Claves, boolean | null>>({
    reposicion: null,
    orden: null,
    novedades: null,
    pendientes: null,
  })
  const [obs, setObs] = useState('')

  useEffect(() => {
    if (pase) {
      setConf({ reposicion: null, orden: null, novedades: null, pendientes: null })
      setObs('')
    }
  }, [pase])

  const abierto = !!pase
  const procesando = recibir.isPending
  const todosMarcados = Object.values(conf).every((v) => v !== null)
  const hayNoConforme = Object.values(conf).some((v) => v === false)
  const puedeRecibir = todosMarcados && (!hayNoConforme || obs.trim().length > 0) && !procesando

  function confirmar() {
    if (!pase || !puedeRecibir) return
    recibir.mutate(
      {
        paseId: pase.id,
        conformeReposicion: conf.reposicion === true,
        conformeOrden: conf.orden === true,
        conformeNovedades: conf.novedades === true,
        conformePendientes: conf.pendientes === true,
        observaciones: obs.trim() || null,
        entranteEmpleadoId: entranteEmpleadoId ?? null,
      },
      { onSuccess: onCerrar }
    )
  }

  const bloques: { clave: Claves; etiqueta: string; contenido: React.ReactNode }[] = pase
    ? [
        ...BLOQUES_PASE.map((b) => ({
          clave: (b.clave === 'orden_limpieza' ? 'orden' : b.clave) as Claves,
          etiqueta: b.etiqueta,
          contenido: (
            <p className="text-[#391511] text-sm whitespace-pre-wrap">{pase[b.clave] || '—'}</p>
          ),
        })),
        {
          clave: 'pendientes' as Claves,
          etiqueta: 'Pendientes',
          contenido:
            pase.pendientes.length === 0 ? (
              <p className="text-[#c8a58a] text-sm">Sin pendientes.</p>
            ) : (
              <ul className="space-y-1">
                {pase.pendientes.map((p, i) => (
                  <li key={i} className="text-sm text-[#391511] flex gap-2">
                    <span className="text-[#c8a58a]">•</span>
                    <span>
                      {p.texto}
                      <span className="text-[#6f3a2a]">
                        {' '}
                        → {p.responsable_empleado_id != null ? nombrePorId.get(p.responsable_empleado_id) ?? '—' : 'sin responsable'}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ),
        },
      ]
    : []

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && !procesando && onCerrar()}>
      <DialogContent className="sm:max-w-xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">Recibir pase de turno</DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {pase && (
              <>
                {fechaCortaLocal(pase.fecha)} · {nombreTurno(pase.turno_saliente_id)} → {nombreTurno(pase.turno_entrante_id)} · entrega{' '}
                {nombrePorId.get(pase.saliente_empleado_id) ?? '—'}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4 max-h-[64vh] overflow-y-auto">
          {bloques.map((b) => (
            <div key={b.clave} className="rounded-xl border border-[#e4c9b0]/60 p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[#c8a58a] text-xs font-semibold uppercase tracking-wide">{b.etiqueta}</p>
                <Toggle
                  valor={conf[b.clave]}
                  onChange={(v) => setConf((c) => ({ ...c, [b.clave]: v }))}
                  disabled={procesando}
                />
              </div>
              {b.contenido}
            </div>
          ))}

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Observaciones {hayNoConforme ? '(obligatorias: explicá la no conformidad)' : '(opcional)'}
            </Label>
            <textarea
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              rows={3}
              placeholder="Qué encontraste distinto a lo que dejó el turno anterior."
              disabled={procesando}
              className={claseTextarea}
            />
          </div>
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button variant="outline" onClick={onCerrar} disabled={procesando} className="flex-1 border-[#e4c9b0] text-[#6f3a2a]">
            Cancelar
          </Button>
          <Button
            onClick={confirmar}
            disabled={!puedeRecibir}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            {procesando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Recibiendo…
              </>
            ) : (
              'Recibir turno'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
