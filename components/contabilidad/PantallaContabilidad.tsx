'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TabPlanCuentas } from './TabPlanCuentas'
import { TabLibroDiario } from './TabLibroDiario'
import { TabConciliacion } from './TabConciliacion'
import { TabActivos } from './TabActivos'
import { TabImpuestos } from './TabImpuestos'

export function PantallaContabilidad() {
  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <header>
        <h1 className="text-[#391511] text-2xl font-bold">Contabilidad</h1>
        <p className="text-[#6f3a2a] text-sm mt-1">
          Plan de cuentas, asientos, conciliación, activos fijos e impuestos.
        </p>
      </header>

      <Tabs defaultValue="plan" className="space-y-4">
        <TabsList className="bg-white border border-[#e4c9b0]/60 p-1 h-auto flex-wrap">
          <TabsTrigger
            value="plan"
            className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511]"
          >
            Plan de cuentas
          </TabsTrigger>
          <TabsTrigger
            value="diario"
            className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511]"
          >
            Libro diario
          </TabsTrigger>
          <TabsTrigger
            value="conciliacion"
            className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511]"
          >
            Conciliación
          </TabsTrigger>
          <TabsTrigger
            value="activos"
            className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511]"
          >
            Activos fijos
          </TabsTrigger>
          <TabsTrigger
            value="impuestos"
            className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511]"
          >
            Impuestos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="plan">
          <TabPlanCuentas />
        </TabsContent>
        <TabsContent value="diario">
          <TabLibroDiario />
        </TabsContent>
        <TabsContent value="conciliacion">
          <TabConciliacion />
        </TabsContent>
        <TabsContent value="activos">
          <TabActivos />
        </TabsContent>
        <TabsContent value="impuestos">
          <TabImpuestos />
        </TabsContent>
      </Tabs>
    </div>
  )
}
