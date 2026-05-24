'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TabEmpleados } from './TabEmpleados'
import { TabNovedades } from './TabNovedades'
import { TabLiquidaciones } from './TabLiquidaciones'
import { TabCtaCteEmpleados } from './TabCtaCteEmpleados'

export function PantallaRrhh() {
  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <header>
        <h1 className="text-[#391511] text-2xl font-bold">
          Recursos Humanos
        </h1>
        <p className="text-[#6f3a2a] text-sm mt-1">
          Legajo del personal, novedades del mes y liquidación de sueldos.
        </p>
      </header>

      <Tabs defaultValue="empleados" className="space-y-4">
        <TabsList className="bg-white border border-[#e4c9b0]/60 p-1 h-auto flex-wrap">
          <TabsTrigger
            value="empleados"
            className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511]"
          >
            Empleados
          </TabsTrigger>
          <TabsTrigger
            value="novedades"
            className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511]"
          >
            Novedades
          </TabsTrigger>
          <TabsTrigger
            value="cta_cte"
            className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511]"
          >
            Cta. corriente
          </TabsTrigger>
          <TabsTrigger
            value="liquidaciones"
            className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511]"
          >
            Liquidaciones
          </TabsTrigger>
        </TabsList>

        <TabsContent value="empleados">
          <TabEmpleados />
        </TabsContent>
        <TabsContent value="novedades">
          <TabNovedades />
        </TabsContent>
        <TabsContent value="cta_cte">
          <TabCtaCteEmpleados />
        </TabsContent>
        <TabsContent value="liquidaciones">
          <TabLiquidaciones />
        </TabsContent>
      </Tabs>
    </div>
  )
}
