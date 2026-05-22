'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TabStockInventario } from './TabStockInventario'
import { TabAjustes } from './TabAjustes'
import { TabConteo } from './TabConteo'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { tienePermiso } from '@/lib/permisos'

export function PantallaInventario() {
  const { data: usuario } = useUsuario()
  const puedeAjustar = tienePermiso(usuario?.permisos, 'inventario_ajustes')

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <header>
        <h1 className="text-[#391511] text-2xl font-bold">Inventario</h1>
        <p className="text-[#6f3a2a] text-sm mt-1">
          Stock perpetuo, ajustes y conteos de mercadería.
        </p>
      </header>

      <Tabs defaultValue="stock" className="space-y-4">
        <TabsList className="bg-white border border-[#e4c9b0]/60 p-1 h-auto flex-wrap">
          <TabsTrigger
            value="stock"
            className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511]"
          >
            Stock
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
            value="conteo"
            className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511]"
          >
            Conteo
          </TabsTrigger>
        </TabsList>

        <TabsContent value="stock">
          <TabStockInventario />
        </TabsContent>
        {puedeAjustar && (
          <TabsContent value="ajustes">
            <TabAjustes />
          </TabsContent>
        )}
        <TabsContent value="conteo">
          <TabConteo />
        </TabsContent>
      </Tabs>
    </div>
  )
}
