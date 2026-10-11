'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TabEmpleados } from './TabEmpleados'
import { TabDesempeno } from './TabDesempeno'
import { Organigrama } from './Organigrama'

interface Props {
  puedeVerSueldos: boolean
}

const claseTab = 'data-active:bg-[#f9b44c]/20 data-active:text-[#391511]'

/** Pestaña "Equipo" del hub Personal: legajos, organigrama y desempeño. */
export function TabEquipo({ puedeVerSueldos }: Props) {
  return (
    <Tabs defaultValue="empleados" className="space-y-4">
      <TabsList className="bg-white border border-[#e4c9b0]/60 p-1 h-auto flex-wrap">
        <TabsTrigger value="empleados" className={claseTab}>
          Empleados
        </TabsTrigger>
        <TabsTrigger value="organigrama" className={claseTab}>
          Organigrama
        </TabsTrigger>
        <TabsTrigger value="desempeno" className={claseTab}>
          Desempeño
        </TabsTrigger>
      </TabsList>

      <TabsContent value="empleados">
        <TabEmpleados puedeVerSueldos={puedeVerSueldos} />
      </TabsContent>
      <TabsContent value="organigrama">
        <Organigrama />
      </TabsContent>
      <TabsContent value="desempeno">
        <TabDesempeno />
      </TabsContent>
    </Tabs>
  )
}
