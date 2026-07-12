'use client'

import { Package, Sparkles } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import { ImagenProductoPOS } from './ImagenProductoPOS'
import { useProductosFrecuentesTurno } from '@/lib/hooks/useVentas'
import { useProductos } from '@/lib/hooks/useProductos'
import type { ProductoFrecuente } from '@/lib/queries/ventas'
import type { ProductoConRelaciones } from '@/lib/queries/productos'
import { cn } from '@/lib/utils'

type ProductoGrid = ProductoConRelaciones | ProductoFrecuente

interface Props {
  turnoId: number
  onSeleccionar: (p: ProductoGrid) => void
  /** Si es true, permite seleccionar productos aunque estén sin stock. */
  permitirSinStock?: boolean
}

const MAX_CATALOGO = 12

/** Datos normalizados de un producto (frecuente o de catálogo). */
function datosProducto(p: ProductoGrid) {
  return {
    key: 'id' in p ? p.id : p.producto_id,
    nombre: p.nombre,
    precio: p.precio_venta,
    stock: p.stock_actual,
    venta_por_peso: ('venta_por_peso' in p ? p.venta_por_peso : false) ?? false,
    imagen_url: p.imagen_url ?? null,
  }
}

export function GridProductosFrecuentes({
  turnoId,
  onSeleccionar,
  permitirSinStock = false,
}: Props) {
  const { data: frecuentes, isLoading: cargandoFrecuentes } =
    useProductosFrecuentesTurno(turnoId)
  // Catálogo activo vendible: respaldo cuando todavía no hay frecuentes
  // (turno nuevo o sin conexión). Excluye los "no ofrecer en ventas".
  const { data: catalogo, isLoading: cargandoCatalogo } = useProductos({
    activo: true,
    solo_vendibles: true,
  })

  const hayFrecuentes = (frecuentes ?? []).length > 0
  const lista: ProductoGrid[] = hayFrecuentes
    ? (frecuentes ?? [])
    : (catalogo ?? []).slice(0, MAX_CATALOGO)

  const cargando =
    cargandoFrecuentes || (!hayFrecuentes && cargandoCatalogo)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        {hayFrecuentes ? (
          <Sparkles className="h-3.5 w-3.5 text-[#f9b44c]" />
        ) : (
          <Package className="h-3.5 w-3.5 text-[#f9b44c]" />
        )}
        <h3 className="text-[#6f3a2a] text-xs uppercase tracking-wider font-semibold">
          {hayFrecuentes ? 'Frecuentes del turno' : 'Productos'}
        </h3>
      </div>

      {cargando ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton
              key={i}
              className="aspect-square rounded-xl bg-[#f9d2a2]/30"
            />
          ))}
        </div>
      ) : lista.length === 0 ? (
        <div className="bg-white/60 border border-dashed border-[#e4c9b0] rounded-xl p-6 text-center">
          <p className="text-[#6f3a2a] text-sm">
            No hay productos para mostrar. Si estás sin conexión, abrí el POS
            con internet al menos una vez para guardar el catálogo.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {lista.map((p) => {
            const d = datosProducto(p)
            const sinStock = d.stock <= 0
            const bloqueado = sinStock && !permitirSinStock
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => !bloqueado && onSeleccionar(p)}
                disabled={bloqueado}
                className={cn(
                  'rounded-xl border bg-white flex flex-col text-left transition-all overflow-hidden',
                  bloqueado
                    ? 'opacity-50 cursor-not-allowed border-[#e4c9b0]/60'
                    : 'border-[#e4c9b0]/60 hover:border-[#f9b44c] hover:shadow-md active:scale-95 active:bg-[#f9d2a2]/40'
                )}
              >
                <ImagenProductoPOS
                  url={d.imagen_url}
                  nombre={d.nombre}
                  className="aspect-square w-full"
                  iconClassName="h-8 w-8"
                />
                <div className="p-2.5 flex flex-col gap-1 flex-1">
                  <div className="text-[#391511] font-medium text-xs leading-tight line-clamp-2 flex-1">
                    {d.nombre}
                  </div>
                  <div>
                    <div className="text-[#391511] font-bold text-sm tabular-nums">
                      <MontoARS monto={d.precio} />
                      {d.venta_por_peso && (
                        <span className="text-[10px] text-[#6f3a2a] font-normal">/kg</span>
                      )}
                    </div>
                    <div className="text-[10px] text-[#c8a58a] mt-0.5">
                      {d.venta_por_peso ? `${d.stock} kg disp.` : `Stock: ${d.stock}`}
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
