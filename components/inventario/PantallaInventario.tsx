'use client'

import Link from 'next/link'
import { SlidersHorizontal } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { TabStockInventario } from './TabStockInventario'
import { cn } from '@/lib/utils'

export function PantallaInventario() {
  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[#391511] text-2xl font-bold">Stock</h1>
          <p className="text-[#6f3a2a] text-sm mt-1">
            Vista operativa del catálogo con alertas, filtros y acciones por producto.
          </p>
        </div>
        <Link
          href="/inventario/control"
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'gap-1.5 border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#f9d2a2]/40'
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Control de stock
        </Link>
      </header>

      <TabStockInventario />
    </div>
  )
}
