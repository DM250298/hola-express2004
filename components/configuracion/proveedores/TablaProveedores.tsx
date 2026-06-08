'use client'

import { useState } from 'react'
import { Package, Plus, Pencil, Truck } from 'lucide-react'
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
import { DrawerProveedor } from './DrawerProveedor'
import { ModalCatalogoProveedor } from './ModalCatalogoProveedor'
import { BotonesImportExport } from '@/components/import/BotonesImportExport'
import { ENTIDAD_PROVEEDORES } from '@/lib/import/entidades'
import { useProveedores } from '@/lib/hooks/useProveedores'
import type { ProveedorRow } from '@/types/database'

const COND_IVA_LABEL: Record<string, string> = {
  responsable_inscripto: 'Resp. Inscripto',
  monotributo: 'Monotributo',
  exento: 'Exento',
  consumidor_final: 'Cons. Final',
}

export function TablaProveedores() {
  const { data: proveedores, isLoading, isError } = useProveedores()
  const [drawerAbierto, setDrawerAbierto] = useState(false)
  const [proveedorEditar, setProveedorEditar] = useState<ProveedorRow | null>(null)
  const [catalogoAbierto, setCatalogoAbierto] = useState(false)
  const [proveedorCatalogo, setProveedorCatalogo] =
    useState<ProveedorRow | null>(null)

  function abrirNuevo() {
    setProveedorEditar(null)
    setDrawerAbierto(true)
  }

  function abrirEdicion(proveedor: ProveedorRow) {
    setProveedorEditar(proveedor)
    setDrawerAbierto(true)
  }

  function abrirCatalogo(proveedor: ProveedorRow) {
    setProveedorCatalogo(proveedor)
    setCatalogoAbierto(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[#391511] text-lg font-bold">
            {proveedores?.length ?? 0} proveedores
          </h2>
          <p className="text-[#6f3a2a] text-sm">
            Datos comerciales y plazos de entrega.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <BotonesImportExport def={ENTIDAD_PROVEEDORES} size="default" />
          <Button
            onClick={abrirNuevo}
            className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Nuevo proveedor
          </Button>
        </div>
      </div>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={5} columnas={6} />
          </div>
        ) : isError ? (
          <div className="p-10 text-center text-[#c43e2c] text-sm">
            No se pudieron cargar los proveedores.
          </div>
        ) : !proveedores || proveedores.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              <Truck className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">No hay proveedores aún</p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              Registrá el primero para asociarlo a tus productos.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                <TableHead className="text-[#391511] font-semibold">Nombre</TableHead>
                <TableHead className="text-[#391511] font-semibold">CUIT</TableHead>
                <TableHead className="text-[#391511] font-semibold">Contacto</TableHead>
                <TableHead className="text-[#391511] font-semibold">
                  Días entrega
                </TableHead>
                <TableHead className="text-[#391511] font-semibold">
                  Condición de pago
                </TableHead>
                <TableHead className="text-right w-24 text-[#391511] font-semibold">
                  Acciones
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {proveedores.map((p) => (
                <TableRow
                  key={p.id}
                  className="border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6]"
                >
                  <TableCell className="font-medium text-[#391511]">
                    {p.nombre}
                  </TableCell>
                  <TableCell className="text-[#6f3a2a] text-sm">
                    {p.cuit ? (
                      <div className="flex flex-col leading-tight">
                        <span className="tabular-nums">{p.cuit}</span>
                        {p.condicion_iva && (
                          <span className="text-[#c8a58a] text-xs">
                            {COND_IVA_LABEL[p.condicion_iva] ?? p.condicion_iva}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[#c8a58a] italic">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-[#6f3a2a] text-sm">
                    {p.email || p.telefono ? (
                      <div className="flex flex-col leading-tight">
                        {p.email && <span>{p.email}</span>}
                        {p.telefono && (
                          <span className="text-[#c8a58a] text-xs">{p.telefono}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[#c8a58a] italic">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-[#6f3a2a]">
                    {p.dias_entrega != null ? (
                      `${p.dias_entrega} días`
                    ) : (
                      <span className="text-[#c8a58a] italic">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-[#6f3a2a]">
                    {p.condicion_pago || (
                      <span className="text-[#c8a58a] italic">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => abrirCatalogo(p)}
                        title="Catálogo de productos"
                        className="text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511]"
                      >
                        <Package className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => abrirEdicion(p)}
                        title="Editar proveedor"
                        className="text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511]"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <DrawerProveedor
        abierto={drawerAbierto}
        onCambioAbierto={setDrawerAbierto}
        proveedor={proveedorEditar}
      />

      <ModalCatalogoProveedor
        abierto={catalogoAbierto}
        onCambioAbierto={setCatalogoAbierto}
        proveedor={proveedorCatalogo}
      />
    </div>
  )
}
