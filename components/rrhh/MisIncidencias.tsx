'use client'

import { AlertTriangle, ShieldAlert } from 'lucide-react'
import { useIncidenciasEmpleado, useSanciones } from '@/lib/hooks/useIncidencias'
import { ListaIncidencias } from './ListaIncidencias'

interface Props {
  empleadoId: number
}

/**
 * Sección de "Mi panel": incidencias propias (solo lectura) y cantidad de
 * sanciones en legajo. RLS ya limita a las del empleado logueado.
 */
export function MisIncidencias({ empleadoId }: Props) {
  const { data: incidencias } = useIncidenciasEmpleado(empleadoId)
  const { data: sanciones } = useSanciones(empleadoId)

  const lista = incidencias ?? []
  const abiertas = lista.filter((i) => i.estado === 'abierta').length
  const enLegajo = (sanciones ?? []).filter((s) => s.va_al_legajo && !s.anulada_at).length

  if (lista.length === 0 && enLegajo === 0) return null

  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-[#391511] font-bold flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-[#e4a42a]" />
          Mis incidencias
          {abiertas > 0 && (
            <span className="text-[10px] font-bold bg-[#f9b44c]/30 text-[#391511] rounded-full px-2 py-0.5">
              {abiertas} abierta{abiertas === 1 ? '' : 's'}
            </span>
          )}
        </h2>
        {enLegajo > 0 && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#c43e2c]">
            <ShieldAlert className="h-3.5 w-3.5" />
            {enLegajo} sanción{enLegajo === 1 ? '' : 'es'} en legajo
          </span>
        )}
      </div>
      <p className="text-[#6f3a2a] text-xs">
        Escala operativa de seguimiento (1ª corrección · 2ª observación formal · 3ª escala a Dirección).
        No es una sanción formal. Si algo no coincide, hablalo con tu encargado/a.
      </p>
      <ListaIncidencias incidencias={lista.slice(0, 10)} puedeCerrar={false} />
    </div>
  )
}
