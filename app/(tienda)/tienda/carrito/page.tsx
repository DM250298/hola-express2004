'use client'

import { CarritoProvider } from '@/components/tienda/CarritoContext'
import { HeaderTienda } from '@/components/tienda/HeaderTienda'
import { PaginaCarrito } from '@/components/tienda/PaginaCarrito'

export default function PaginaCarritoRoute() {
  return (
    <CarritoProvider>
      <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full bg-[#fdfaf6]">
        <HeaderTienda />
        <PaginaCarrito />
      </div>
    </CarritoProvider>
  )
}
