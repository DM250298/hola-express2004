'use client'

import { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BuscadorInsumo } from './BuscadorInsumo'
import { PanelCostoReceta } from './PanelCostoReceta'
import {
  useGuardarReceta,
  useProductosProduccion,
  useRecetaDeProducto,
} from '@/lib/hooks/useProduccion'
import { DIMENSION_POR_UNIDAD, UNIDADES, type UnidadCanonica } from '@/lib/utils/unidades'
import type { ProductoProduccion } from '@/lib/queries/produccion'

interface IngEdit {
  insumo_id: number
  nombre: string
  unidad_stock: string
  dimension: string
  cantidad: number
  unidad: string
  merma_pct: number
}

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Producto a editar. Undefined = receta nueva. */
  productoIdInicial?: number
}

/** Unidades canónicas que comparten dimensión con la unidad dada. */
function unidadesCompatibles(unidad: string): UnidadCanonica[] {
  const dim = DIMENSION_POR_UNIDAD[unidad as UnidadCanonica]
  if (!dim) return UNIDADES.filter((u) => u === unidad) as UnidadCanonica[]
  return UNIDADES.filter((u) => DIMENSION_POR_UNIDAD[u] === dim)
}

export function EditorReceta({ open, onOpenChange, productoIdInicial }: Props) {
  const esNueva = !productoIdInicial
  const guardar = useGuardarReceta()

  const { data: recetaExistente } = useRecetaDeProducto(productoIdInicial)
  const { data: elaborables } = useProductosProduccion([
    'semi_elaborado',
    'elaborado',
  ])

  const [productoId, setProductoId] = useState<number | undefined>(productoIdInicial)
  const [unidadProducto, setUnidadProducto] = useState('unidad')
  const [nombreProducto, setNombreProducto] = useState('')
  const [rendimiento, setRendimiento] = useState(1)
  const [vidaUtil, setVidaUtil] = useState(2)
  const [ingredientes, setIngredientes] = useState<IngEdit[]>([])
  const prefilled = useRef(false)

  // Prefill al cargar la receta existente (una sola vez por montaje).
  useEffect(() => {
    if (esNueva || prefilled.current || !recetaExistente) return
    prefilled.current = true
    setProductoId(recetaExistente.producto_id)
    setUnidadProducto(recetaExistente.producto?.unidad ?? 'unidad')
    setNombreProducto(recetaExistente.producto?.nombre ?? '')
    setRendimiento(recetaExistente.rendimiento)
    setVidaUtil(recetaExistente.vida_util_dias)
    setIngredientes(
      recetaExistente.ingredientes.map((ing) => ({
        insumo_id: ing.insumo_id,
        nombre: ing.insumo?.nombre ?? 'Insumo',
        unidad_stock: ing.insumo?.unidad ?? ing.unidad,
        dimension: DIMENSION_POR_UNIDAD[(ing.insumo?.unidad ?? ing.unidad) as UnidadCanonica] ?? 'conteo',
        cantidad: ing.cantidad,
        unidad: ing.unidad,
        merma_pct: ing.merma_pct,
      }))
    )
  }, [recetaExistente, esNueva])

  function elegirProducto(p: ProductoProduccion) {
    setProductoId(p.id)
    setUnidadProducto(p.unidad)
    setNombreProducto(p.nombre)
  }

  function agregarIngrediente(p: ProductoProduccion) {
    if (ingredientes.some((i) => i.insumo_id === p.id)) return
    setIngredientes((prev) => [
      ...prev,
      {
        insumo_id: p.id,
        nombre: p.nombre,
        unidad_stock: p.unidad,
        dimension: p.dimension,
        cantidad: 1,
        unidad: p.unidad,
        merma_pct: 0,
      },
    ])
  }

  function actualizarIng(idx: number, patch: Partial<IngEdit>) {
    setIngredientes((prev) =>
      prev.map((ing, i) => (i === idx ? { ...ing, ...patch } : ing))
    )
  }

  function quitarIng(idx: number) {
    setIngredientes((prev) => prev.filter((_, i) => i !== idx))
  }

  function handleGuardar() {
    if (!productoId) return
    guardar.mutate(
      {
        producto_id: productoId,
        rendimiento,
        unidad_rendimiento: unidadProducto,
        vida_util_dias: vidaUtil,
        ingredientes: ingredientes.map((ing) => ({
          insumo_id: ing.insumo_id,
          cantidad: ing.cantidad,
          unidad: ing.unidad,
          merma_pct: ing.merma_pct,
        })),
      },
      { onSuccess: () => onOpenChange(false) }
    )
  }

  const puedeGuardar =
    !!productoId && rendimiento > 0 && ingredientes.length > 0 && !guardar.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[#391511]">
            {esNueva ? 'Nueva receta' : `Receta · ${nombreProducto}`}
          </DialogTitle>
          <DialogDescription>
            Definí el producto elaborado, cuánto rinde y sus ingredientes
            (insumos o semi-elaborados).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Producto a elaborar */}
          <div className="space-y-1.5">
            <Label className="text-[#6f3a2a]">Producto a elaborar</Label>
            {esNueva ? (
              <select
                value={productoId ?? ''}
                onChange={(e) => {
                  const p = elaborables?.find((x) => x.id === Number(e.target.value))
                  if (p) elegirProducto(p)
                }}
                className="w-full h-9 rounded-lg border border-[#e4c9b0] bg-white px-3 text-sm text-[#391511] focus:outline-none focus:ring-2 focus:ring-[#f9b44c]"
              >
                <option value="">Elegí un semi-elaborado o elaborado…</option>
                {(elaborables ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} ({p.tipo} · {p.unidad})
                  </option>
                ))}
              </select>
            ) : (
              <div className="h-9 flex items-center px-3 rounded-lg bg-[#fdfaf6] border border-[#e4c9b0]/60 text-sm text-[#391511]">
                {nombreProducto}
              </div>
            )}
            {esNueva && (elaborables?.length ?? 0) === 0 && (
              <p className="text-xs text-[#c45e14] leading-snug">
                No tenés productos marcados como “elaborado” o “semi-elaborado”.
                Marcá el producto que vas a hacer en Configuración › Productos
                (campo <span className="font-medium">Tipo</span>) y volvé acá.
              </p>
            )}
          </div>

          {/* Rendimiento + vida útil */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#6f3a2a]">Rinde ({unidadProducto})</Label>
              <Input
                type="number"
                min={0}
                step="0.001"
                value={rendimiento}
                onChange={(e) => setRendimiento(Number(e.target.value))}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#6f3a2a]">Vida útil (días)</Label>
              <Input
                type="number"
                min={0}
                value={vidaUtil}
                onChange={(e) => setVidaUtil(Number(e.target.value))}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>
          </div>

          {/* Ingredientes */}
          <div className="space-y-2">
            <Label className="text-[#6f3a2a]">Ingredientes</Label>
            {ingredientes.length > 0 && (
              <div className="space-y-2">
                {ingredientes.map((ing, idx) => (
                  <div
                    key={ing.insumo_id}
                    className="flex items-center gap-2 rounded-lg border border-[#e4c9b0]/60 bg-white p-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[#391511] truncate">
                        {ing.nombre}
                      </div>
                      <div className="text-[10px] text-[#c8a58a]">
                        stock en {ing.unidad_stock}
                      </div>
                    </div>
                    <Input
                      type="number"
                      min={0}
                      step="0.0001"
                      value={ing.cantidad}
                      onChange={(e) =>
                        actualizarIng(idx, { cantidad: Number(e.target.value) })
                      }
                      className="w-24 border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                    />
                    <select
                      value={ing.unidad}
                      onChange={(e) => actualizarIng(idx, { unidad: e.target.value })}
                      className="h-9 rounded-lg border border-[#e4c9b0] bg-white px-2 text-sm text-[#391511] focus:outline-none focus:ring-2 focus:ring-[#f9b44c]"
                    >
                      {unidadesCompatibles(ing.unidad_stock).map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        min={0}
                        max={99}
                        value={ing.merma_pct}
                        onChange={(e) =>
                          actualizarIng(idx, { merma_pct: Number(e.target.value) })
                        }
                        className="w-16 border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                        title="Merma %"
                      />
                      <span className="text-xs text-[#c8a58a]">%</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => quitarIng(idx)}
                      className="text-[#c43e2c] hover:bg-[#c43e2c]/10 h-8 w-8 shrink-0"
                      aria-label="Quitar"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <BuscadorInsumo
              tipos={['insumo', 'semi_elaborado']}
              excluidos={[
                ...ingredientes.map((i) => i.insumo_id),
                ...(productoId ? [productoId] : []),
              ]}
              onSeleccionar={agregarIngrediente}
            />
          </div>

          <PanelCostoReceta productoId={productoId} unidad={unidadProducto} />
        </div>

        {!puedeGuardar && !guardar.isPending && (
          <p className="text-xs text-[#c45e14] text-right">
            {!productoId
              ? 'Elegí el producto a elaborar para poder guardar.'
              : ingredientes.length === 0
                ? 'Agregá al menos un ingrediente.'
                : 'Completá el rinde (debe ser mayor a 0).'}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-[#e4c9b0]/40">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleGuardar}
            disabled={!puedeGuardar}
            className="bg-[#391511] hover:bg-[#4a1d16] text-white"
          >
            {guardar.isPending ? 'Guardando…' : 'Guardar receta'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
