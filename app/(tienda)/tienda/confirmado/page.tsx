'use client'

import { Suspense } from 'react'
import { CarritoProvider } from '@/components/tienda/CarritoContext'
import { HeaderTienda } from '@/components/tienda/HeaderTienda'
import { PaginaConfirmado } from '@/components/tienda/PaginaConfirmado'

export default function PaginaConfirmadoRoute() {
  return (
    <CarritoProvider>
      <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full bg-[#fdfaf6]">
        <HeaderTienda />
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center">
              <p className="text-[#6f3a2a]">Cargando…</p>
            </div>
          }
        >
          <PaginaConfirmado />
        </Suspense>
      </div>
    </CarritoProvider>
  )
}
