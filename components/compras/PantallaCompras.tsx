'use client'

import { useState } from 'react'
import {
  ClipboardList,
  FileText,
  Lightbulb,
  PackageCheck,
  ShoppingBag,
  TrendingUp,
} from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TabReposicion } from './TabReposicion'
import { TabMonitorCostos } from './TabMonitorCostos'
import { TabFacturas, BadgePendientesFactura } from './TabFacturas'
import { TabSugerencias, BadgeSugerenciasPendientes } from './TabSugerencias'
import { PantallaPedidos } from '@/components/pedidos/PantallaPedidos'
import { PantallaRecepcion } from '@/components/recepcion/PantallaRecepcion'
import { useUsuario } from '@/lib/hooks/useUsuario'

interface TabDef {
  value: string
  etiqueta: string
  icono: React.ElementType
  /** Permiso requerido para ver el tab. */
  permiso: string
}

const TABS: TabDef[] = [
  { value: 'reposicion', etiqueta: 'Reposición', icono: ShoppingBag, permiso: 'compras' },
  { value: 'ordenes', etiqueta: 'Órdenes', icono: ClipboardList, permiso: 'pedidos' },
  { value: 'recepcion', etiqueta: 'Recepción', icono: PackageCheck, permiso: 'recepcion' },
  { value: 'facturas', etiqueta: 'Facturas', icono: FileText, permiso: 'finanzas' },
  { value: 'costos', etiqueta: 'Costos', icono: TrendingUp, permiso: 'compras' },
  { value: 'sugerencias', etiqueta: 'Sugerencias', icono: Lightbulb, permiso: 'compras' },
]

interface Props {
  /** Tab inicial (viene de ?tab= en la URL, ej. desde "Ir a comprar"). */
  tabInicial?: string
}

export function PantallaCompras({ tabInicial }: Props) {
  const { data: usuario } = useUsuario()
  const permisos = usuario?.permisos ?? []

  // Tabs visibles según permisos. Si la tabla `roles` no respondió todavía,
  // mostramos todos para no dejar la pantalla vacía.
  const tabsVisibles =
    permisos.length === 0
      ? TABS
      : TABS.filter((t) => permisos.includes(t.permiso))

  const tabsAMostrar = tabsVisibles.length > 0 ? tabsVisibles : TABS
  const [tab, setTab] = useState(() =>
    tabInicial && TABS.some((t) => t.value === tabInicial)
      ? tabInicial
      : tabsAMostrar[0]?.value ?? 'recepcion'
  )

  // Si el tab activo dejó de estar disponible, saltar al primero visible.
  const tabActivo = tabsAMostrar.some((t) => t.value === tab)
    ? tab
    : tabsAMostrar[0]?.value

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <header>
        <h1 className="text-[#391511] text-2xl font-bold flex items-center gap-2">
          <ShoppingBag className="h-6 w-6 text-[#f9b44c]" />
          Compras
        </h1>
        <p className="text-[#6f3a2a] text-sm mt-1">
          Abastecimiento de la tienda: reposición, órdenes de compra, recepción
          de mercadería y control de costos.
        </p>
      </header>

      <Tabs value={tabActivo} onValueChange={setTab} className="space-y-5">
        <TabsList className="bg-white border border-[#e4c9b0]/60 p-1 h-auto flex-wrap">
          {tabsAMostrar.map(({ value, etiqueta, icono: Icono }) => (
            <TabsTrigger
              key={value}
              value={value}
              className="gap-1.5 data-active:bg-[#f9b44c]/20 data-active:text-[#391511] data-active:shadow-sm"
            >
              <Icono className="h-3.5 w-3.5" />
              {etiqueta}
              {value === 'facturas' && <BadgePendientesFactura />}
              {value === 'sugerencias' && <BadgeSugerenciasPendientes />}
            </TabsTrigger>
          ))}
        </TabsList>

        {tabsAMostrar.some((t) => t.value === 'reposicion') && (
          <TabsContent value="reposicion">
            <TabReposicion />
          </TabsContent>
        )}
        {tabsAMostrar.some((t) => t.value === 'ordenes') && (
          <TabsContent value="ordenes">
            <PantallaPedidos />
          </TabsContent>
        )}
        {tabsAMostrar.some((t) => t.value === 'recepcion') && (
          <TabsContent value="recepcion">
            <PantallaRecepcion />
          </TabsContent>
        )}
        {tabsAMostrar.some((t) => t.value === 'facturas') && (
          <TabsContent value="facturas">
            <TabFacturas />
          </TabsContent>
        )}
        {tabsAMostrar.some((t) => t.value === 'costos') && (
          <TabsContent value="costos">
            <TabMonitorCostos />
          </TabsContent>
        )}
        {tabsAMostrar.some((t) => t.value === 'sugerencias') && (
          <TabsContent value="sugerencias">
            <TabSugerencias />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
