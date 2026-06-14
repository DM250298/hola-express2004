'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, PackageSearch, ShoppingCart } from 'lucide-react'
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
import { MontoARS } from '@/components/shared/MontoARS'
import { InputNumero } from './InputNumero'
import { useInsumosAComprar } from '@/lib/hooks/useProduccion'
import { guardarHandoffReposicion } from '@/lib/compras/handoffReposicion'
import type { InsumoAComprar } from '@/lib/queries/produccion'
import { cn } from '@/lib/utils'

interface FilaSel {
  seleccionado: boolean
  cantidad: number
}

interface GrupoProveedor {
  proveedor_id: number | null
  proveedor_nombre: string | null
  items: InsumoAComprar[]
}

const SIN_PROVEEDOR = 'sin'

export function TabComprarInsumos() {
  const router = useRouter()
  const { data: insumos, isLoading, isError } = useInsumosAComprar()
  const [seleccion, setSeleccion] = useState<Record<number, FilaSel>>({})

  // Pre-selecciona lo que falta (a_comprar > 0) con su cantidad sugerida.
  useEffect(() => {
    if (!insumos) return
    const inicial: Record<number, FilaSel> = {}
    for (const i of insumos) {
      inicial[i.insumo_id] = {
        seleccionado: i.a_comprar > 0,
        cantidad: i.a_comprar,
      }
    }
    setSeleccion(inicial)
  }, [insumos])

  const grupos = useMemo<GrupoProveedor[]>(() => {
    const map = new Map<string, GrupoProveedor>()
    for (const i of insumos ?? []) {
      const clave = i.proveedor_id == null ? SIN_PROVEEDOR : String(i.proveedor_id)
      if (!map.has(clave)) {
        map.set(clave, {
          proveedor_id: i.proveedor_id,
          proveedor_nombre: i.proveedor_nombre,
          items: [],
        })
      }
      map.get(clave)!.items.push(i)
    }
    // Proveedores con nombre primero; "Sin proveedor" al final.
    return [...map.values()].sort((a, b) => {
      if (a.proveedor_id == null) return 1
      if (b.proveedor_id == null) return -1
      return (a.proveedor_nombre ?? '').localeCompare(b.proveedor_nombre ?? '')
    })
  }, [insumos])

  function toggle(id: number, sugerida: number) {
    setSeleccion((prev) => ({
      ...prev,
      [id]: {
        seleccionado: !prev[id]?.seleccionado,
        cantidad: prev[id]?.cantidad ?? sugerida,
      },
    }))
  }

  function setCantidad(id: number, valor: number) {
    setSeleccion((prev) => ({
      ...prev,
      [id]: { seleccionado: prev[id]?.seleccionado ?? true, cantidad: valor },
    }))
  }

  function itemsSeleccionados(grupo: GrupoProveedor) {
    return grupo.items.filter((i) => {
      const sel = seleccion[i.insumo_id]
      return sel?.seleccionado && (sel?.cantidad ?? 0) > 0
    })
  }

  function armarOrden(grupo: GrupoProveedor) {
    if (grupo.proveedor_id == null) return
    const elegidos = itemsSeleccionados(grupo)
    if (elegidos.length === 0) return
    // Mismo handoff que usa Reposición: deja la selección en sessionStorage y
    // el editor único de orden (/pedidos/nuevo) la levanta pre-cargada.
    guardarHandoffReposicion({
      proveedor_id: grupo.proveedor_id,
      items: elegidos.map((i) => ({
        producto_id: i.insumo_id,
        nombre: i.insumo_nombre,
        codigo_barras: i.codigo_barras,
        cantidad_pedida: seleccion[i.insumo_id]?.cantidad ?? i.a_comprar,
        precio_costo: i.precio_costo,
      })),
    })
    router.push('/pedidos/nuevo')
  }

  return (
    <div className="space-y-5">
      <p className="text-[#6f3a2a] text-sm">
        Insumos que hacen falta para las órdenes de producción en borrador, neteados
        contra el stock actual y agrupados por proveedor. Armá la orden de compra
        directamente desde acá.
      </p>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={6} columnas={6} />
          </div>
        ) : isError ? (
          <div className="p-10 text-center text-[#c43e2c] text-sm">
            No se pudieron calcular los insumos a comprar.
          </div>
        ) : grupos.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              <PackageSearch className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">No hay insumos para comprar</p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              Aparecen cuando haya órdenes de producción en borrador cuyos insumos no
              alcanzan con el stock actual.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#e4c9b0]/50">
            {grupos.map((grupo) => {
              const clave =
                grupo.proveedor_id == null ? SIN_PROVEEDOR : String(grupo.proveedor_id)
              const elegidos = itemsSeleccionados(grupo)
              const totalEstimado = elegidos.reduce(
                (acc, i) => acc + (seleccion[i.insumo_id]?.cantidad ?? 0) * i.precio_costo,
                0
              )
              const sinProveedor = grupo.proveedor_id == null

              return (
                <div key={clave} className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <h3 className="text-sm font-semibold text-[#391511] flex items-center gap-1.5">
                      <ShoppingCart className="h-4 w-4 text-[#f9b44c]" />
                      {grupo.proveedor_nombre ?? 'Sin proveedor asignado'}
                      <span className="text-[#c8a58a] font-normal">
                        · {grupo.items.length} insumo(s)
                      </span>
                    </h3>
                    {!sinProveedor && (
                      <Button
                        onClick={() => armarOrden(grupo)}
                        disabled={elegidos.length === 0}
                        className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5 disabled:opacity-40"
                      >
                        <ShoppingCart className="h-4 w-4" />
                        Armar orden de compra
                      </Button>
                    )}
                  </div>

                  {sinProveedor && (
                    <div className="flex items-center gap-2 text-xs text-[#6f3a2a] bg-[#f9b44c]/15 rounded-lg px-3 py-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-[#f9b44c] shrink-0" />
                      Asigná un proveedor a estos insumos (Configuración → Productos)
                      para poder armar la orden.
                    </div>
                  )}

                  <div className="overflow-x-auto rounded-xl border border-[#e4c9b0]/50">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                          <TableHead className="w-10" />
                          <TableHead className="text-[#391511] font-semibold">
                            Insumo
                          </TableHead>
                          <TableHead className="text-right text-[#391511] font-semibold">
                            Necesario
                          </TableHead>
                          <TableHead className="text-right text-[#391511] font-semibold">
                            Stock
                          </TableHead>
                          <TableHead className="text-[#391511] font-semibold w-32">
                            A comprar
                          </TableHead>
                          <TableHead className="text-right text-[#391511] font-semibold">
                            Costo est.
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {grupo.items.map((i) => {
                          const sel = seleccion[i.insumo_id]
                          const marcado = sel?.seleccionado ?? false
                          const cantidad = sel?.cantidad ?? 0
                          return (
                            <TableRow
                              key={i.insumo_id}
                              className={cn(
                                'border-b-[#e4c9b0]/40',
                                !marcado && 'opacity-50'
                              )}
                            >
                              <TableCell>
                                <input
                                  type="checkbox"
                                  checked={marcado}
                                  onChange={() => toggle(i.insumo_id, i.a_comprar)}
                                  className="accent-[#f9b44c] h-4 w-4"
                                  aria-label={`Incluir ${i.insumo_nombre}`}
                                />
                              </TableCell>
                              <TableCell>
                                <div className="font-medium text-[#391511] text-sm">
                                  {i.insumo_nombre}
                                </div>
                                {i.codigo_barras && (
                                  <div className="text-[#c8a58a] text-xs font-mono">
                                    {i.codigo_barras}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-[#6f3a2a]">
                                {i.requerido} {i.unidad}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-[#6f3a2a]">
                                {i.stock_actual} {i.unidad}
                              </TableCell>
                              <TableCell>
                                <InputNumero
                                  value={cantidad}
                                  onChange={(n) => setCantidad(i.insumo_id, n)}
                                  min={0}
                                  step="any"
                                  className="h-8 w-24 text-center tabular-nums"
                                />
                              </TableCell>
                              <TableCell className="text-right">
                                <MontoARS
                                  monto={cantidad * i.precio_costo}
                                  className="text-[#391511]"
                                />
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  {elegidos.length > 0 && (
                    <div className="flex items-center justify-end gap-2 text-sm text-[#6f3a2a]">
                      <span className="font-semibold text-[#391511]">
                        {elegidos.length}
                      </span>{' '}
                      insumo(s) · total estimado
                      <MontoARS monto={totalEstimado} className="font-bold text-[#391511]" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
