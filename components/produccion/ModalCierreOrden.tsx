'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { InputNumero } from './InputNumero'
import { MontoARS } from '@/components/shared/MontoARS'
import { useCerrarOrden, useOrdenDetalle } from '@/lib/hooks/useProduccion'
import { useUsuario } from '@/lib/hooks/useUsuario'
import type { ConsumoReal, OrdenConProducto } from '@/lib/queries/produccion'

interface Props {
  orden: OrdenConProducto
  open: boolean
  onOpenChange: (v: boolean) => void
}

const MOTIVOS: { value: string; label: string }[] = [
  { value: 'desperdicio', label: 'Desperdicio' },
  { value: 'se_quemo', label: 'Se quemó' },
  { value: 'mal_porcionado', label: 'Mal porcionado' },
  { value: 'error_carga', label: 'Error de carga' },
  { value: 'otro', label: 'Otro' },
]

const EPS = 1e-9

export function ModalCierreOrden({ orden, open, onOpenChange }: Props) {
  const { data: usuario } = useUsuario()
  const { data: detalle, isLoading } = useOrdenDetalle(orden.id)
  const cerrar = useCerrarOrden()

  const items = detalle?.items ?? []
  const [producida, setProducida] = useState(orden.cantidad_planificada)
  const [consumos, setConsumos] = useState<
    Record<number, { real: number; motivo: string }>
  >({})
  const prefilled = useRef(false)

  // Pre-cargar el consumo real con el teórico (una vez que cargan los items).
  useEffect(() => {
    if (prefilled.current || items.length === 0) return
    prefilled.current = true
    const init: Record<number, { real: number; motivo: string }> = {}
    for (const it of items) init[it.id] = { real: it.cantidad_consumida, motivo: '' }
    setConsumos(init)
  }, [items])

  const unidad = orden.producto?.unidad ?? 'u'
  const merma = orden.cantidad_planificada - producida

  // Costo y desfasaje sobre el consumo REAL.
  let costoRealTotal = 0
  let desfasajeTotal = 0
  for (const it of items) {
    const c = consumos[it.id] ?? { real: it.cantidad_consumida, motivo: '' }
    costoRealTotal += c.real * it.costo_unitario
    desfasajeTotal += (c.real - it.cantidad_consumida) * it.costo_unitario
  }
  const costoUnit = producida > 0 ? costoRealTotal / producida : 0

  // Falta motivo en algún insumo que difiere.
  const faltaMotivo = items.some((it) => {
    const c = consumos[it.id]
    return c && Math.abs(c.real - it.cantidad_consumida) > EPS && !c.motivo
  })

  function setReal(itemId: number, real: number) {
    setConsumos((p) => ({ ...p, [itemId]: { ...p[itemId], real } }))
  }
  function setMotivo(itemId: number, motivo: string) {
    setConsumos((p) => ({ ...p, [itemId]: { ...p[itemId], motivo } }))
  }

  function handleCerrar() {
    if (!usuario || producida <= 0 || faltaMotivo) return
    const lista: ConsumoReal[] = items.map((it) => {
      const c = consumos[it.id] ?? { real: it.cantidad_consumida, motivo: '' }
      const difiere = Math.abs(c.real - it.cantidad_consumida) > EPS
      return {
        item_id: it.id,
        cantidad_real: c.real,
        motivo: difiere ? c.motivo || null : null,
      }
    })
    cerrar.mutate(
      {
        orden_id: orden.id,
        cantidad_producida: producida,
        usuario_id: usuario.id,
        consumos: lista,
      },
      { onSuccess: () => onOpenChange(false) }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[#391511]">
            Cerrar producción · {orden.producto?.nombre ?? 'Producto'}
          </DialogTitle>
          <DialogDescription>
            Confirmá lo producido y el consumo real de cada insumo. Las
            diferencias con la receta ajustan el stock y quedan registradas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Producido real */}
          <div className="space-y-1.5">
            <Label className="text-[#6f3a2a]">
              Producido real ({unidad}) · planificado{' '}
              {orden.cantidad_planificada}
            </Label>
            <InputNumero
              min={0}
              step="0.001"
              value={producida}
              onChange={setProducida}
              autoFocus
            />
          </div>

          {/* Consumo real de insumos */}
          <div className="space-y-2">
            <Label className="text-[#6f3a2a]">Consumo real de insumos</Label>
            {isLoading ? (
              <p className="text-sm text-[#c8a58a]">Cargando insumos…</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-[#c8a58a]">La orden no tiene insumos.</p>
            ) : (
              <div className="space-y-2">
                {items.map((it) => {
                  const c = consumos[it.id] ?? {
                    real: it.cantidad_consumida,
                    motivo: '',
                  }
                  const dif = c.real - it.cantidad_consumida
                  const difiere = Math.abs(dif) > EPS
                  return (
                    <div
                      key={it.id}
                      className="rounded-lg border border-[#e4c9b0]/60 bg-white p-2 space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-[#391511] truncate">
                            {it.insumo?.nombre ?? 'Insumo'}
                          </div>
                          <div className="text-[10px] text-[#c8a58a]">
                            receta: {it.cantidad_consumida} {it.insumo?.unidad}
                          </div>
                        </div>
                        <InputNumero
                          min={0}
                          step="0.0001"
                          value={c.real}
                          onChange={(n) => setReal(it.id, n)}
                          className="w-28"
                        />
                        <span className="text-xs text-[#6f3a2a] w-6">
                          {it.insumo?.unidad}
                        </span>
                      </div>
                      {difiere && (
                        <div className="flex items-center gap-2 pl-1">
                          <select
                            value={c.motivo}
                            onChange={(e) => setMotivo(it.id, e.target.value)}
                            className="flex-1 h-8 rounded-lg border border-[#e4c9b0] bg-white px-2 text-xs text-[#391511] focus:outline-none focus:ring-2 focus:ring-[#f9b44c]"
                          >
                            <option value="">Elegí el motivo…</option>
                            {MOTIVOS.map((m) => (
                              <option key={m.value} value={m.value}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                          <span
                            className={`text-xs font-semibold tabular-nums ${
                              dif > 0 ? 'text-[#c45e14]' : 'text-[#2f8f4e]'
                            }`}
                          >
                            {dif > 0 ? '+' : ''}
                            <MontoARS monto={dif * it.costo_unitario} />
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Resumen */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-[#e4c9b0]/60 bg-[#fdfaf6] p-2.5">
              <div className="text-[10px] uppercase tracking-wide text-[#6f3a2a]">
                Merma rinde
              </div>
              <div className={merma > 0 ? 'text-[#c45e14] font-bold' : 'text-[#2f8f4e] font-bold'}>
                {merma > 0 ? `${merma} ${unidad}` : 'Sin merma'}
              </div>
            </div>
            <div className="rounded-lg border border-[#e4c9b0]/60 bg-[#fdfaf6] p-2.5">
              <div className="text-[10px] uppercase tracking-wide text-[#6f3a2a]">
                Desfasaje $
              </div>
              <div
                className={
                  Math.abs(desfasajeTotal) > EPS
                    ? 'text-[#c45e14] font-bold'
                    : 'text-[#2f8f4e] font-bold'
                }
              >
                <MontoARS monto={desfasajeTotal} />
              </div>
            </div>
            <div className="rounded-lg border border-[#e4c9b0]/60 bg-[#fdfaf6] p-2.5">
              <div className="text-[10px] uppercase tracking-wide text-[#6f3a2a]">
                Costo unit.
              </div>
              <div className="font-bold text-[#391511]">
                <MontoARS monto={costoUnit} />
              </div>
            </div>
          </div>
        </div>

        {faltaMotivo && (
          <p className="text-xs text-[#c45e14] text-right">
            Elegí el motivo en los insumos que difieren de la receta.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-[#e4c9b0]/40">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleCerrar}
            disabled={producida <= 0 || faltaMotivo || cerrar.isPending}
            className="bg-[#2f8f4e] hover:bg-[#267a42] text-white"
          >
            {cerrar.isPending ? 'Cerrando…' : 'Finalizar producción'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
