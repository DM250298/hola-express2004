'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TabNovedades } from './TabNovedades'
import { TabLiquidaciones } from './TabLiquidaciones'
import { TabCtaCteEmpleados } from './TabCtaCteEmpleados'

const claseTab = 'data-active:bg-[#f9b44c]/20 data-active:text-[#391511]'

/**
 * Pestaña "Sueldos" del hub Personal. Solo la ve quien tiene `rrhh_sueldos`
 * (el encargado con `rrhh` operativo no la ve ni acá ni por API: RLS).
 */
export function TabSueldos() {
  return (
    <Tabs defaultValue="novedades" className="space-y-4">
      <TabsList className="bg-white border border-[#e4c9b0]/60 p-1 h-auto flex-wrap">
        <TabsTrigger value="novedades" className={claseTab}>
          Novedades
        </TabsTrigger>
        <TabsTrigger value="liquidaciones" className={claseTab}>
          Liquidaciones
        </TabsTrigger>
        <TabsTrigger value="cta_cte" className={claseTab}>
          Cta. corriente
        </TabsTrigger>
      </TabsList>

      <TabsContent value="novedades">
        <TabNovedades />
      </TabsContent>
      <TabsContent value="liquidaciones">
        <TabLiquidaciones />
      </TabsContent>
      <TabsContent value="cta_cte">
        <TabCtaCteEmpleados />
      </TabsContent>
    </Tabs>
  )
}
