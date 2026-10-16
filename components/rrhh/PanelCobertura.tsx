'use client'

import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ESTILO_TURNO, NOMBRE_TURNO, capitalizar } from './asistenciaConstantes'
import { ROLES_OPERATIVOS, nombreCompleto } from './constantes'
import { etiquetaHorasCorta, type CoberturaTurno } from './cronogramaCalculos'
import { cn } from '@/lib/utils'
import type { RolOperativo } from '@/types/database'

interface Props {
  fecha: string
  cobertura: CoberturaTurno[]
  /** Abre la configuración de dotación (permiso rrhh). */
  onConfigurar: () => void
}

/** Cobertura PLANIFICADA del día seleccionado: personas por turno vs. mínimo configurado. */
export function PanelCobertura({ fecha, cobertura, onConfigurar }: Props) {
  const sinConfig = cobertura.every((c) => c.requerido === null)
  const huecos = cobertura.filter((c) => c.planificados.length === 0)

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-[#391511] text-sm font-bold">
          Cobertura planificada ·{' '}
          {capitalizar(format(parseISO(fecha), "EEEE d 'de' MMMM", { locale: es }))}
        </h3>
        <div className="flex items-center gap-2">
          {sinConfig && (
            <span className="text-[11px] text-[#a06b00] bg-[#e0a100]/15 rounded-full px-2 py-0.5 font-semibold">
              Dotación requerida sin configurar
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onConfigurar}
            className="h-7 text-xs text-[#6f3a2a] gap-1 hover:bg-[#f9d2a2]/40"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Dotación
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
        {cobertura.map((c) => {
          const estilo = ESTILO_TURNO[c.turno.nombre]
          const n = c.planificados.length
          const falta = c.faltan !== null && c.faltan > 0
          const vacio = n === 0
          const puestos = (Object.entries(c.porPuesto) as [RolOperativo, number][])
            .map(([rol, k]) => `${k} ${ROLES_OPERATIVOS[rol].toLowerCase()}`)
            .join(' · ')
          return (
            <div
              key={c.turno.id}
              className={cn(
                'rounded-xl border p-2 sm:p-3 bg-white min-w-0',
                falta || vacio ? 'border-[#e0a100]/50 bg-[#fff8ea]' : 'border-[#e4c9b0]/60'
              )}
              title={c.planificados.map((e) => nombreCompleto(e)).join(', ') || 'Nadie asignado'}
            >
              <div className="flex items-center gap-1.5 text-xs text-[#6f3a2a] flex-wrap">
                <span className={cn('inline-block h-2 w-2 rounded-full shrink-0', estilo.punto)} />
                <span className="font-semibold text-[#391511]">{NOMBRE_TURNO[c.turno.nombre]}</span>
                <span className="tabular-nums hidden sm:inline">{etiquetaHorasCorta(c.turno)}</span>
              </div>
              <p className="text-lg sm:text-xl font-bold text-[#391511] tabular-nums mt-1">
                {n}
                {c.requerido !== null && <span className="text-[#c8a58a] font-normal"> / {c.requerido}</span>}
                <span className="text-xs font-normal text-[#6f3a2a] ml-1 hidden sm:inline">{n === 1 ? 'persona' : 'personas'}</span>
              </p>
              <p className={cn('text-[11px] mt-0.5', falta || vacio ? 'text-[#9e3e2f] font-semibold' : 'text-[#6f3a2a]')}>
                {vacio
                  ? 'Nadie asignado'
                  : falta
                    ? `Falta ${c.faltan}`
                    : c.requerido === null
                      ? 'Sin mínimo configurado'
                      : 'Mínimo cubierto'}
              </p>
              {puestos && <p className="text-[10px] text-[#6f3a2a] mt-1 truncate hidden sm:block" title={puestos}>{puestos}</p>}
            </div>
          )
        })}
      </div>

      <p className="text-[11px] text-[#c8a58a]">
        {huecos.length > 0 && (
          <span className="text-[#9e3e2f] font-semibold">
            Huecos: {huecos.map((h) => NOMBRE_TURNO[h.turno.nombre].toLowerCase()).join(', ')} sin nadie ·{' '}
          </span>
        )}
        Cuenta personas asignadas; no prueba presencia real ni que cada puesto quede cubierto.
      </p>
    </section>
  )
}
