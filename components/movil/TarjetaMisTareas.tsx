'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, ListChecks } from 'lucide-react'
import { useMaterializar, useTareasAgenda } from '@/lib/hooks/useTareas'
import { useTurnos } from '@/lib/hooks/useAsistencia'
import { hoyAr } from '@/components/rrhh/asistenciaConstantes'
import { tareaEsDe } from '@/components/rrhh/tareasConstantes'
import { horaActualAr } from '@/components/rrhh/paseTurnoConstantes'
import { cerradaSinHacer, contextoReloj, estadoDerivado } from '@/components/rrhh/tareasAgenda'

interface Props {
  empleadoId: number
}

/**
 * Tarjeta del hub móvil que enlaza a "Mi turno" y muestra un badge con las
 * tareas pendientes del día (y cuántas están atrasadas). Usa la misma lógica
 * que la pantalla `MiTurno` (materializa las recurrentes del día como fallback del cron y
 * cuenta las del empleado logueado), así el número del badge siempre coincide
 * con lo que se ve adentro y se actualiza al completar (invalidación de la
 * query). Es client porque el conteo real depende de esa materialización, que
 * no se puede resolver de forma confiable en el server del hub.
 */
export function TarjetaMisTareas({ empleadoId }: Props) {
  const [hoy] = useState(() => hoyAr())
  const { data: tareas } = useTareasAgenda(hoy)
  const { data: turnos } = useTurnos()
  const materializar = useMaterializar()
  const materializado = useRef(false)

  useEffect(() => {
    if (!materializado.current) {
      materializado.current = true
      materializar.mutate(hoy)
    }
  }, [hoy, materializar])

  const { pendientes, atrasadas } = useMemo(() => {
    // Igual que Mi turno: las suyas de hoy y la noche de ayer si sigue abierta.
    // Los recordatorios de todo el turno no se marcan, así que no cuentan.
    const reloj = contextoReloj(hoy, hoy, horaActualAr())
    const turnoDe = (id: number | null) => (turnos ?? []).find((t) => t.id === id) ?? null
    const abiertas = (tareas ?? []).filter(
      (t) =>
        tareaEsDe(t, empleadoId) &&
        t.tipo_actividad !== 'continua' &&
        (t.estado === 'pendiente' || t.estado === 'en_curso' || t.estado === 'vencida') &&
        (t.fecha === hoy || (!!turnoDe(t.turno_id)?.cruza_medianoche && !cerradaSinHacer(t.estado)))
    )
    return {
      pendientes: abiertas.length,
      atrasadas: abiertas.filter((t) => estadoDerivado(t, turnoDe(t.turno_id), hoy, reloj).atrasada).length,
    }
  }, [tareas, turnos, empleadoId, hoy])

  return (
    <Link
      href="/movil/tareas"
      className="group flex items-center gap-4 rounded-2xl border border-[#e4c9b0]/70 bg-white p-4 shadow-sm transition active:scale-[0.99]"
    >
      <span className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#f9b44c]/15 text-[#a06b00]">
        <ListChecks className="h-7 w-7" />
        {pendientes > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-[#c43e2c] px-1.5 text-xs font-bold text-white">
            {pendientes}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-bold text-[#391511]">Mi turno</span>
        <span className="block text-xs text-[#6f3a2a]">
          {atrasadas > 0 && (
            <span className="font-bold text-[#a3271d]">
              {atrasadas} atrasada{atrasadas === 1 ? '' : 's'} ·{' '}
            </span>
          )}
          {pendientes > 0
            ? `${pendientes} pendiente${pendientes === 1 ? '' : 's'} para hoy`
            : 'Tus tareas del día · marcá las que completás'}
        </span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-[#c8a58a]" />
    </Link>
  )
}
