'use client'

import { useMemo, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SelectorPeriodo } from './SelectorPeriodo'
import { ReporteVentas } from './ReporteVentas'
import { ReporteTopProductos } from './ReporteTopProductos'
import { ReporteRotacion } from './ReporteRotacion'
import { ReporteMermas } from './ReporteMermas'
import {
  rangoDesdeFechas,
  rangoPredefinido,
  type ClavePeriodo,
} from '@/lib/utils/periodos'

function isoHoy(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function inicioMes(): string {
  const d = new Date()
  d.setDate(1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export function PantallaReportes() {
  const [periodo, setPeriodo] = useState<ClavePeriodo>('mes_actual')
  const [desdePersonalizado, setDesdePersonalizado] = useState(inicioMes())
  const [hastaPersonalizado, setHastaPersonalizado] = useState(isoHoy())

  const rango = useMemo(() => {
    if (periodo === 'personalizado') {
      return rangoDesdeFechas(desdePersonalizado, hastaPersonalizado)
    }
    return rangoPredefinido(periodo)
  }, [periodo, desdePersonalizado, hastaPersonalizado])

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[#391511] text-2xl font-bold">Reportes</h1>
          <p className="text-[#6f3a2a] text-sm mt-1">
            Análisis del negocio y exportación a PDF.
          </p>
        </div>

        <SelectorPeriodo
          periodo={periodo}
          onCambioPeriodo={setPeriodo}
          desdePersonalizado={desdePersonalizado}
          hastaPersonalizado={hastaPersonalizado}
          onCambioDesde={setDesdePersonalizado}
          onCambioHasta={setHastaPersonalizado}
        />
      </header>

      <Tabs defaultValue="ventas" className="space-y-4">
        <TabsList className="bg-white border border-[#e4c9b0]/60 p-1 h-auto flex-wrap">
          <TabsTrigger
            value="ventas"
            className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511] data-active:shadow-sm"
          >
            Ventas
          </TabsTrigger>
          <TabsTrigger
            value="top"
            className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511] data-active:shadow-sm"
          >
            Top 20
          </TabsTrigger>
          <TabsTrigger
            value="rotacion"
            className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511] data-active:shadow-sm"
          >
            Rotación
          </TabsTrigger>
          <TabsTrigger
            value="mermas"
            className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511] data-active:shadow-sm"
          >
            Mermas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ventas">
          <ReporteVentas desde={rango.desde} hasta={rango.hasta} />
        </TabsContent>
        <TabsContent value="top">
          <ReporteTopProductos desde={rango.desde} hasta={rango.hasta} />
        </TabsContent>
        <TabsContent value="rotacion">
          <ReporteRotacion desde={rango.desde} hasta={rango.hasta} />
        </TabsContent>
        <TabsContent value="mermas">
          <ReporteMermas desde={rango.desde} hasta={rango.hasta} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
