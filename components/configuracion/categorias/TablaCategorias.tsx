'use client'

import { useState } from 'react'
import { Plus, Pencil, Tag } from 'lucide-react'
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
import { BotonesImportExport } from '@/components/import/BotonesImportExport'
import { ENTIDAD_CATEGORIAS } from '@/lib/import/entidades'
import { DrawerCategoria } from './DrawerCategoria'
import { useCategorias } from '@/lib/hooks/useCategorias'
import type { CategoriaRow } from '@/types/database'

export function TablaCategorias() {
  const { data: categorias, isLoading, isError } = useCategorias()
  const [drawerAbierto, setDrawerAbierto] = useState(false)
  const [categoriaEditar, setCategoriaEditar] = useState<CategoriaRow | null>(null)

  function abrirNueva() {
    setCategoriaEditar(null)
    setDrawerAbierto(true)
  }

  function abrirEdicion(categoria: CategoriaRow) {
    setCategoriaEditar(categoria)
    setDrawerAbierto(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[#391511] text-lg font-bold">
            {categorias?.length ?? 0} categorías
          </h2>
          <p className="text-[#6f3a2a] text-sm">
            Agrupan productos para reportes y filtros.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <BotonesImportExport def={ENTIDAD_CATEGORIAS} size="default" />
          <Button
            onClick={abrirNueva}
            className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Nueva categoría
          </Button>
        </div>
      </div>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={5} columnas={3} />
          </div>
        ) : isError ? (
          <div className="p-10 text-center text-[#c43e2c] text-sm">
            No se pudieron cargar las categorías.
          </div>
        ) : !categorias || categorias.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              <Tag className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">No hay categorías aún</p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              Creá la primera para organizar tus productos.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                <TableHead className="text-[#391511] font-semibold">Nombre</TableHead>
                <TableHead className="text-[#391511] font-semibold">
                  Descripción
                </TableHead>
                <TableHead className="text-right w-24 text-[#391511] font-semibold">
                  Acciones
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categorias.map((cat) => (
                <TableRow
                  key={cat.id}
                  className="border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6]"
                >
                  <TableCell className="font-medium text-[#391511]">
                    {cat.nombre}
                  </TableCell>
                  <TableCell className="text-[#6f3a2a] text-sm">
                    {cat.descripcion || (
                      <span className="text-[#c8a58a] italic">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => abrirEdicion(cat)}
                      className="text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511]"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <DrawerCategoria
        abierto={drawerAbierto}
        onCambioAbierto={setDrawerAbierto}
        categoria={categoriaEditar}
      />
    </div>
  )
}
