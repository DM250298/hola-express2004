'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TabPlanCuentas } from './TabPlanCuentas'
import { TabLibroDiario } from './TabLibroDiario'
import { TabConciliacion } from './TabConciliacion'
import { TabConciliacionMP } from './TabConciliacionMP'
import { TabActivos } from './TabActivos'
import { TabCierreAuditoria } from './TabCierreAuditoria'
import { usePestanaUrl } from '@/lib/hooks/usePestanaUrl'

const TABS = ['plan', 'diario', 'conciliacion_mp', 'conciliacion', 'activos', 'cierre']

interface Props {
  /** Pestaña inicial (viene de ?tab= en la URL). */
  tabInicial?: string
}

export function PantallaContabilidad({ tabInicial }: Props) {
  const [tab, setTab] = usePestanaUrl(TABS, 'plan', tabInicial)

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <header>
        <h1 className="text-[#391511] text-2xl font-bold">Contabilidad</h1>
        <p className="text-[#6f3a2a] text-sm mt-1">
          Plan de cuentas, asientos, conciliación, activos fijos y cierre.
          Los impuestos (IVA / IIBB) se gestionan en Finanzas.
        </p>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
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
            value="conciliacion_mp"
            className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511]"
          >
            Conciliar Mercado Pago
          </TabsTrigger>
          <TabsTrigger
            value="conciliacion"
            className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511]"
          >
            Conciliar banco
          </TabsTrigger>
          <TabsTrigger
            value="activos"
            className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511]"
          >
            Activos fijos
          </TabsTrigger>
          <TabsTrigger
            value="cierre"
            className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511]"
          >
            Cierre y auditoría
          </TabsTrigger>
        </TabsList>

        <TabsContent value="plan">
          <TabPlanCuentas />
        </TabsContent>
        <TabsContent value="diario">
          <TabLibroDiario />
        </TabsContent>
        <TabsContent value="conciliacion_mp">
          <TabConciliacionMP />
        </TabsContent>
        <TabsContent value="conciliacion">
          <TabConciliacion />
        </TabsContent>
        <TabsContent value="activos">
          <TabActivos />
        </TabsContent>
        <TabsContent value="cierre">
          <TabCierreAuditoria />
        </TabsContent>
      </Tabs>
    </div>
  )
}
