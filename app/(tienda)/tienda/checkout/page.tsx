'use client'

import { CarritoProvider } from '@/components/tienda/CarritoContext'
import { HeaderTienda } from '@/components/tienda/HeaderTienda'
import { PaginaCheckout } from '@/components/tienda/PaginaCheckout'

export default function PaginaCheckoutRoute() {
  return (
    <CarritoProvider>
      <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full bg-[#fdfaf6]">
        <HeaderTienda />
        <PaginaCheckout />
      </div>
    </CarritoProvider>
  )
}
