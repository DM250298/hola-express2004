'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, ListChecks } from 'lucide-react'
import { useMaterializar, useTareasFecha } from '@/lib/hooks/useTareas'
import { hoyAr } from '@/components/rrhh/asistenciaConstantes'

interface Props {
  empleadoId: number
}

/**
 * Tarjeta del hub móvil que enlaza a "Mis tareas" y muestra un badge con las
 * tareas pendientes del día. Usa exactamente la misma lógica que la pantalla
 * `MisTareas` (materializa las recurrentes del día como fallback del cron y
 * cuenta las del empleado logueado), así el número del badge siempre coincide
 * con lo que se ve adentro y se actualiza al completar (invalidación de la
 * query). Es client porque el conteo real depende de esa materialización, que
 * no se puede resolver de forma confiable en el server del hub.
 */
export function TarjetaMisTareas({ empleadoId }: Props) {
  const [hoy] = useState(() => hoyAr())
  const { data: tareas } = useTareasFecha(hoy)
  const materializar = useMaterializar()
  const materializado = useRef(false)

  useEffect(() => {
    if (!materializado.current) {
      materializado.current = true
      materializar.mutate(hoy)
    }
  }, [hoy, materializar])

  const pendientes = useMemo(() => {
    // RLS ya limita a las del empleado logueado; el filtro por id cubre el caso
    // de un rol con permiso de RRHH que ve las de todos.
    const mias = (tareas ?? []).filter((t) => t.empleado_id === empleadoId)
    return mias.filter(
      (t) =>
        t.estado === 'pendiente' ||
        t.estado === 'en_curso' ||
        t.estado === 'vencida'
    ).length
  }, [tareas, empleadoId])

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
        <span className="block text-lg font-bold text-[#391511]">Mis tareas</span>
        <span className="block text-xs text-[#6f3a2a]">
          {pendientes > 0
            ? `${pendientes} pendiente${pendientes === 1 ? '' : 's'} para hoy`
            : 'Tus tareas del día · marcá las que completás'}
        </span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-[#c8a58a]" />
    </Link>
  )
}
