'use client'

import { useEffect, useState } from 'react'
import { Search, Plus, Check, Minus, ShoppingBag } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatearMonto } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import { useCarritoTienda, type ItemCarritoTienda } from './CarritoContext'

interface ProductoCatalogo {
  id: number
  nombre: string
  codigo_barras: string | null
  precio_venta: number
  stock_actual: number
  categoria_id: number | null
  categorias: { id: number; nombre: string } | null
}

interface Categoria {
  id: number
  nombre: string
}

export function CatalogoTienda() {
  const [productos, setProductos] = useState<ProductoCatalogo[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [categoriaActiva, setCategoriaActiva] = useState<number | null>(null)

  const carrito = useCarritoTienda()

  useEffect(() => {
    async function cargar() {
      try {
        const res = await fetch('/api/tienda/catalogo')
        if (!res.ok) throw new Error('Error al cargar el catálogo')
        const data = await res.json()
        setProductos(data.productos)
        setCategorias(data.categorias)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error desconocido')
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [])

  // Filtrar productos
  const filtrados = productos.filter((p) => {
    if (categoriaActiva && p.categoria_id !== categoriaActiva) return false
    if (busqueda.trim()) {
      const q = busqueda.trim().toLowerCase()
      if (
        !p.nombre.toLowerCase().includes(q) &&
        !(p.codigo_barras && p.codigo_barras.includes(q))
      )
        return false
    }
    return true
  })

  if (cargando) {
    return (
      <div className="space-y-4 px-4 py-4">
        <Skeleton className="h-10 rounded-xl bg-[#f9d2a2]/30" />
        <div className="flex gap-2 overflow-x-auto pb-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-8 w-20 rounded-full bg-[#f9d2a2]/30 shrink-0"
            />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-40 rounded-2xl bg-[#f9d2a2]/30"
            />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-[#c43e2c] font-bold">{error}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1">
      {/* Buscador */}
      <div className="px-4 pt-4 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a]" />
          <Input
            placeholder="Buscar productos…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pl-9 h-11 rounded-xl border-[#e4c9b0] bg-white focus-visible:ring-[#f9b44c] text-base"
          />
        </div>
      </div>

      {/* Categorías (scroll horizontal) */}
      <div className="px-4 pb-3">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button
            type="button"
            onClick={() => setCategoriaActiva(null)}
            className={cn(
              'shrink-0 px-4 py-1.5 rounded-full text-sm font-bold transition-all',
              categoriaActiva === null
                ? 'bg-[#391511] text-white'
                : 'bg-white border border-[#e4c9b0] text-[#6f3a2a]'
            )}
          >
            Todo
          </button>
          {categorias.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() =>
                setCategoriaActiva(
                  categoriaActiva === cat.id ? null : cat.id
                )
              }
              className={cn(
                'shrink-0 px-4 py-1.5 rounded-full text-sm font-bold transition-all whitespace-nowrap',
                categoriaActiva === cat.id
                  ? 'bg-[#391511] text-white'
                  : 'bg-white border border-[#e4c9b0] text-[#6f3a2a]'
              )}
            >
              {cat.nombre}
            </button>
          ))}
        </div>
      </div>

      {/* Grid de productos */}
      {filtrados.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center">
          <ShoppingBag className="h-12 w-12 text-[#c8a58a] mb-3" />
          <p className="text-[#391511] font-bold">
            No encontramos productos
          </p>
          <p className="text-[#6f3a2a] text-sm mt-1">
            Probá con otra búsqueda o categoría.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 px-4 pb-24">
          {filtrados.map((prod) => (
            <TarjetaProducto
              key={prod.id}
              producto={prod}
              enCarrito={carrito.items.find(
                (i) => i.producto_id === prod.id
              )}
              onAgregar={() =>
                carrito.agregar({
                  producto_id: prod.id,
                  nombre: prod.nombre,
                  precio_unitario: prod.precio_venta,
                  cantidad: 1,
                  stock_disponible: prod.stock_actual,
                })
              }
              onCambiarCantidad={(cant) =>
                carrito.cambiarCantidad(prod.id, cant)
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Tarjeta de producto ────────────────────────────────────────────────────

interface TarjetaProps {
  producto: ProductoCatalogo
  enCarrito: ItemCarritoTienda | undefined
  onAgregar: () => void
  onCambiarCantidad: (cant: number) => void
}

function TarjetaProducto({
  producto,
  enCarrito,
  onAgregar,
  onCambiarCantidad,
}: TarjetaProps) {
  const cantEnCarrito = enCarrito?.cantidad ?? 0
  const catNombre =
    (producto.categorias as { nombre: string } | null)?.nombre ?? null

  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm flex flex-col">
      {/* Info del producto */}
      <div className="p-3 flex-1">
        {catNombre && (
          <span className="text-[9px] font-bold uppercase tracking-wider text-[#c8a58a]">
            {catNombre}
          </span>
        )}
        <h3 className="text-[#391511] font-bold text-sm leading-tight mt-0.5 line-clamp-2">
          {producto.nombre}
        </h3>
        <p className="text-[#391511] text-lg font-extrabold mt-2 tabular-nums">
          {formatearMonto(producto.precio_venta)}
        </p>
        {producto.stock_actual <= 5 && (
          <p className="text-[10px] text-[#c43e2c] font-medium mt-0.5">
            ¡Últimas {producto.stock_actual} unidades!
          </p>
        )}
      </div>

      {/* Botón agregar / controles cantidad */}
      <div className="px-3 pb-3">
        {cantEnCarrito > 0 ? (
          <div className="flex items-center justify-between bg-[#391511] rounded-xl h-10">
            <button
              type="button"
              onClick={() => onCambiarCantidad(cantEnCarrito - 1)}
              className="h-10 w-10 flex items-center justify-center text-white hover:bg-white/10 rounded-l-xl transition-colors"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="text-white font-extrabold tabular-nums text-sm">
              {cantEnCarrito}
            </span>
            <button
              type="button"
              onClick={() => onCambiarCantidad(cantEnCarrito + 1)}
              disabled={cantEnCarrito >= producto.stock_actual}
              className="h-10 w-10 flex items-center justify-center text-white hover:bg-white/10 rounded-r-xl transition-colors disabled:opacity-30"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onAgregar}
            className="w-full h-10 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-extrabold rounded-xl flex items-center justify-center gap-1.5 text-sm transition-colors"
          >
            <Plus className="h-4 w-4" />
            Agregar
          </button>
        )}
      </div>
    </div>
  )
}
