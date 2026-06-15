'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, SlidersHorizontal } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button, buttonVariants } from '@/components/ui/button'
import { TabStockInventario } from './TabStockInventario'
import { PantallaABC } from './clasificacion-abc/PantallaABC'
import { DrawerProducto } from '@/components/configuracion/productos/DrawerProducto'
import { BotonesImportExport } from '@/components/import/BotonesImportExport'
import { ENTIDAD_PRODUCTOS } from '@/lib/import/entidades'
import { cn } from '@/lib/utils'

interface Props {
  /** Pestaña inicial (viene de ?tab= en la URL). */
  tabInicial?: 'stock' | 'ranking'
}

export function PantallaInventario({ tabInicial = 'stock' }: Props) {
  const [nuevoAbierto, setNuevoAbierto] = useState(false)

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[#391511] text-2xl font-bold">Stock</h1>
          <p className="text-[#6f3a2a] text-sm mt-1">
            Lo que tenés, lo que falta y lo que más se vende — todo en un lugar.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <BotonesImportExport def={ENTIDAD_PRODUCTOS} />
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
          <Button
            size="sm"
            onClick={() => setNuevoAbierto(true)}
            className="gap-1.5 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
          >
            <Plus className="h-4 w-4" />
            Nuevo producto
          </Button>
        </div>
      </header>

      <DrawerProducto
        abierto={nuevoAbierto}
        onCambioAbierto={setNuevoAbierto}
        producto={null}
      />

      <Tabs defaultValue={tabInicial} className="space-y-4">
        <TabsList className="bg-white border border-[#e4c9b0]/60 p-1 h-auto flex-wrap">
          <TabsTrigger
            value="stock"
            className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511]"
          >
            Stock
          </TabsTrigger>
          <TabsTrigger
            value="ranking"
            className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511]"
          >
            Ranking de ventas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="stock">
          <TabStockInventario />
        </TabsContent>
        <TabsContent value="ranking">
          <PantallaABC embebido />
        </TabsContent>
      </Tabs>
    </div>
  )
}
