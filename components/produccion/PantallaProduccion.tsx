'use client'

import { useState } from 'react'
import { BookOpen, ChefHat, ClipboardList, TrendingUp } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TabProducir } from './TabProducir'
import { TabRecetas } from './TabRecetas'
import { TabAnalisis } from './TabAnalisis'
import { useUsuario } from '@/lib/hooks/useUsuario'

interface TabDef {
  value: string
  etiqueta: string
  icono: React.ElementType
}

const TABS: TabDef[] = [
  { value: 'producir', etiqueta: 'Producir', icono: ClipboardList },
  { value: 'recetas', etiqueta: 'Recetas', icono: BookOpen },
  { value: 'analisis', etiqueta: 'Análisis', icono: TrendingUp },
]

interface Props {
  /** Tab inicial (viene de ?tab= en la URL). */
  tabInicial?: string
}

export function PantallaProduccion({ tabInicial }: Props) {
  // Todo el módulo está gateado por el permiso 'produccion' (middleware + RLS),
  // así que acá no filtramos tabs por permiso: los 3 se ven para quien entra.
  useUsuario()

  const [tab, setTab] = useState(() =>
    tabInicial && TABS.some((t) => t.value === tabInicial)
      ? tabInicial
      : 'producir'
  )

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <header>
        <h1 className="text-[#391511] text-2xl font-bold flex items-center gap-2">
          <ChefHat className="h-6 w-6 text-[#f9b44c]" />
          Producción
        </h1>
        <p className="text-[#6f3a2a] text-sm mt-1">
          Elaboración de comida: recetas, órdenes de producción con descuento de
          insumos y costeo automático.
        </p>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="space-y-5">
        <TabsList className="bg-white border border-[#e4c9b0]/60 p-1 h-auto flex-wrap">
          {TABS.map(({ value, etiqueta, icono: Icono }) => (
            <TabsTrigger
              key={value}
              value={value}
              className="gap-1.5 data-[state=active]:bg-[#f9b44c]/20 data-[state=active]:text-[#391511] data-[state=active]:shadow-sm"
            >
              <Icono className="h-3.5 w-3.5" />
              {etiqueta}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="producir">
          <TabProducir />
        </TabsContent>
        <TabsContent value="recetas">
          <TabRecetas />
        </TabsContent>
        <TabsContent value="analisis">
          <TabAnalisis />
        </TabsContent>
      </Tabs>
    </div>
  )
}
