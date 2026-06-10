'use client'

import { useState } from 'react'
import { ClipboardList, Play, Plus, X } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { MontoARS } from '@/components/shared/MontoARS'
import { BadgeEstadoOrden } from './BadgeEstadoOrden'
import { AsistenteNuevaOrden } from './AsistenteNuevaOrden'
import { ModalCierreOrden } from './ModalCierreOrden'
import {
  useCancelarOrden,
  useIniciarOrden,
  useOrdenes,
} from '@/lib/hooks/useProduccion'
import { useUsuario } from '@/lib/hooks/useUsuario'
import type { OrdenConProducto } from '@/lib/queries/produccion'

export function TabProducir() {
  const { data: usuario } = useUsuario()
  const { data: ordenes, isLoading } = useOrdenes()
  const iniciar = useIniciarOrden()
  const cancelar = useCancelarOrden()

  const [asistente, setAsistente] = useState(false)
  const [cierre, setCierre] = useState<OrdenConProducto | null>(null)

  function handleIniciar(orden: OrdenConProducto) {
    if (!usuario) return
    iniciar.mutate({ orden_id: orden.id, usuario_id: usuario.id })
  }

  function handleCancelar(orden: OrdenConProducto) {
    if (!usuario) return
    if (
      !confirm(
        `¿Cancelar la orden de ${orden.producto?.nombre ?? 'producto'}? ` +
          (orden.estado === 'iniciada'
            ? 'Se repondrán los insumos consumidos.'
            : '')
      )
    )
      return
    cancelar.mutate({ orden_id: orden.id, usuario_id: usuario.id })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#6f3a2a]">
          Órdenes de producción. Iniciar descuenta insumos; cerrar ingresa lo
          producido.
        </p>
        <Button
          onClick={() => setAsistente(true)}
          className="bg-[#391511] hover:bg-[#4a1d16] text-white gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Nueva orden
        </Button>
      </div>

      <div className="rounded-xl border border-[#e4c9b0]/60 bg-white overflow-hidden">
        {isLoading ? (
          <div className="p-4">
            <SkeletonTabla filas={5} columnas={5} />
          </div>
        ) : !ordenes || ordenes.length === 0 ? (
          <div className="p-10 text-center text-[#6f3a2a]">
            <ClipboardList className="h-7 w-7 mx-auto mb-2 text-[#c8a58a]" />
            No hay órdenes de producción. Creá la primera con “Nueva orden”.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-[#e4c9b0]/40">
                <TableHead className="text-[#6f3a2a]">Producto</TableHead>
                <TableHead className="text-[#6f3a2a] text-right">Plan.</TableHead>
                <TableHead className="text-[#6f3a2a] text-right">Prod.</TableHead>
                <TableHead className="text-[#6f3a2a]">Estado</TableHead>
                <TableHead className="text-[#6f3a2a] text-right">Costo</TableHead>
                <TableHead className="text-right text-[#6f3a2a]">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordenes.map((o) => (
                <TableRow key={o.id} className="border-[#e4c9b0]/30">
                  <TableCell className="font-medium text-[#391511]">
                    {o.producto?.nombre ?? '—'}
                  </TableCell>
                  <TableCell className="text-right text-[#6f3a2a] tabular-nums">
                    {o.cantidad_planificada} {o.producto?.unidad ?? ''}
                  </TableCell>
                  <TableCell className="text-right text-[#6f3a2a] tabular-nums">
                    {o.cantidad_producida ?? '—'}
                  </TableCell>
                  <TableCell>
                    <BadgeEstadoOrden estado={o.estado} />
                  </TableCell>
                  <TableCell className="text-right">
                    <MontoARS monto={o.costo_total} className="text-[#391511]" />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {o.estado === 'borrador' && (
                        <Button
                          size="sm"
                          onClick={() => handleIniciar(o)}
                          disabled={iniciar.isPending}
                          className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] gap-1 h-8"
                        >
                          <Play className="h-3.5 w-3.5" />
                          Iniciar
                        </Button>
                      )}
                      {o.estado === 'iniciada' && (
                        <Button
                          size="sm"
                          onClick={() => setCierre(o)}
                          className="bg-[#2f8f4e] hover:bg-[#267a42] text-white h-8"
                        >
                          Cerrar
                        </Button>
                      )}
                      {(o.estado === 'borrador' || o.estado === 'iniciada') && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleCancelar(o)}
                          disabled={cancelar.isPending}
                          className="text-[#c43e2c] hover:bg-[#c43e2c]/10 h-8 w-8"
                          aria-label="Cancelar orden"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <AsistenteNuevaOrden open={asistente} onOpenChange={setAsistente} />
      {cierre && (
        <ModalCierreOrden
          orden={cierre}
          open={!!cierre}
          onOpenChange={(v) => !v && setCierre(null)}
        />
      )}
    </div>
  )
}
