'use client'

import { useState } from 'react'
import { Pencil, Plus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { MontoARS } from '@/components/shared/MontoARS'
import { ModalEmpleado } from './ModalEmpleado'
import { useEmpleados, useToggleEmpleadoActivo } from '@/lib/hooks/useRrhh'
import { formatearFechaCorta } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import type { EmpleadoRow } from '@/types/database'

export function TabEmpleados() {
  const { data: empleados, isLoading, isError } = useEmpleados()
  const toggle = useToggleEmpleadoActivo()
  const [modalAbierto, setModalAbierto] = useState(false)
  const [editar, setEditar] = useState<EmpleadoRow | null>(null)

  function abrirNuevo() {
    setEditar(null)
    setModalAbierto(true)
  }

  function abrirEdicion(e: EmpleadoRow) {
    setEditar(e)
    setModalAbierto(true)
  }

  function handleBaja(e: EmpleadoRow) {
    const accion = e.activo ? 'dar de baja' : 'reactivar'
    if (!confirm(`¿Querés ${accion} a "${e.nombre}"?`)) return
    toggle.mutate({ id: e.id, activo: !e.activo })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[#391511] font-bold">Empleados</h2>
          <p className="text-[#6f3a2a] text-sm">
            Legajo del personal del autoservicio.
          </p>
        </div>
        <Button
          onClick={abrirNuevo}
          className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Nuevo empleado
        </Button>
      </div>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={5} columnas={5} />
          </div>
        ) : isError ? (
          <div className="p-10 text-center text-[#c43e2c] text-sm">
            No se pudieron cargar los empleados.
          </div>
        ) : !empleados || empleados.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              <Users className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">
              Sin empleados cargados
            </p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              Registrá al personal para poder liquidar sueldos.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                  <TableHead className="text-[#391511] font-semibold">
                    Empleado
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Documento
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Ingreso
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Sueldo básico
                  </TableHead>
                  <TableHead className="text-right w-28 text-[#391511] font-semibold" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {empleados.map((e) => (
                  <TableRow
                    key={e.id}
                    className={cn(
                      'border-b-[#e4c9b0]/40',
                      !e.activo && 'opacity-50'
                    )}
                  >
                    <TableCell>
                      <div className="font-medium text-[#391511] text-sm">
                        {e.nombre}
                        {!e.activo && (
                          <span className="ml-2 text-[10px] uppercase tracking-wider font-bold text-[#c43e2c]">
                            Baja
                          </span>
                        )}
                      </div>
                      <div className="text-[#c8a58a] text-xs">
                        {e.puesto || 'Sin puesto'}
                      </div>
                    </TableCell>
                    <TableCell className="text-[#6f3a2a] text-sm tabular-nums">
                      {e.documento || e.cuil || '—'}
                    </TableCell>
                    <TableCell className="text-[#6f3a2a] text-sm">
                      {e.fecha_ingreso
                        ? formatearFechaCorta(e.fecha_ingreso)
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-bold text-[#391511]">
                      <MontoARS monto={e.sueldo_basico} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => abrirEdicion(e)}
                          className="h-7 w-7 p-0 text-[#6f3a2a] hover:bg-[#f9d2a2]/40"
                          aria-label="Editar"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleBaja(e)}
                          disabled={toggle.isPending}
                          className="h-7 text-xs text-[#c8a58a] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c]"
                        >
                          {e.activo ? 'Baja' : 'Reactivar'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <ModalEmpleado
        abierto={modalAbierto}
        onCambioAbierto={setModalAbierto}
        empleado={editar}
      />
    </div>
  )
}
