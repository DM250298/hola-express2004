'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useState } from 'react'
import { ChevronDown, ChevronUp, Network, ShieldCheck, UserRound } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useEmpleados } from '@/lib/hooks/useRrhh'
import {
  DETALLE_ROL_OPERATIVO,
  ORDEN_ROL_OPERATIVO,
  ROLES_OPERATIVOS,
  iniciales,
  nombreCompleto,
} from './constantes'
import type { EmpleadoConSueldo, RolOperativo } from '@/types/database'
import { cn } from '@/lib/utils'

/** Color del badge por nivel de la cadena de mando. */
const CLASE_ROL: Record<RolOperativo, string> = {
  direccion: 'bg-[#391511] text-[#f9d2a2]',
  responsable_general: 'bg-[#f9b44c] text-[#391511]',
  encargado: 'bg-[#f9d2a2] text-[#391511]',
  pivote: 'bg-[#f9d2a2]/60 text-[#6f3a2a]',
  compras: 'bg-[#2f7d4f]/15 text-[#2f7d4f]',
  cajero: 'bg-[#e4c9b0]/50 text-[#6f3a2a]',
  fiambreria: 'bg-[#e4c9b0]/50 text-[#6f3a2a]',
  otro: 'bg-[#f3ece4] text-[#c8a58a]',
}

const ordenRol = (r: RolOperativo) => ORDEN_ROL_OPERATIVO.indexOf(r)

function ordenar(lista: EmpleadoConSueldo[]): EmpleadoConSueldo[] {
  return [...lista].sort(
    (a, b) =>
      ordenRol(a.rol_operativo) - ordenRol(b.rol_operativo) ||
      nombreCompleto(a).localeCompare(nombreCompleto(b), 'es')
  )
}

/**
 * Árbol de la cadena de mando (Manual §3) armado desde `empleados.reporta_a`.
 * Raíces = sin jefe (Dirección). Los que no tienen jefe ni rol definido van
 * a "Sin ubicar" para que la encargada los complete desde la ficha.
 */
export function Organigrama() {
  const { data: empleados, isLoading } = useEmpleados()
  const [verRoles, setVerRoles] = useState(false)

  const { raices, hijosDe, sinUbicar } = useMemo(() => {
    const activos = (empleados ?? []).filter((e) => e.activo)
    const ids = new Set(activos.map((e) => e.id))
    const hijosDe = new Map<number, EmpleadoConSueldo[]>()
    const raices: EmpleadoConSueldo[] = []
    const sinUbicar: EmpleadoConSueldo[] = []

    for (const e of activos) {
      // Jefe inactivo o inexistente → se trata como raíz.
      const jefe = e.reporta_a != null && ids.has(e.reporta_a) ? e.reporta_a : null
      if (jefe == null) {
        if (e.rol_operativo === 'otro') sinUbicar.push(e)
        else raices.push(e)
      } else {
        const lista = hijosDe.get(jefe) ?? []
        lista.push(e)
        hijosDe.set(jefe, lista)
      }
    }
    for (const [k, v] of hijosDe) hijosDe.set(k, ordenar(v))
    return { raices: ordenar(raices), hijosDe, sinUbicar: ordenar(sinUbicar) }
  }, [empleados])

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-2xl bg-[#f9d2a2]/30" />
        ))}
      </div>
    )
  }

  const vacio = raices.length === 0 && sinUbicar.length === 0

  return (
    <div className="space-y-4">
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm p-5">
        <div className="flex items-center gap-2 mb-1">
          <Network className="h-4 w-4 text-[#f9b44c]" />
          <h3 className="text-[#391511] font-bold">Cadena de mando</h3>
        </div>
        <p className="text-[#6f3a2a] text-sm mb-4">
          Quién reporta a quién. Se edita desde la ficha de cada empleado
          (Rol operativo y Reporta a).
        </p>

        {vacio ? (
          <p className="text-[#c8a58a] text-sm text-center py-6">
            Todavía no hay empleados activos con rol operativo cargado.
          </p>
        ) : (
          <ul className="space-y-2">
            {raices.map((e) => (
              <Nodo key={e.id} empleado={e} hijosDe={hijosDe} nivel={0} />
            ))}
          </ul>
        )}
      </div>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm p-5">
        <button
          type="button"
          onClick={() => setVerRoles((v) => !v)}
          className="w-full flex items-center justify-between gap-2 text-left"
        >
          <span className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#2f7d4f]" />
            <span className="text-[#391511] font-bold">Roles, autoridad y límites</span>
          </span>
          {verRoles ? <ChevronUp className="h-4 w-4 text-[#c8a58a]" /> : <ChevronDown className="h-4 w-4 text-[#c8a58a]" />}
        </button>
        <p className="text-[#6f3a2a] text-sm mt-1">
          El cargo existe independientemente de quién lo ocupe. Qué decide cada nivel y qué no (Manual §3–4).
        </p>
        {verRoles && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-[#c8a58a]">
                  <th className="py-1.5 pr-3">Nivel</th>
                  <th className="py-1.5 pr-3">Rol</th>
                  <th className="py-1.5 pr-3">Autoridad principal</th>
                  <th className="py-1.5">No puede decidir</th>
                </tr>
              </thead>
              <tbody>
                {ORDEN_ROL_OPERATIVO.filter((r) => r !== 'otro').map((r) => {
                  const d = DETALLE_ROL_OPERATIVO[r]
                  return (
                    <tr key={r} className="border-t border-[#e4c9b0]/40 align-top">
                      <td className="py-2 pr-3 tabular-nums text-[#c8a58a] font-bold">{d.nivel}</td>
                      <td className="py-2 pr-3 text-[#391511] font-semibold whitespace-nowrap">{ROLES_OPERATIVOS[r]}</td>
                      <td className="py-2 pr-3 text-[#6f3a2a]">{d.autoridad}</td>
                      <td className="py-2 text-[#6f3a2a]">{d.noPuede}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {sinUbicar.length > 0 && (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm p-5">
          <h3 className="text-[#391511] font-bold mb-1">Sin ubicar</h3>
          <p className="text-[#6f3a2a] text-sm mb-3">
            Sin rol operativo ni jefe asignado. Completalos desde la ficha.
          </p>
          <ul className="space-y-2">
            {sinUbicar.map((e) => (
              <li key={e.id}>
                <Tarjeta empleado={e} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Nodo({
  empleado,
  hijosDe,
  nivel,
}: {
  empleado: EmpleadoConSueldo
  hijosDe: Map<number, EmpleadoConSueldo[]>
  nivel: number
}) {
  const hijos = hijosDe.get(empleado.id) ?? []
  return (
    <li>
      <Tarjeta empleado={empleado} />
      {hijos.length > 0 && (
        <ul
          className={cn(
            'mt-2 space-y-2 border-l-2 border-[#e4c9b0]/70 pl-3 sm:pl-4',
            nivel === 0 ? 'ml-4 sm:ml-6' : 'ml-3 sm:ml-5'
          )}
        >
          {hijos.map((h) => (
            <Nodo key={h.id} empleado={h} hijosDe={hijosDe} nivel={nivel + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

function Tarjeta({ empleado: e }: { empleado: EmpleadoConSueldo }) {
  return (
    <Link
      href={`/rrhh/empleados/${e.id}`}
      className="flex items-center gap-3 rounded-xl border border-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#f9d2a2]/30 px-3 py-2 transition-colors"
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f9d2a2]/50 text-[#6f3a2a] text-xs font-bold overflow-hidden">
        {e.foto_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={e.foto_url} alt={nombreCompleto(e)} className="h-full w-full object-cover" />
        ) : (
          iniciales(e) || <UserRound className="h-4 w-4" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[#391511] text-sm font-semibold truncate">
          {nombreCompleto(e)}
        </span>
        <span className="block text-[#c8a58a] text-xs truncate">
          {e.puesto || e.legajo}
        </span>
      </span>
      <span className="shrink-0 flex items-center gap-1.5">
        {e.rol_operativo !== 'otro' && (
          <span className="text-[10px] tabular-nums font-bold text-[#c8a58a]" title="Nivel en la cadena de mando">
            N{DETALLE_ROL_OPERATIVO[e.rol_operativo].nivel}
          </span>
        )}
        <span
          title={DETALLE_ROL_OPERATIVO[e.rol_operativo].autoridad}
          className={cn(
            'text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full',
            CLASE_ROL[e.rol_operativo]
          )}
        >
          {ROLES_OPERATIVOS[e.rol_operativo]}
        </span>
      </span>
    </Link>
  )
}
