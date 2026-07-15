'use client'

import { useState } from 'react'
import { BookOpen, Pencil, Plus } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { EditorReceta } from './EditorReceta'
import { CostoRecetaCelda } from './CostoRecetaCelda'
import { useRecetas } from '@/lib/hooks/useProduccion'

export function TabRecetas() {
  const { data: recetas, isLoading } = useRecetas()
  const [editor, setEditor] = useState<{ open: boolean; productoId?: number }>({
    open: false,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#6f3a2a]">
          Recetas activas. El costo se calcula recursivamente (incluye
          preparaciones intermedias).
        </p>
        <Button
          onClick={() => setEditor({ open: true, productoId: undefined })}
          className="bg-[#391511] hover:bg-[#4a1d16] text-white gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Nueva receta
        </Button>
      </div>

      <div className="rounded-xl border border-[#e4c9b0]/60 bg-white overflow-hidden">
        {isLoading ? (
          <div className="p-4">
            <SkeletonTabla filas={5} columnas={5} />
          </div>
        ) : !recetas || recetas.length === 0 ? (
          <div className="p-10 text-center text-[#6f3a2a]">
            <BookOpen className="h-7 w-7 mx-auto mb-2 text-[#c8a58a]" />
            Todavía no hay recetas. Creá la primera con “Nueva receta”.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-[#e4c9b0]/40">
                <TableHead className="text-[#6f3a2a]">Producto</TableHead>
                <TableHead className="text-[#6f3a2a]">Rinde</TableHead>
                <TableHead className="text-[#6f3a2a]">Vida útil</TableHead>
                <TableHead className="text-[#6f3a2a] text-right">Costo unit.</TableHead>
                <TableHead className="text-right text-[#6f3a2a]">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recetas.map((r) => (
                <TableRow key={r.id} className="border-[#e4c9b0]/30">
                  <TableCell className="font-medium text-[#391511]">
                    {r.producto?.nombre ?? '—'}
                  </TableCell>
                  <TableCell className="text-[#6f3a2a]">
                    {r.rendimiento} {r.unidad_rendimiento}
                  </TableCell>
                  <TableCell className="text-[#6f3a2a]">
                    {r.vida_util_dias} días
                  </TableCell>
                  <TableCell className="text-right">
                    <CostoRecetaCelda productoId={r.producto_id} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setEditor({ open: true, productoId: r.producto_id })
                      }
                      className="text-[#6f3a2a] hover:bg-[#f9d2a2]/40 gap-1"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Editar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {editor.open && (
        <EditorReceta
          key={editor.productoId ?? 'nuevo'}
          open={editor.open}
          onOpenChange={(v) => setEditor((e) => ({ ...e, open: v }))}
          productoIdInicial={editor.productoId}
        />
      )}
    </div>
  )
}
