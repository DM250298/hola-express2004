'use client'

import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TabConteo } from './TabConteo'
import { TabAjustes } from './TabAjustes'
import { PantallaMovimientos } from './movimientos/PantallaMovimientos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { tienePermiso } from '@/lib/permisos'
import { MOSTRAR_CONTEOS_ASIGNADOS } from '@/lib/config/inventario'

export function PantallaControl() {
  const { data: usuario } = useUsuario()
  const puedeAjustar = tienePermiso(usuario?.permisos, 'inventario_ajustes')

  // La pestaña Conteo (conteos asignados, flujo viejo) está escondida por D7:
  // los conteos se hacen en Conteo físico por zonas.
  const tabInicial = MOSTRAR_CONTEOS_ASIGNADOS
    ? 'conteo'
    : puedeAjustar
      ? 'ajustes'
      : 'movimientos'

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <Link
          href="/inventario"
          className="inline-flex items-center gap-1 text-sm text-[#6f3a2a] hover:text-[#391511] transition-colors mb-2"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Stock
        </Link>
        <h1 className="text-[#391511] text-2xl font-bold">Control de stock</h1>
        <p className="text-[#6f3a2a] text-sm mt-1">
          {MOSTRAR_CONTEOS_ASIGNADOS ? (
            'Conteos físicos, ajustes con razón y movimientos auditables.'
          ) : (
            <>
              Ajustes con razón y movimientos auditables. Para contar el local
              usá{' '}
              <Link
                href="/inventario/conteo"
                className="font-medium text-[#391511] underline underline-offset-2"
              >
                Conteo físico
              </Link>
              .
            </>
          )}
        </p>
      </div>

      {/* key: los permisos llegan después del primer render; al cambiar la
          pestaña inicial (movimientos → ajustes) se vuelve a montar. */}
      <Tabs key={tabInicial} defaultValue={tabInicial} className="space-y-4">
        <TabsList className="bg-white border border-[#e4c9b0]/60 p-1 h-auto flex-wrap">
          {MOSTRAR_CONTEOS_ASIGNADOS && (
            <TabsTrigger
              value="conteo"
              className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511]"
            >
              Conteo
            </TabsTrigger>
          )}
          {puedeAjustar && (
            <TabsTrigger
              value="ajustes"
              className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511]"
            >
              Ajustes
            </TabsTrigger>
          )}
          <TabsTrigger
            value="movimientos"
            className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511]"
          >
            Movimientos
          </TabsTrigger>
        </TabsList>

        {MOSTRAR_CONTEOS_ASIGNADOS && (
          <TabsContent value="conteo">
            <TabConteo />
          </TabsContent>
        )}
        {puedeAjustar && (
          <TabsContent value="ajustes">
            <TabAjustes />
          </TabsContent>
        )}
        <TabsContent value="movimientos">
          <PantallaMovimientos />
        </TabsContent>
      </Tabs>
    </div>
  )
}
