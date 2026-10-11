'use client'

import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeftRight,
  CalendarDays,
  ClipboardList,
  Gauge,
  Users,
  Wallet,
} from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TableroRrhh } from './TableroRrhh'
import { TabEquipo } from './TabEquipo'
import { PantallaAsistencia } from './PantallaAsistencia'
import { PantallaTareas } from './PantallaTareas'
import { TabSueldos } from './TabSueldos'
import { TabIncidencias } from './TabIncidencias'
import { TabPaseTurno } from './TabPaseTurno'

interface TabDef {
  value: string
  etiqueta: string
  icono: React.ElementType
  /** Permiso requerido para ver el tab. */
  permiso: string
}

/**
 * Hub único de gestión del personal. Reemplaza las entradas sueltas del
 * sidebar (Tablero RRHH, Recursos Humanos, Asistencia, Tareas): todo vive
 * acá en pestañas y se enlaza con `/rrhh?tab=<value>`.
 */
const TABS: TabDef[] = [
  { value: 'hoy', etiqueta: 'Hoy', icono: Gauge, permiso: 'rrhh' },
  { value: 'equipo', etiqueta: 'Equipo', icono: Users, permiso: 'rrhh' },
  { value: 'cronograma', etiqueta: 'Cronograma', icono: CalendarDays, permiso: 'rrhh' },
  { value: 'tareas', etiqueta: 'Tareas', icono: ClipboardList, permiso: 'tareas_gestion' },
  { value: 'incidencias', etiqueta: 'Incidencias', icono: AlertTriangle, permiso: 'rrhh' },
  { value: 'pase', etiqueta: 'Pase de turno', icono: ArrowLeftRight, permiso: 'rrhh' },
  { value: 'sueldos', etiqueta: 'Sueldos', icono: Wallet, permiso: 'rrhh_sueldos' },
]

interface Props {
  /** Permisos del usuario (los resuelve el server en page.tsx). */
  permisos: string[]
  /** Tab inicial (viene de ?tab= en la URL). */
  tabInicial?: string
}

export function PantallaPersonal({ permisos, tabInicial }: Props) {
  const tabsVisibles = TABS.filter((t) => permisos.includes(t.permiso))
  const tabsAMostrar = tabsVisibles.length > 0 ? tabsVisibles : TABS.slice(0, 1)

  const tabValido = (v?: string) =>
    !!v && tabsAMostrar.some((t) => t.value === v) ? v : null

  const [tab, setTab] = useState(
    () => tabValido(tabInicial) ?? tabsAMostrar[0]?.value ?? 'hoy'
  )

  // Si cambia ?tab= (ej. un link desde "Hoy" hacia otra pestaña), seguirlo.
  useEffect(() => {
    const v = tabValido(tabInicial)
    if (v) setTab(v)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabInicial])

  function cambiarTab(v: string) {
    setTab(v)
    // Reflejar el tab en la URL sin pasar por el server (para compartir /
    // recargar en el mismo lugar).
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('tab', v)
      window.history.replaceState(null, '', url.toString())
    }
  }

  const tabActivo = tabsAMostrar.some((t) => t.value === tab)
    ? tab
    : tabsAMostrar[0]?.value

  const puedeVerSueldos = permisos.includes('rrhh_sueldos')
  const puedeSancionar = permisos.includes('rrhh_sanciones')

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <header>
        <h1 className="text-[#391511] text-2xl font-bold flex items-center gap-2">
          <Users className="h-6 w-6 text-[#f9b44c]" />
          Personal
        </h1>
        <p className="text-[#6f3a2a] text-sm mt-1">
          Equipo, cronograma de turnos, tareas y seguimiento del personal en un
          solo lugar.
        </p>
      </header>

      <Tabs value={tabActivo} onValueChange={cambiarTab} className="space-y-5">
        <TabsList className="bg-white border border-[#e4c9b0]/60 p-1 h-auto flex-wrap">
          {tabsAMostrar.map(({ value, etiqueta, icono: Icono }) => (
            <TabsTrigger
              key={value}
              value={value}
              className="gap-1.5 data-active:bg-[#f9b44c]/20 data-active:text-[#391511] data-active:shadow-sm"
            >
              <Icono className="h-3.5 w-3.5" />
              {etiqueta}
            </TabsTrigger>
          ))}
        </TabsList>

        {tabValido('hoy') && (
          <TabsContent value="hoy">
            <TableroRrhh enHub />
          </TabsContent>
        )}
        {tabValido('equipo') && (
          <TabsContent value="equipo">
            <TabEquipo puedeVerSueldos={puedeVerSueldos} />
          </TabsContent>
        )}
        {tabValido('cronograma') && (
          <TabsContent value="cronograma">
            <PantallaAsistencia enHub />
          </TabsContent>
        )}
        {tabValido('tareas') && (
          <TabsContent value="tareas">
            <PantallaTareas enHub />
          </TabsContent>
        )}
        {tabValido('incidencias') && (
          <TabsContent value="incidencias">
            <TabIncidencias puedeSancionar={puedeSancionar} />
          </TabsContent>
        )}
        {tabValido('pase') && (
          <TabsContent value="pase">
            <TabPaseTurno />
          </TabsContent>
        )}
        {tabValido('sueldos') && (
          <TabsContent value="sueldos">
            <TabSueldos />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
