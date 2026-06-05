'use client'

import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TabConteo } from './TabConteo'
import { TabAjustes } from './TabAjustes'
import { PantallaMovimientos } from './movimientos/PantallaMovimientos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { tienePermiso } from '@/lib/permisos'

export function PantallaControl() {
  const { data: usuario } = useUsuario()
  const puedeAjustar = tienePermiso(usuario?.permisos, 'inventario_ajustes')

  const tabInicial = 'conteo'

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <Link
          href="/inventario"
          className="inline-flex items-center gap-1 text-sm text-[#6f3a2a] hover:text-[#391511] transition-colors mb-2"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Stock
        </Link>
        <h1 className="text-[#391511] text-2xl font-bold">Control de stock</h1>
        <p className="text-[#6f3a2a] text-sm mt-1">
          Conteos físicos, ajustes con razón y movimientos auditables.
        </p>
      </div>

      <Tabs defaultValue={tabInicial} className="space-y-4">
        <TabsList className="bg-white border border-[#e4c9b0]/60 p-1 h-auto flex-wrap">
          <TabsTrigger
            value="conteo"
            className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511]"
          >
            Conteo
          </TabsTrigger>
          {puedeAjustar && (
            <TabsTrigger
              value="ajustes"
              className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511]"
            >
              Ajustes
            </TabsTrigger>
          )}
          <TabsTrigger
            value="movimientos"
            className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511]"
          >
            Movimientos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="conteo">
          <TabConteo />
        </TabsContent>
        {puedeAjustar && (
          <TabsContent value="ajustes">
            <TabAjustes />
          </TabsContent>
        )}
        <TabsContent value="movimientos">
          <PantallaMovimientos />
        </TabsContent>
      </Tabs>
    </div>
  )
}
