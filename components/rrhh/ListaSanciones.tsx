'use client'

import { useState } from 'react'
import { Ban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAnularSancion } from '@/lib/hooks/useIncidencias'
import { fechaCortaLocal } from './constantes'
import { TIPOS_SANCION } from './incidenciasConstantes'
import type { SancionConVinculos } from '@/lib/queries/incidencias'
import { cn } from '@/lib/utils'

interface Props {
  sanciones: SancionConVinculos[]
  nombrePorId?: Map<number, string>
  puedeAnular: boolean
  vacio?: string
}

export function ListaSanciones({ sanciones, nombrePorId, puedeAnular, vacio }: Props) {
  const anular = useAnularSancion()
  const [anulando, setAnulando] = useState<number | null>(null)
  const [motivo, setMotivo] = useState('')

  if (sanciones.length === 0) {
    return (
      <p className="text-[#c8a58a] text-sm text-center py-8">
        {vacio ?? 'Sin sanciones formales registradas.'}
      </p>
    )
  }

  return (
    <ul className="divide-y divide-[#e4c9b0]/40">
      {sanciones.map((s) => {
        const def = TIPOS_SANCION[s.tipo]
        const anulada = !!s.anulada_at
        return (
          <li key={s.id} className={cn('py-3 space-y-1.5', anulada && 'opacity-60')}>
            <div className="flex items-start gap-3 flex-wrap">
              <span className="text-[#c8a58a] text-xs tabular-nums w-20 shrink-0 pt-0.5">
                {fechaCortaLocal(s.fecha)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[#391511] text-sm font-semibold">
                  {nombrePorId && (
                    <>
                      {nombrePorId.get(s.empleado_id) ?? `Empleado #${s.empleado_id}`}
                      <span className="text-[#c8a58a] font-normal"> · </span>
                    </>
                  )}
                  {def.label}
                  {s.tipo === 'suspension' && s.dias_suspension != null && (
                    <span className="text-[#6f3a2a] font-normal"> · {s.dias_suspension} días</span>
                  )}
                </p>
                <p className="text-[#6f3a2a] text-sm whitespace-pre-wrap">{s.motivo}</p>
                <p className="text-[#c8a58a] text-xs mt-0.5">
                  {s.referencia_acta && <>Acta: {s.referencia_acta} · </>}
                  {s.resolucion && <>Resolución: {s.resolucion} · </>}
                  {s.sancion_incidencias.length > 0 && (
                    <>{s.sancion_incidencias.length} incidencia(s) vinculada(s) · </>
                  )}
                  {s.va_al_legajo ? 'En legajo' : 'No va al legajo'}
                </p>
                {anulada && (
                  <p className="text-[#c43e2c] text-xs mt-0.5">
                    <span className="font-semibold">Anulada:</span> {s.motivo_anulacion}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={cn(
                    'text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full',
                    anulada ? 'bg-[#f3ece4] text-[#c8a58a] line-through' : def.clase
                  )}
                >
                  {def.label}
                </span>
                {puedeAnular && !anulada && anulando !== s.id && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setAnulando(s.id)
                      setMotivo('')
                    }}
                    className="text-[#c43e2c] gap-1 text-xs h-7"
                  >
                    <Ban className="h-3.5 w-3.5" />
                    Anular
                  </Button>
                )}
              </div>
            </div>

            {anulando === s.id && (
              <div className="sm:ml-[92px] flex gap-2 items-start">
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Motivo de la anulación (obligatorio)"
                  disabled={anular.isPending}
                  className="flex-1 rounded-md border border-[#e4c9b0] bg-white px-3 py-1.5 text-sm text-[#391511] placeholder:text-[#c8a58a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c]"
                />
                <Button
                  size="sm"
                  onClick={() =>
                    anular.mutate(
                      { id: s.id, motivo: motivo.trim() },
                      { onSuccess: () => setAnulando(null) }
                    )
                  }
                  disabled={anular.isPending || motivo.trim().length === 0}
                  className="bg-[#c43e2c] hover:bg-[#a83424] text-white h-8"
                >
                  Confirmar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAnulando(null)}
                  disabled={anular.isPending}
                  className="border-[#e4c9b0] text-[#6f3a2a] h-8"
                >
                  Cancelar
                </Button>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
