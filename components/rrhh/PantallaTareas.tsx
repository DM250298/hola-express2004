'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, format, parseISO } from 'date-fns'
import { Lock, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AgendaTurnos } from './AgendaTurnos'
import { ModalTarea } from './ModalTarea'
import { ModalPlantilla } from './ModalPlantilla'
import { NuevaTarea } from './NuevaTarea'
import { NavegadorFecha } from './NavegadorFecha'
import { RegistroCambios } from './RegistroCambios'
import { TabCumplimiento } from './TabCumplimiento'
import { TabRutina } from './TabRutina'
import { hoyAr } from './asistenciaConstantes'
import { useEmpleados } from '@/lib/hooks/useRrhh'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { tienePermiso } from '@/lib/permisos'
import { useMaterializar, useSincronizarTareas } from '@/lib/hooks/useTareas'
import { cn } from '@/lib/utils'
import type {
  PlantillaConAsignados,
  TareaConParticipantes,
} from '@/lib/queries/tareas'

const claseTab = 'data-active:bg-[#f9b44c]/20 data-active:text-[#391511]'

interface Props {
  /** Embebida como pestaña "Tareas" del hub Personal. */
  enHub?: boolean
}

/**
 * Personal › Tareas. La agenda cronológica del día por turno, la rutina
 * recurrente por turno, el cumplimiento histórico y, para los
 * administradores, el registro de cambios.
 */
export function PantallaTareas({ enHub = false }: Props = {}) {
  const [hoy] = useState(() => hoyAr())
  const [tab, setTab] = useState('agenda')
  const [fecha, setFecha] = useState(hoy)
  const [modalTarea, setModalTarea] = useState<{ tarea: TareaConParticipantes | null } | null>(null)
  // Alta (Etapa 3): una vez o rutina. Editar sigue en ModalTarea / ModalPlantilla.
  const [nueva, setNueva] = useState<{ frecuencia: 'una_vez' | 'rutina'; turnoId: number | null } | null>(null)
  const [modalPlantilla, setModalPlantilla] = useState<{
    plantilla: PlantillaConAsignados | null
    turnoDefault?: number | null
  } | null>(null)

  const { data: usuario, isLoading: cargandoUsuario } = useUsuario()
  // Administrador de tareas (tareas_admin): privadas, quitar de la rutina,
  // horarios de turno. Encargada (tareas_gestion): el resto de la gestión.
  const esAdmin = usuario?.rol === 'admin' || tienePermiso(usuario?.permisos, 'tareas_admin')
  const esGestor = esAdmin || tienePermiso(usuario?.permisos, 'tareas_gestion')
  const puedeRrhh = usuario?.rol === 'admin' || tienePermiso(usuario?.permisos, 'rrhh')

  const { data: empleados } = useEmpleados()
  const empleadoActualId = useMemo(
    () => (empleados ?? []).find((e) => e.usuario_id === usuario?.id)?.id ?? null,
    [empleados, usuario?.id]
  )

  const materializar = useMaterializar()
  const sincronizar = useSincronizarTareas()
  const materializado = useRef(false)

  // Fallback del cron: generar las recurrentes de hoy al entrar (una vez).
  useEffect(() => {
    if (!materializado.current) {
      materializado.current = true
      materializar.mutate(hoy)
    }
  }, [hoy, materializar])

  // La RPC acepta hoy-1 … hoy+7 (mig 250): fuera de eso el botón se apaga.
  const sincronizable =
    fecha >= format(addDays(parseISO(hoy), -1), 'yyyy-MM-dd') &&
    fecha <= format(addDays(parseISO(hoy), 7), 'yyyy-MM-dd')

  // Gate: la gestión de tareas es de encargadas/administración. Un cajero con
  // 'rrhh' que llegue por URL ve el aviso (RLS igual le negaría escribir).
  if (!cargandoUsuario && !esGestor) {
    return (
      <div className={cn(!enHub && 'p-6', 'max-w-lg mx-auto')}>
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-8 text-center space-y-2">
          <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40">
            <Lock className="h-6 w-6 text-[#6f3a2a]" />
          </div>
          <p className="text-[#391511] font-semibold">
            No tenés permiso para gestionar tareas.
          </p>
          <p className="text-[#6f3a2a] text-sm">
            Tus tareas asignadas están en <span className="font-semibold">Mis tareas</span>.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={cn(!enHub && 'p-4 sm:p-6', 'max-w-[1400px] mx-auto space-y-5')}>
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          {enHub ? (
            <h2 className="text-[#391511] text-lg font-bold">Cada tarea, a su hora</h2>
          ) : (
            <h1 className="text-[#391511] text-2xl font-bold">Tareas</h1>
          )}
          <p className="text-[#6f3a2a] text-sm mt-1">
            La rutina del local organizada por turno: qué toca ahora, qué sigue, quién lo hace
            y qué quedó atrasado.
          </p>
        </div>
        <Button
          onClick={() => setNueva({ frecuencia: 'una_vez', turnoId: null })}
          className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Nueva tarea
        </Button>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="space-y-4">
        <TabsList className="bg-white border border-[#e4c9b0]/60 p-1 h-auto flex-wrap">
          <TabsTrigger value="agenda" className={claseTab}>
            Agenda del día
          </TabsTrigger>
          <TabsTrigger value="rutina" className={claseTab}>
            Configurar rutina
          </TabsTrigger>
          <TabsTrigger value="cumplimiento" className={claseTab}>
            Cumplimiento
          </TabsTrigger>
          {esAdmin && (
            <TabsTrigger value="registro" className={claseTab}>
              Registro de cambios
            </TabsTrigger>
          )}
        </TabsList>

        {/* ── Agenda cronológica por turno ── */}
        <TabsContent value="agenda" className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <NavegadorFecha fecha={fecha} hoy={hoy} onCambio={setFecha} />
            <Button
              variant="outline"
              onClick={() => sincronizar.mutate(fecha)}
              disabled={sincronizar.isPending || !sincronizable}
              title="Reasigna las tareas recurrentes del día según quién está en el cronograma (francos, licencias, coberturas) y aplica los cambios de la rutina a las pendientes. Lo iniciado, completado o fijado a mano no se toca."
              className="h-9 border-[#e4c9b0] bg-white text-[#6f3a2a] hover:text-[#391511] gap-1.5"
            >
              <RefreshCw className={cn('h-4 w-4', sincronizar.isPending && 'animate-spin')} />
              Actualizar según cronograma
            </Button>
          </div>

          <AgendaTurnos
            fecha={fecha}
            esGestor={!!esGestor}
            empleadoActualId={empleadoActualId}
            onAbrirTarea={(t) => setModalTarea({ tarea: t })}
            esAdmin={esAdmin}
            actorNombre={usuario?.nombre?.split(' ')[0] ?? null}
            onVerRegistro={esAdmin ? () => setTab('registro') : undefined}
          />
        </TabsContent>

        {/* ── Rutina recurrente por turno ── */}
        <TabsContent value="rutina">
          <TabRutina
            onNueva={(turnoDefault) => setNueva({ frecuencia: 'rutina', turnoId: turnoDefault })}
            onEditar={(p) => setModalPlantilla({ plantilla: p })}
            puedeEditarTurnos={esAdmin}
            esAdmin={esAdmin}
            esGestor={!!esGestor}
          />
        </TabsContent>

        {/* ── Cumplimiento (control histórico) ── */}
        <TabsContent value="cumplimiento">
          <TabCumplimiento />
        </TabsContent>

        {/* ── Registro de cambios (Etapa 5, solo administradores) ── */}
        {esAdmin && (
          <TabsContent value="registro">
            <RegistroCambios />
          </TabsContent>
        )}
      </Tabs>

      {nueva && (
        <NuevaTarea
          abierto={!!nueva}
          onCambioAbierto={(v) => !v && setNueva(null)}
          fechaDefault={fecha}
          turnoDefault={nueva.turnoId}
          frecuenciaInicial={nueva.frecuencia}
          esAdmin={esAdmin}
        />
      )}
      {modalTarea && (
        <ModalTarea
          abierto={!!modalTarea}
          onCambioAbierto={(v) => !v && setModalTarea(null)}
          tarea={modalTarea.tarea}
          fechaDefault={fecha}
          esGestor={!!esGestor}
          puedeIncidencia={!!puedeRrhh}
          esAdmin={esAdmin}
        />
      )}
      {modalPlantilla && (
        <ModalPlantilla
          abierto={!!modalPlantilla}
          onCambioAbierto={(v) => !v && setModalPlantilla(null)}
          plantilla={modalPlantilla.plantilla}
          turnoDefault={modalPlantilla.turnoDefault}
          esAdmin={esAdmin}
        />
      )}
    </div>
  )
}
