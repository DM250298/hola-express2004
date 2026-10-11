'use client'

import { useState } from 'react'
import { Plus, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { useIncidenciasEmpleado, useSanciones } from '@/lib/hooks/useIncidencias'
import { ListaIncidencias } from './ListaIncidencias'
import { ListaSanciones } from './ListaSanciones'
import { ModalIncidencia } from './ModalIncidencia'
import { ModalSancion } from './ModalSancion'

interface Props {
  empleadoId: number
  nombre: string
  /** Dirección (rrhh_sanciones): ve y aplica sanciones formales. */
  puedeSancionar: boolean
}

/** Pestaña "Legajo disciplinario" de la ficha del empleado. */
export function TabLegajoDisciplinario({ empleadoId, nombre, puedeSancionar }: Props) {
  const { data: incidencias, isLoading } = useIncidenciasEmpleado(empleadoId)
  const { data: sanciones, isLoading: cargandoSanc } = useSanciones(empleadoId, puedeSancionar)
  const [modalInc, setModalInc] = useState(false)
  const [modalSanc, setModalSanc] = useState(false)

  const abiertas = (incidencias ?? []).filter((i) => i.estado === 'abierta').length

  return (
    <div className="space-y-4">
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <div>
            <h3 className="text-[#391511] font-bold">Incidencias operativas</h3>
            <p className="text-[#6f3a2a] text-xs">
              {abiertas > 0 ? `${abiertas} abierta${abiertas === 1 ? '' : 's'} · ` : ''}
              Escala de 30 días por tipología. No equivale a sanción formal.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setModalInc(true)}
            className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Nueva incidencia
          </Button>
        </div>
        {isLoading ? (
          <SkeletonTabla filas={4} columnas={3} />
        ) : (
          <ListaIncidencias
            incidencias={incidencias ?? []}
            puedeCerrar
            vacio="Sin incidencias registradas."
          />
        )}
      </div>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <div>
            <h3 className="text-[#391511] font-bold flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-[#c43e2c]" />
              Sanciones formales
            </h3>
            <p className="text-[#6f3a2a] text-xs">
              Estatuto art. 13: llamado de atención, apercibimiento, suspensión, exclusión.
            </p>
          </div>
          {puedeSancionar && (
            <Button
              size="sm"
              onClick={() => setModalSanc(true)}
              className="bg-[#c43e2c] hover:bg-[#a83424] text-white font-semibold gap-1.5"
            >
              <ShieldAlert className="h-4 w-4" />
              Aplicar sanción
            </Button>
          )}
        </div>
        {!puedeSancionar ? (
          <p className="text-[#c8a58a] text-sm py-4 text-center">
            Las sanciones formales las aplica y consulta Dirección.
          </p>
        ) : cargandoSanc ? (
          <SkeletonTabla filas={3} columnas={3} />
        ) : (
          <ListaSanciones sanciones={sanciones ?? []} puedeAnular />
        )}
      </div>

      <ModalIncidencia
        abierto={modalInc}
        onCambioAbierto={setModalInc}
        empleadoIdFijo={empleadoId}
      />
      {puedeSancionar && (
        <ModalSancion
          abierto={modalSanc}
          onCambioAbierto={setModalSanc}
          empleadoId={empleadoId}
          nombre={nombre}
        />
      )}
    </div>
  )
}
