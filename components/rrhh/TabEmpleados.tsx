'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Eye, Pencil, Plus, Search, Users } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import {
  UNIDADES_NEGOCIO,
  fechaCortaLocal,
  iniciales,
  nombreCompleto,
} from './constantes'
import { useEmpleados, useToggleEmpleadoActivo } from '@/lib/hooks/useRrhh'
import { cn } from '@/lib/utils'
import type { EmpleadoConSueldo } from '@/types/database'

interface Props {
  puedeVerSueldos: boolean
}

const ITEMS_UNIDAD: Record<string, string> = {
  __todas__: 'Todas las unidades',
  ...UNIDADES_NEGOCIO,
}
const ITEMS_ESTADO: Record<string, string> = {
  activos: 'Activos',
  inactivos: 'Dados de baja',
  todos: 'Todos',
}

export function TabEmpleados({ puedeVerSueldos }: Props) {
  const { data: empleados, isLoading, isError } = useEmpleados()
  const toggle = useToggleEmpleadoActivo()

  const [busqueda, setBusqueda] = useState('')
  const [unidad, setUnidad] = useState('__todas__')
  const [estado, setEstado] = useState('activos')
  const [modalAbierto, setModalAbierto] = useState(false)
  const [editar, setEditar] = useState<EmpleadoConSueldo | null>(null)

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return (empleados ?? []).filter((e) => {
      if (estado === 'activos' && !e.activo) return false
      if (estado === 'inactivos' && e.activo) return false
      if (unidad !== '__todas__' && e.unidad_negocio !== unidad) return false
      if (!q) return true
      const heno = `${e.nombre} ${e.apellido ?? ''} ${e.legajo} ${e.dni ?? ''} ${
        e.documento ?? ''
      } ${e.cuil ?? ''} ${e.puesto ?? ''}`.toLowerCase()
      return heno.includes(q)
    })
  }, [empleados, busqueda, unidad, estado])

  function abrirNuevo() {
    setEditar(null)
    setModalAbierto(true)
  }
  function abrirEdicion(e: EmpleadoConSueldo) {
    setEditar(e)
    setModalAbierto(true)
  }
  function handleBaja(e: EmpleadoConSueldo) {
    const accion = e.activo ? 'dar de baja' : 'reactivar'
    if (!confirm(`¿Querés ${accion} a "${nombreCompleto(e)}"?`)) return
    toggle.mutate({ id: e.id, activo: !e.activo })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[#391511] font-bold">Empleados</h2>
          <p className="text-[#6f3a2a] text-sm">
            Legajo del personal. Clic en un empleado para ver su ficha completa.
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

      {/* Filtros */}
      <div className="flex flex-wrap gap-2.5">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a]" />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, legajo, DNI…"
            className="pl-9 border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
          />
        </div>
        <Select
          items={ITEMS_UNIDAD}
          value={unidad}
          onValueChange={(v) => setUnidad(v ?? '__todas__')}
        >
          <SelectTrigger className="w-[200px] border-[#e4c9b0] focus:ring-[#f9b44c]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ITEMS_UNIDAD).map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          items={ITEMS_ESTADO}
          value={estado}
          onValueChange={(v) => setEstado(v ?? 'activos')}
        >
          <SelectTrigger className="w-[150px] border-[#e4c9b0] focus:ring-[#f9b44c]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ITEMS_ESTADO).map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={5} columnas={puedeVerSueldos ? 6 : 5} />
          </div>
        ) : isError ? (
          <div className="p-10 text-center text-[#c43e2c] text-sm">
            No se pudieron cargar los empleados.
          </div>
        ) : filtrados.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              <Users className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">
              {empleados && empleados.length > 0
                ? 'Ningún empleado coincide con los filtros'
                : 'Sin empleados cargados'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                  <TableHead className="text-[#391511] font-semibold">Empleado</TableHead>
                  <TableHead className="text-[#391511] font-semibold">Legajo</TableHead>
                  <TableHead className="text-[#391511] font-semibold">Unidad</TableHead>
                  <TableHead className="text-[#391511] font-semibold">DNI / CUIL</TableHead>
                  <TableHead className="text-[#391511] font-semibold">Ingreso</TableHead>
                  {puedeVerSueldos && (
                    <TableHead className="text-right text-[#391511] font-semibold">
                      Sueldo básico
                    </TableHead>
                  )}
                  <TableHead className="text-right w-32 text-[#391511] font-semibold" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.map((e) => (
                  <TableRow
                    key={e.id}
                    className={cn('border-b-[#e4c9b0]/40', !e.activo && 'opacity-50')}
                  >
                    <TableCell>
                      <Link
                        href={`/rrhh/empleados/${e.id}`}
                        className="flex items-center gap-3 group"
                      >
                        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f9d2a2]/50 text-[#6f3a2a] text-xs font-bold overflow-hidden">
                          {e.foto_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={e.foto_url}
                              alt={nombreCompleto(e)}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            iniciales(e)
                          )}
                        </span>
                        <span className="flex flex-col">
                          <span className="font-medium text-[#391511] text-sm group-hover:underline">
                            {nombreCompleto(e)}
                            {!e.activo && (
                              <span className="ml-2 text-[10px] uppercase tracking-wider font-bold text-[#c43e2c]">
                                Baja
                              </span>
                            )}
                          </span>
                          <span className="text-[#c8a58a] text-xs">
                            {e.puesto || 'Sin puesto'}
                          </span>
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-[#6f3a2a] text-sm tabular-nums">
                      {e.legajo}
                    </TableCell>
                    <TableCell className="text-[#6f3a2a] text-sm">
                      {UNIDADES_NEGOCIO[e.unidad_negocio]}
                    </TableCell>
                    <TableCell className="text-[#6f3a2a] text-sm tabular-nums">
                      {e.dni || e.documento || e.cuil || '—'}
                    </TableCell>
                    <TableCell className="text-[#6f3a2a] text-sm">
                      {fechaCortaLocal(e.fecha_ingreso)}
                    </TableCell>
                    {puedeVerSueldos && (
                      <TableCell className="text-right tabular-nums font-bold text-[#391511]">
                        <MontoARS monto={e.sueldo_basico} />
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/rrhh/empleados/${e.id}`}
                          className={cn(
                            buttonVariants({ variant: 'ghost', size: 'sm' }),
                            'h-7 w-7 p-0 text-[#6f3a2a] hover:bg-[#f9d2a2]/40'
                          )}
                          aria-label="Ver ficha"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Link>
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
        puedeVerSueldos={puedeVerSueldos}
      />
    </div>
  )
}
