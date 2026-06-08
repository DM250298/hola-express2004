'use client'

import { useEffect, useState } from 'react'
import { Plus, Search, UserPlus, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { ModalCliente } from './ModalCliente'
import { ModalDetalleCliente } from './ModalDetalleCliente'
import { BotonesImportExport } from '@/components/import/BotonesImportExport'
import { ENTIDAD_CLIENTES } from '@/lib/import/entidades'
import { useClientes } from '@/lib/hooks/useClientes'
import { formatearFechaCorta } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import type { ClienteRow, VistaClienteRow } from '@/types/database'

export function PantallaClientes() {
  const [busquedaInput, setBusquedaInput] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [modalAbierto, setModalAbierto] = useState(false)
  const [clienteEditar, setClienteEditar] = useState<ClienteRow | null>(null)
  const [detalleId, setDetalleId] = useState<number | null>(null)
  const [detalleAbierto, setDetalleAbierto] = useState(false)

  // Debounce de la búsqueda
  useEffect(() => {
    const t = setTimeout(() => setBusqueda(busquedaInput), 250)
    return () => clearTimeout(t)
  }, [busquedaInput])

  const { data: clientes, isLoading, isError } = useClientes({
    busqueda: busqueda || undefined,
  })

  function abrirNuevo() {
    setClienteEditar(null)
    setModalAbierto(true)
  }

  function abrirEdicion(c: VistaClienteRow) {
    setClienteEditar(c)
    setModalAbierto(true)
  }

  function abrirDetalle(id: number) {
    setDetalleId(id)
    setDetalleAbierto(true)
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[#391511] text-2xl font-bold">Clientes</h1>
          <p className="text-[#6f3a2a] text-sm mt-1">
            Registro de clientes e historial de compras.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <BotonesImportExport def={ENTIDAD_CLIENTES} size="default" />
          <Button
            onClick={abrirNuevo}
            className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Nuevo cliente
          </Button>
        </div>
      </header>

      {/* Buscador */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a] pointer-events-none" />
        <Input
          value={busquedaInput}
          onChange={(e) => setBusquedaInput(e.target.value)}
          placeholder="Buscar por nombre, teléfono o documento…"
          className="pl-9 pr-9 border-[#e4c9b0] focus-visible:ring-[#f9b44c] bg-white"
        />
        {busquedaInput && (
          <button
            type="button"
            onClick={() => setBusquedaInput('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[#c8a58a] hover:text-[#391511]"
            aria-label="Limpiar"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={6} columnas={5} />
          </div>
        ) : isError ? (
          <div className="p-10 text-center text-[#c43e2c] text-sm">
            No se pudieron cargar los clientes.
          </div>
        ) : !clientes || clientes.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              {busqueda ? (
                <Search className="h-6 w-6 text-[#6f3a2a]" />
              ) : (
                <Users className="h-6 w-6 text-[#6f3a2a]" />
              )}
            </div>
            <p className="text-[#391511] font-semibold">
              {busqueda
                ? 'Sin resultados'
                : 'Todavía no hay clientes cargados'}
            </p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              {busqueda
                ? 'Probá con otro nombre o documento.'
                : 'Registrá tu primer cliente para llevar su historial.'}
            </p>
            {!busqueda && (
              <Button
                onClick={abrirNuevo}
                variant="outline"
                className="mt-3 border-[#e4c9b0] text-[#6f3a2a] gap-1.5"
              >
                <UserPlus className="h-4 w-4" />
                Nuevo cliente
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                  <TableHead className="text-[#391511] font-semibold">
                    Cliente
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Documento
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Compras
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Total gastado
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Última compra
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientes.map((c) => (
                  <TableRow
                    key={c.id}
                    onClick={() => abrirDetalle(c.id)}
                    className={cn(
                      'border-b-[#e4c9b0]/40 cursor-pointer hover:bg-[#fdfaf6]',
                      !c.activo && 'opacity-50'
                    )}
                  >
                    <TableCell>
                      <div className="font-medium text-[#391511] text-sm">
                        {c.nombre}
                        {!c.activo && (
                          <span className="ml-2 text-[10px] uppercase tracking-wider font-bold text-[#c43e2c]">
                            Inactivo
                          </span>
                        )}
                      </div>
                      <div className="text-[#c8a58a] text-xs">
                        {[c.telefono, c.email].filter(Boolean).join(' · ') ||
                          'Sin contacto'}
                      </div>
                    </TableCell>
                    <TableCell className="text-[#6f3a2a] text-sm tabular-nums">
                      {c.documento || '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-[#391511]">
                      {c.cantidad_compras}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-bold text-[#391511]">
                      <MontoARS monto={c.total_gastado} />
                    </TableCell>
                    <TableCell className="text-[#6f3a2a] text-sm">
                      {c.ultima_compra
                        ? formatearFechaCorta(c.ultima_compra)
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <ModalCliente
        abierto={modalAbierto}
        onCambioAbierto={setModalAbierto}
        cliente={clienteEditar}
      />

      <ModalDetalleCliente
        abierto={detalleAbierto}
        onCambioAbierto={setDetalleAbierto}
        clienteId={detalleId}
        onEditar={() => {
          const c = clientes?.find((x) => x.id === detalleId)
          if (c) {
            setDetalleAbierto(false)
            abrirEdicion(c)
          }
        }}
      />
    </div>
  )
}
