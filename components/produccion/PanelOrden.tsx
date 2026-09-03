'use client'

import { ClipboardList, Play, Printer, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MontoARS } from '@/components/shared/MontoARS'
import { BadgeEstadoOrden } from './BadgeEstadoOrden'
import { TablaDisponibilidad } from './TablaDisponibilidad'
import {
  useDatosEtiquetaElaboracion,
  useOrdenDetalle,
} from '@/lib/hooks/useProduccion'
import {
  cantidadesIguales,
  formatearFechaCortaISO,
  formatearFechaHora,
  formatearNumero,
} from '@/lib/utils/formato'
import { textoLote } from '@/lib/utils/lote'
import type { OrdenConProducto } from '@/lib/queries/produccion'

interface Props {
  orden: OrdenConProducto | null
  onIniciar: (orden: OrdenConProducto) => void
  onCerrar: (orden: OrdenConProducto) => void
  onCancelar: (orden: OrdenConProducto) => void
  onImprimirEtiquetas: (ordenId: number) => void
  procesando?: boolean
}

/** Fila etiqueta-valor del resumen. */
function Dato({
  etiqueta,
  children,
}: {
  etiqueta: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-[#6f3a2a]">{etiqueta}</span>
      <span className="font-semibold text-[#391511] tabular-nums text-right">
        {children}
      </span>
    </div>
  )
}

/**
 * Detalle de la orden seleccionada en el tablero: insumos, costos y las
 * acciones que corresponden a su estado. Reemplaza los botones apretados que
 * antes vivían en cada fila de la tabla.
 */
export function PanelOrden({
  orden,
  onIniciar,
  onCerrar,
  onCancelar,
  onImprimirEtiquetas,
  procesando,
}: Props) {
  const { data: detalle } = useOrdenDetalle(orden?.id)
  const { data: etiqueta } = useDatosEtiquetaElaboracion(
    orden?.estado === 'cerrada' ? orden.id : undefined
  )

  if (!orden) {
    return (
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm p-10 text-center">
        <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
          <ClipboardList className="h-6 w-6 text-[#6f3a2a]" />
        </div>
        <p className="text-[#391511] font-semibold">Elegí una tanda</p>
        <p className="text-[#6f3a2a] text-sm mt-1">
          Tocá una tarjeta del tablero para ver sus insumos, su costo y qué
          podés hacer con ella.
        </p>
      </div>
    )
  }

  const unidad = orden.producto?.unidad ?? ''
  const items = detalle?.items ?? []
  const costoUnit =
    orden.cantidad_producida && orden.cantidad_producida > 0
      ? orden.costo_total / orden.cantidad_producida
      : 0
  const merma =
    orden.cantidad_producida != null
      ? orden.cantidad_planificada - orden.cantidad_producida
      : 0

  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-[#e4c9b0]/40 bg-[#fdfaf6]">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-bold text-[#391511] leading-snug">
            {orden.producto?.nombre ?? 'Producto'}
          </h3>
          <BadgeEstadoOrden estado={orden.estado} />
        </div>
        <p className="text-[11px] text-[#c8a58a] mt-0.5">
          Orden #{orden.id}
          {orden.fecha_cierre
            ? ` · cerrada ${formatearFechaHora(orden.fecha_cierre)}`
            : orden.fecha_inicio
              ? ` · iniciada ${formatearFechaHora(orden.fecha_inicio)}`
              : ''}
        </p>
      </div>

      <div className="p-4 space-y-4 max-h-[calc(100vh-16rem)] overflow-y-auto">
        <div className="space-y-1.5">
          <Dato etiqueta="Planificado">
            {formatearNumero(orden.cantidad_planificada)} {unidad}
          </Dato>
          {orden.cantidad_producida != null && (
            <Dato etiqueta="Producido">
              {formatearNumero(orden.cantidad_producida)} {unidad}
            </Dato>
          )}
          {orden.estado === 'cerrada' && (
            <>
              <Dato etiqueta="Merma de rinde">
                {merma > 0 ? (
                  <span className="text-[#c45e14]">
                    {formatearNumero(merma)} {unidad}
                  </span>
                ) : (
                  <span className="text-[#2f8f4e]">Sin merma</span>
                )}
              </Dato>
              <Dato etiqueta="Costo unitario">
                <MontoARS monto={costoUnit} />
              </Dato>
            </>
          )}
          <Dato etiqueta="Costo total">
            <MontoARS monto={orden.costo_total} />
          </Dato>
        </div>

        {orden.estado === 'cerrada' && etiqueta && (
          <div className="rounded-xl border border-[#e4c9b0]/60 bg-[#fdfaf6] p-3 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Lote elaborado
            </div>
            <Dato etiqueta="Identificación">
              {textoLote(
                etiqueta.lote_id,
                etiqueta.orden_id,
                etiqueta.elaborado_en
              )}
            </Dato>
            <Dato etiqueta="Vence">
              {etiqueta.vence_el ? (
                formatearFechaCortaISO(etiqueta.vence_el)
              ) : (
                <span className="text-[#c45e14]">sin fecha</span>
              )}
            </Dato>
            {etiqueta.elaborado_por && (
              <Dato etiqueta="Elaboró">{etiqueta.elaborado_por}</Dato>
            )}
          </div>
        )}

        {orden.estado === 'borrador' && (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Insumos necesarios
            </div>
            <TablaDisponibilidad
              recetaId={orden.receta_id ?? undefined}
              cantidad={orden.cantidad_planificada}
            />
          </div>
        )}

        {orden.estado !== 'borrador' && items.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Insumos consumidos
            </div>
            <div className="rounded-lg border border-[#e4c9b0]/60 overflow-hidden">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-[#e4c9b0]/30">
                  {items.map((it) => {
                    const real = it.cantidad_real ?? it.cantidad_consumida
                    // Nunca comparar cantidades con !==: hay decimales de kg.
                    const difiere = !cantidadesIguales(real, it.cantidad_consumida)
                    return (
                      <tr key={it.id}>
                        <td className="px-3 py-1.5 text-[#391511]">
                          {it.insumo?.nombre ?? 'Insumo'}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[#6f3a2a]">
                          <span className={difiere ? 'text-[#c45e14]' : ''}>
                            {formatearNumero(real)} {it.insumo?.unidad}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t border-[#e4c9b0]/40 bg-[#fdfaf6] flex flex-wrap gap-2">
        {orden.estado === 'borrador' && (
          <Button
            onClick={() => onIniciar(orden)}
            disabled={procesando}
            className="flex-1 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
          >
            <Play className="h-4 w-4" />
            Iniciar
          </Button>
        )}
        {orden.estado === 'iniciada' && (
          <Button
            onClick={() => onCerrar(orden)}
            className="flex-1 bg-[#2f8f4e] hover:bg-[#267a42] text-white font-semibold"
          >
            Cerrar producción
          </Button>
        )}
        {orden.estado === 'cerrada' && (
          <Button
            onClick={() => onImprimirEtiquetas(orden.id)}
            className="flex-1 bg-[#391511] hover:bg-[#4a1d16] text-white gap-1.5"
          >
            <Printer className="h-4 w-4" />
            Imprimir etiquetas
          </Button>
        )}
        {(orden.estado === 'borrador' || orden.estado === 'iniciada') && (
          <Button
            variant="outline"
            onClick={() => onCancelar(orden)}
            disabled={procesando}
            className="border-[#c43e2c]/40 text-[#c43e2c] hover:bg-[#c43e2c]/10 gap-1.5"
          >
            <X className="h-4 w-4" />
            Cancelar
          </Button>
        )}
      </div>
    </div>
  )
}
