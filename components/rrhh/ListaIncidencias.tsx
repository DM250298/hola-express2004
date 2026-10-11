'use client'

import { useState } from 'react'
import { CheckCircle2, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCerrarIncidencia } from '@/lib/hooks/useIncidencias'
import { fechaCortaLocal } from './constantes'
import { GRAVEDAD_INCIDENCIA, INSTANCIA_INCIDENCIA } from './incidenciasConstantes'
import type { IncidenciaConTipologia } from '@/lib/queries/incidencias'
import { cn } from '@/lib/utils'

interface Props {
  incidencias: IncidenciaConTipologia[]
  /** Nombre por empleado (se omite la columna si no viene: vista de un solo empleado). */
  nombrePorId?: Map<number, string>
  /** Permite cerrar (rrhh). En "mi panel" es false. */
  puedeCerrar: boolean
  vacio?: string
}

/** Badges reutilizados en la tabla y en el legajo. */
export function BadgeInstancia({ instancia, escalada }: { instancia: number; escalada: boolean }) {
  const def = INSTANCIA_INCIDENCIA[Math.min(3, Math.max(1, instancia))]
  return (
    <span
      title={def.larga}
      className={cn(
        'inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full whitespace-nowrap',
        escalada ? INSTANCIA_INCIDENCIA[3].clase : def.clase
      )}
    >
      {def.corta}
      {escalada && ' · escalada'}
    </span>
  )
}

export function BadgeGravedad({ gravedad }: { gravedad: 'leve' | 'grave' }) {
  const def = GRAVEDAD_INCIDENCIA[gravedad]
  return (
    <span
      className={cn(
        'text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full',
        def.clase
      )}
    >
      {def.label}
    </span>
  )
}

export function ListaIncidencias({ incidencias, nombrePorId, puedeCerrar, vacio }: Props) {
  const cerrar = useCerrarIncidencia()
  const [cerrando, setCerrando] = useState<number | null>(null)
  const [accion, setAccion] = useState('')

  if (incidencias.length === 0) {
    return (
      <p className="text-[#c8a58a] text-sm text-center py-8">
        {vacio ?? 'Sin incidencias en este período.'}
      </p>
    )
  }

  function confirmarCierre(id: number) {
    cerrar.mutate(
      { id, accion: accion.trim() || null },
      {
        onSuccess: () => {
          setCerrando(null)
          setAccion('')
        },
      }
    )
  }

  return (
    <ul className="divide-y divide-[#e4c9b0]/40">
      {incidencias.map((i) => {
        const abierta = i.estado === 'abierta'
        return (
          <li key={i.id} className="py-3 space-y-1.5">
            <div className="flex items-start gap-3 flex-wrap">
              <span className="text-[#c8a58a] text-xs tabular-nums w-20 shrink-0 pt-0.5">
                {fechaCortaLocal(i.fecha)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[#391511] text-sm font-semibold">
                  {nombrePorId && (
                    <>
                      {nombrePorId.get(i.empleado_id) ?? `Empleado #${i.empleado_id}`}
                      <span className="text-[#c8a58a] font-normal"> · </span>
                    </>
                  )}
                  {i.tipologias_incidencia?.nombre ?? 'Incidencia'}
                  {i.tarea_turno_id && (
                    <Link2 className="inline h-3 w-3 ml-1 text-[#c8a58a]" aria-label="Tarea vinculada" />
                  )}
                </p>
                <p className="text-[#6f3a2a] text-sm whitespace-pre-wrap">{i.descripcion}</p>
                {i.accion_correctiva && (
                  <p className="text-[#2f7d4f] text-xs mt-0.5">
                    <span className="font-semibold">Corrección:</span> {i.accion_correctiva}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                <BadgeGravedad gravedad={i.gravedad} />
                <BadgeInstancia instancia={i.instancia} escalada={i.escalada} />
                <span
                  className={cn(
                    'text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full',
                    abierta ? 'bg-[#f9b44c]/30 text-[#391511]' : 'bg-[#f3ece4] text-[#c8a58a]'
                  )}
                >
                  {abierta ? 'Abierta' : 'Cerrada'}
                </span>
                {puedeCerrar && abierta && cerrando !== i.id && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCerrando(i.id)
                      setAccion(i.accion_correctiva ?? '')
                    }}
                    className="text-[#6f3a2a] gap-1 text-xs h-7"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Cerrar
                  </Button>
                )}
              </div>
            </div>

            {cerrando === i.id && (
              <div className="ml-0 sm:ml-[92px] flex gap-2 items-start">
                <input
                  value={accion}
                  onChange={(e) => setAccion(e.target.value)}
                  placeholder="Acción correctiva (opcional)"
                  disabled={cerrar.isPending}
                  className="flex-1 rounded-md border border-[#e4c9b0] bg-white px-3 py-1.5 text-sm text-[#391511] placeholder:text-[#c8a58a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c]"
                />
                <Button
                  size="sm"
                  onClick={() => confirmarCierre(i.id)}
                  disabled={cerrar.isPending}
                  className="bg-[#2f7d4f] hover:bg-[#276a43] text-white h-8"
                >
                  Confirmar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCerrando(null)}
                  disabled={cerrar.isPending}
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
