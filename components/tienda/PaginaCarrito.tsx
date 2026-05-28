'use client'

import Link from 'next/link'
import {
  ArrowLeft,
  Minus,
  Plus,
  ShoppingCart,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatearMonto } from '@/lib/utils/formato'
import { useCarritoTienda } from './CarritoContext'

export function PaginaCarrito() {
  const { items, total, cantidadTotal, cambiarCantidad, quitar, vaciar } =
    useCarritoTienda()

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="p-4 rounded-full bg-[#f9d2a2]/40 mb-4">
          <ShoppingCart className="h-10 w-10 text-[#6f3a2a]" />
        </div>
        <h2 className="text-[#391511] font-extrabold text-xl">
          Tu carrito está vacío
        </h2>
        <p className="text-[#6f3a2a] text-sm mt-2">
          Explorá nuestros productos y agregá lo que necesites.
        </p>
        <Link
          href="/tienda"
          className="mt-6 px-6 py-3 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-extrabold rounded-xl transition-colors"
        >
          Ver productos
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            href="/tienda"
            className="p-2 rounded-xl hover:bg-[#f9d2a2]/40 text-[#6f3a2a] transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-[#391511] text-xl font-extrabold">
            Mi carrito
          </h1>
          <span className="text-[#6f3a2a] text-sm">
            · {cantidadTotal} {cantidadTotal === 1 ? 'ítem' : 'ítems'}
          </span>
        </div>
        <button
          type="button"
          onClick={vaciar}
          className="text-[#c43e2c] text-xs font-bold hover:underline"
        >
          Vaciar
        </button>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto px-4 space-y-3 pb-4">
        {items.map((item) => (
          <div
            key={item.producto_id}
            className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-4 flex gap-3"
          >
            <div className="flex-1 min-w-0">
              <h3 className="text-[#391511] font-bold text-sm leading-tight">
                {item.nombre}
              </h3>
              <p className="text-[#6f3a2a] text-xs mt-0.5 tabular-nums">
                {formatearMonto(item.precio_unitario)} c/u
              </p>
              <p className="text-[#391511] font-extrabold text-base mt-1 tabular-nums">
                {formatearMonto(item.precio_unitario * item.cantidad)}
              </p>
            </div>

            <div className="flex flex-col items-end justify-between">
              <button
                type="button"
                onClick={() => quitar(item.producto_id)}
                className="p-1.5 rounded-lg text-[#c8a58a] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c] transition-colors"
              >
                <Trash2 className="h-4 w-4" />
              </button>

              <div className="flex items-center gap-1 bg-[#fdfaf6] border border-[#e4c9b0] rounded-xl">
                <button
                  type="button"
                  onClick={() =>
                    cambiarCantidad(
                      item.producto_id,
                      item.cantidad - 1
                    )
                  }
                  className="h-8 w-8 flex items-center justify-center hover:bg-[#f9d2a2]/40 rounded-l-xl transition-colors"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="w-8 text-center font-extrabold text-[#391511] tabular-nums text-sm">
                  {item.cantidad}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    cambiarCantidad(
                      item.producto_id,
                      item.cantidad + 1
                    )
                  }
                  disabled={item.cantidad >= item.stock_disponible}
                  className="h-8 w-8 flex items-center justify-center hover:bg-[#f9d2a2]/40 rounded-r-xl transition-colors disabled:opacity-30"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer fijo con total y botón checkout */}
      <div className="sticky bottom-0 bg-white border-t border-[#e4c9b0]/60 px-4 py-4 space-y-3 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
        <div className="flex items-baseline justify-between">
          <span className="text-[#6f3a2a] text-sm font-medium uppercase tracking-wider">
            Total
          </span>
          <span className="text-[#391511] text-2xl font-extrabold tabular-nums">
            {formatearMonto(total)}
          </span>
        </div>
        <Link
          href="/tienda/checkout"
          className="block w-full h-14 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-extrabold rounded-xl text-base flex items-center justify-center gap-2 transition-colors shadow-md"
        >
          Hacer pedido
        </Link>
      </div>
    </div>
  )
}
