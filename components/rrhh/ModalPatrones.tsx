'use client'

import { useMemo, useState } from 'react'
import { Pencil, Plus, Power, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useEmpleados } from '@/lib/hooks/useRrhh'
import { useTurnos } from '@/lib/hooks/useAsistencia'
import { useEliminarPatron, usePatrones, useTogglePatronActivo } from '@/lib/hooks/useCronograma'
import type { PatronConMiembros } from '@/lib/queries/cronograma'
import { nombreCompleto, fechaCortaLocal } from './constantes'
import { NOMBRE_TURNO } from './asistenciaConstantes'
import { TIPOS_PATRON, abrevDiaDesdeAncla } from './cronogramaConstantes'
import { ModalPatronCronograma } from './ModalPatronCronograma'
import { cn } from '@/lib/utils'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
}

/** Lista de patrones de cronograma con alta, edición, activar y borrar. */
export function ModalPatrones({ abierto, onCambioAbierto }: Props) {
  const { data: patrones, isLoading } = usePatrones()
  const { data: empleados } = useEmpleados()
  const { data: turnos } = useTurnos()
  const toggle = useTogglePatronActivo()
  const eliminar = useEliminarPatron()
  const [editar, setEditar] = useState<{ patron: PatronConMiembros | null } | null>(null)
  const [confirmarBorrar, setConfirmarBorrar] = useState<number | null>(null)

  const nombrePorId = useMemo(() => {
    const m = new Map<number, string>()
    for (const e of empleados ?? []) m.set(e.id, nombreCompleto(e))
    return m
  }, [empleados])
  const nombreTurno = (id: number | null) => {
    const t = turnos?.find((x) => x.id === id)
    return t ? NOMBRE_TURNO[t.nombre] : '—'
  }

  return (
    <>
      <Dialog open={abierto} onOpenChange={onCambioAbierto}>
        <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
            <DialogTitle className="text-[#391511] text-lg">Patrones de cronograma</DialogTitle>
            <DialogDescription className="text-[#6f3a2a]">
              Las rotaciones de francos y turnos con las que se genera el cronograma.
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 py-5 space-y-3 max-h-[64vh] overflow-y-auto">
            <Button
              onClick={() => setEditar({ patron: null })}
              className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
            >
              <Plus className="h-4 w-4" />
              Nuevo patrón
            </Button>

            {isLoading ? (
              <p className="text-[#c8a58a] text-sm">Cargando…</p>
            ) : (patrones ?? []).length === 0 ? (
              <p className="text-[#c8a58a] text-sm py-6 text-center">
                Todavía no hay patrones. Creá uno con la lista de francos de mañana/tarde y otro para la noche.
              </p>
            ) : (
              <ul className="space-y-2">
                {patrones!.map((p) => (
                  <li
                    key={p.id}
                    className={cn(
                      'rounded-xl border p-3 space-y-1.5',
                      p.activo ? 'border-[#e4c9b0]/60 bg-white' : 'border-[#e4c9b0]/40 bg-[#fdfaf6] opacity-70'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-[#391511] font-semibold text-sm">
                          {p.nombre}
                          {!p.activo && (
                            <span className="ml-2 text-[10px] uppercase font-bold text-[#c8a58a]">inactivo</span>
                          )}
                        </p>
                        <p className="text-[#6f3a2a] text-xs">
                          {TIPOS_PATRON[p.tipo].label} · semana 1 desde {fechaCortaLocal(p.fecha_ancla)}
                          {p.tipo === 'franco_rotativo' && (
                            <> · francos: {p.orden_dias.map((d) => abrevDiaDesdeAncla(p.fecha_ancla, d)).join(' → ')}</>
                          )}
                          {p.tipo === 'bloques_alternados' && (
                            <> · {p.bloque_dias} días corridos cada uno, desde el {abrevDiaDesdeAncla(p.fecha_ancla, 0)}</>
                          )}
                          {p.turno_id != null && <> · turno {nombreTurno(p.turno_id)}</>}
                          {p.pivote_empleado_id != null && (
                            <> · pivote {nombrePorId.get(p.pivote_empleado_id) ?? '—'}</>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="sm" onClick={() => setEditar({ patron: p })} className="h-8 text-[#6f3a2a] gap-1 text-xs">
                          <Pencil className="h-3.5 w-3.5" /> Editar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggle.mutate({ id: p.id, activo: !p.activo })}
                          disabled={toggle.isPending}
                          className="h-8 text-[#6f3a2a] gap-1 text-xs"
                        >
                          <Power className="h-3.5 w-3.5" /> {p.activo ? 'Desactivar' : 'Activar'}
                        </Button>
                        {confirmarBorrar === p.id ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => eliminar.mutate(p.id, { onSuccess: () => setConfirmarBorrar(null) })}
                              disabled={eliminar.isPending}
                              className="h-8 bg-[#c43e2c] hover:bg-[#a83424] text-white text-xs"
                            >
                              Confirmar
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setConfirmarBorrar(null)} className="h-8 border-[#e4c9b0] text-[#6f3a2a] text-xs">
                              No
                            </Button>
                          </>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => setConfirmarBorrar(p.id)} className="h-8 w-8 p-0 text-[#c43e2c]" aria-label="Eliminar">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <ol className="flex flex-wrap gap-1">
                      {p.patron_cronograma_miembros.map((m) => (
                        <li
                          key={m.empleado_id}
                          className="text-xs rounded-full bg-[#f9d2a2]/40 text-[#391511] px-2 py-0.5"
                        >
                          <span className="text-[#c8a58a] tabular-nums">{m.orden}.</span>{' '}
                          {nombrePorId.get(m.empleado_id) ?? `#${m.empleado_id}`}
                          {p.tipo === 'franco_rotativo' && m.empleado_id !== p.pivote_empleado_id && (
                            <span className="text-[#6f3a2a]"> · {nombreTurno(m.turno_id ?? p.turno_id)}</span>
                          )}
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {editar && (
        <ModalPatronCronograma
          abierto={!!editar}
          onCambioAbierto={(v) => !v && setEditar(null)}
          patron={editar.patron}
        />
      )}
    </>
  )
}
