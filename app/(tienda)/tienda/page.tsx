'use client'

import { CarritoProvider } from '@/components/tienda/CarritoContext'
import { HeaderTienda } from '@/components/tienda/HeaderTienda'
import { CatalogoTienda } from '@/components/tienda/CatalogoTienda'

export default function PaginaTienda() {
  return (
    <CarritoProvider>
      <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full bg-[#fdfaf6]">
        <HeaderTienda />
        <CatalogoTienda />
      </div>
    </CarritoProvider>
  )
}
