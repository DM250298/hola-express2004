'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TabEmpleados } from './TabEmpleados'
import { TabNovedades } from './TabNovedades'
import { TabLiquidaciones } from './TabLiquidaciones'
import { TabCtaCteEmpleados } from './TabCtaCteEmpleados'
import { TabDesempeno } from './TabDesempeno'

interface Props {
  permisos: string[]
}

export function PantallaRrhh({ permisos }: Props) {
  // Los montos salariales (novedades y liquidaciones) sólo para 'rrhh_sueldos'.
  // El encargado tiene 'rrhh' (operativo) pero NO ve sueldos — ni acá ni por API.
  const puedeVerSueldos = permisos.includes('rrhh_sueldos')

  const claseTab =
    'data-active:bg-[#f9b44c]/20 data-active:text-[#391511]'

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <header>
        <h1 className="text-[#391511] text-2xl font-bold">Recursos Humanos</h1>
        <p className="text-[#6f3a2a] text-sm mt-1">
          Legajo del personal, documentación, desempeño, novedades y liquidación
          de sueldos.
        </p>
      </header>

      <Tabs defaultValue="empleados" className="space-y-4">
        <TabsList className="bg-white border border-[#e4c9b0]/60 p-1 h-auto flex-wrap">
          <TabsTrigger value="empleados" className={claseTab}>
            Empleados
          </TabsTrigger>
          <TabsTrigger value="cta_cte" className={claseTab}>
            Cta. corriente
          </TabsTrigger>
          <TabsTrigger value="desempeno" className={claseTab}>
            Desempeño
          </TabsTrigger>
          {puedeVerSueldos && (
            <>
              <TabsTrigger value="novedades" className={claseTab}>
                Novedades
              </TabsTrigger>
              <TabsTrigger value="liquidaciones" className={claseTab}>
                Liquidaciones
              </TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="empleados">
          <TabEmpleados puedeVerSueldos={puedeVerSueldos} />
        </TabsContent>
        <TabsContent value="cta_cte">
          <TabCtaCteEmpleados />
        </TabsContent>
        <TabsContent value="desempeno">
          <TabDesempeno />
        </TabsContent>
        {puedeVerSueldos && (
          <>
            <TabsContent value="novedades">
              <TabNovedades />
            </TabsContent>
            <TabsContent value="liquidaciones">
              <TabLiquidaciones />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  )
}
