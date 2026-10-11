'use client'

import { useMemo, useState } from 'react'
import { ArrowLeftRight, Inbox } from 'lucide-react'
import { useEmpleados } from '@/lib/hooks/useRrhh'
import { useTurnos } from '@/lib/hooks/useAsistencia'
import { usePasesPendientesRecibir } from '@/lib/hooks/usePaseTurno'
import { nombreCompleto } from './constantes'
import { NOMBRE_TURNO } from './asistenciaConstantes'
import { fechaCortaLocal } from './constantes'
import { FormPaseTurno } from './FormPaseTurno'
import { ModalRecibirPase } from './ModalRecibirPase'
import type { PaseTurnoRow } from '@/types/database'

interface Props {
  empleadoId: number
  nombre: string
  /** Sin padding exterior (hub móvil). */
  compacto?: boolean
}

/** Pantalla del empleado: recibir el pase que le dejaron y entregar el suyo. */
export function PantallaPaseTurnoEmpleado({ empleadoId, nombre, compacto = false }: Props) {
  const { data: pendientes } = usePasesPendientesRecibir()
  const { data: empleados } = useEmpleados()
  const { data: turnos } = useTurnos()
  const [recibiendo, setRecibiendo] = useState<PaseTurnoRow | null>(null)

  const nombrePorId = useMemo(() => {
    const m = new Map<number, string>()
    for (const e of empleados ?? []) m.set(e.id, nombreCompleto(e))
    return m
  }, [empleados])
  const nombreTurno = (id: number | null) => {
    const t = turnos?.find((x) => x.id === id)
    return t ? NOMBRE_TURNO[t.nombre] : '—'
  }

  // No puede recibir el propio.
  const porRecibir = (pendientes ?? []).filter((p) => p.saliente_empleado_id !== empleadoId)

  return (
    <div className={compacto ? 'space-y-5' : 'p-4 sm:p-6 max-w-2xl mx-auto space-y-5'}>
      <header>
        <h1 className="text-[#391511] text-2xl font-bold flex items-center gap-2">
          <ArrowLeftRight className="h-6 w-6 text-[#f9b44c]" />
          Pase de turno
        </h1>
        <p className="text-[#6f3a2a] text-sm mt-1">
          Hola, {nombre.split(' ')[0]}. Recibí el pase del turno anterior y dejá el tuyo
          antes de irte. El arqueo de caja va por su propio circuito.
        </p>
      </header>

      <section className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm p-4 space-y-3">
        <h2 className="text-[#391511] font-bold flex items-center gap-2">
          <Inbox className="h-4 w-4 text-[#f9b44c]" />
          Por recibir
          {porRecibir.length > 0 && (
            <span className="text-[10px] font-bold bg-[#f9b44c]/30 text-[#391511] rounded-full px-2 py-0.5">
              {porRecibir.length}
            </span>
          )}
        </h2>
        {porRecibir.length === 0 ? (
          <p className="text-[#c8a58a] text-sm">No hay pases pendientes de recibir.</p>
        ) : (
          <ul className="space-y-2">
            {porRecibir.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setRecibiendo(p)}
                  className="w-full text-left rounded-xl border border-[#f9b44c]/60 bg-[#f9b44c]/10 hover:bg-[#f9b44c]/20 px-3 py-2.5 transition-colors"
                >
                  <p className="text-[#391511] text-sm font-semibold">
                    {fechaCortaLocal(p.fecha)} · {nombreTurno(p.turno_saliente_id)} → {nombreTurno(p.turno_entrante_id)}
                  </p>
                  <p className="text-[#6f3a2a] text-xs">
                    Entregó {nombrePorId.get(p.saliente_empleado_id) ?? '—'} ·{' '}
                    {p.pendientes.length} pendiente{p.pendientes.length === 1 ? '' : 's'} · tocá para revisar y recibir
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm p-4 space-y-3">
        <h2 className="text-[#391511] font-bold">Entregar mi turno</h2>
        <FormPaseTurno salienteEmpleadoId={empleadoId} />
      </section>

      <ModalRecibirPase
        pase={recibiendo}
        onCerrar={() => setRecibiendo(null)}
        nombrePorId={nombrePorId}
        nombreTurno={nombreTurno}
      />
    </div>
  )
}
