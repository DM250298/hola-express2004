'use client'

import Link from 'next/link'
import { ShoppingCart } from 'lucide-react'
import { useCarritoTienda } from './CarritoContext'

export function HeaderTienda() {
  const { cantidadTotal } = useCarritoTienda()

  return (
    <header className="sticky top-0 z-50 bg-[#391511] shadow-lg">
      <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/tienda" className="flex flex-col">
          <span className="text-[#f9b44c] text-2xl font-extrabold leading-none tracking-tight">
            ¡Hola!
          </span>
          <span className="text-[#f9d2a2] text-[9px] font-medium tracking-[0.18em] uppercase">
            Express · Tienda
          </span>
        </Link>

        <Link
          href="/tienda/carrito"
          className="relative p-2.5 rounded-xl bg-white/10 hover:bg-white/20 transition-colors"
        >
          <ShoppingCart className="h-5 w-5 text-[#f9d2a2]" />
          {cantidadTotal > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-[#f9b44c] text-[#391511] text-[10px] font-extrabold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1">
              {cantidadTotal}
            </span>
          )}
        </Link>
      </div>
    </header>
  )
}
