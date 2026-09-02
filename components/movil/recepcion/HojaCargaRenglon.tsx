'use client'

import { AlertTriangle, Barcode, Check, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { CampoFechaVencimiento } from '@/components/shared/CampoFechaVencimiento'
import { esCodigoAutogenerado } from '@/lib/utils/codigoBarras'
import {
  formatearCantidad,
  formatearNumero,
  pareceGramosEnKg,
} from '@/lib/utils/formato'
import type { CargaRenglon } from '@/lib/recepcion/borrador'
import type { ItemEstado } from './tipos'
import { cn } from '@/lib/utils'

interface Props {
  item: ItemEstado | null
  carga: CargaRenglon
  /** N° de renglón en el papel. */
  renglon: number
  /** Lo ya recibido: base + las otras facturas de esta entrega. */
  yaTotal: number
  /** Fecha del renglón anterior de esta factura, para "Igual que el anterior". */
  fechaAnterior: string | null
  puedeEditarCodigo: boolean
  onCambio: (carga: CargaRenglon) => void
  onCerrar: () => void
  onQuitar: () => void
  onEditarCodigo: () => void
}

/**
 * Carga de UN renglón: cuántas llegaron y cuándo vencen.
 *
 * Es una hoja modal y no dos inputs en la lista, por tres razones:
 *
 * 1. El teclado. Antes la lista se reordenaba sola al escanear y mover en el
 *    DOM un input con foco se lo cierra al usuario, así que había que elegir
 *    entre ordenar bien o poder tipear. En un modal la lista no se mueve abajo
 *    del dedo y el `autoFocus` sobre un popup recién montado abre el teclado.
 * 2. Un producto por vez es mucho más simple de entender que 40 tarjetas con 80
 *    campos, que es lo que a los empleados les costaba.
 * 3. Deja lugar para los atajos de fecha sin apretar el layout.
 *
 * No agrega pasos: escanear ya abre esta hoja sola.
 *
 * Todo lo que se toca se escribe en el acto en la factura (no hay "guardar"),
 * así que cerrarla nunca pierde nada y el autoguardado ve cada cambio.
 */
export function HojaCargaRenglon({
  item,
  carga,
  renglon,
  yaTotal,
  fechaAnterior,
  puedeEditarCodigo,
  onCambio,
  onCerrar,
  onQuitar,
  onEditarCodigo,
}: Props) {
  if (!item) return null

  const cantNum = Number(carga.cantidad) || 0
  const diferencia = yaTotal + cantNum - item.cantidad_pedida
  const esGramos = item.venta_por_peso && cantNum > 0 && pareceGramosEnKg(carga.cantidad)

  function set(cambios: Partial<CargaRenglon>) {
    onCambio({ ...carga, ...cambios })
  }

  return (
    <Sheet
      open={item != null}
      onOpenChange={(v, detalles) => {
        // El click afuera no cierra: en un teléfono el dedo pega donde no
        // quiere y esto se usa con una caja en la otra mano. Se cierra con
        // Listo o con la X.
        if (!v && detalles.reason === 'outside-press') {
          detalles.cancel()
          return
        }
        if (!v) onCerrar()
      }}
    >
      <SheetContent
        side="bottom"
        className="max-h-[92vh] gap-0 overflow-y-auto rounded-t-2xl border-[#e4c9b0] bg-[#fdfaf6] pb-4"
      >
        <SheetHeader className="pb-2">
          <SheetTitle className="flex items-start gap-2 pr-8 text-left text-[#391511]">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#f9b44c] text-xs font-bold tabular-nums text-[#391511]">
              {renglon}
            </span>
            <span className="min-w-0 flex-1 text-base leading-tight">
              {item.nombre}
            </span>
          </SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-x-2 text-xs text-[#6f3a2a]">
            <span className="tabular-nums">
              Pedido {formatearCantidad(item.cantidad_pedida, item.venta_por_peso)}
            </span>
            {yaTotal > 0 && (
              <span className="tabular-nums text-[#2f7d4f]">
                · ya recibido {formatearCantidad(yaTotal, item.venta_por_peso)}
              </span>
            )}
            {puedeEditarCodigo && (
              <button
                type="button"
                onClick={onEditarCodigo}
                className="flex items-center gap-1 rounded border border-[#e4c9b0] px-1.5 py-0.5 text-[10px] font-semibold text-[#9e6b15]"
              >
                <Barcode className="h-3 w-3" />
                {esCodigoAutogenerado(item.codigo_barras)
                  ? 'Sin código'
                  : item.codigo_barras}
              </button>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4">
          <div>
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-[#6f3a2a]">
              ¿Cuántas llegaron?{' '}
              {item.venta_por_peso && <span className="text-[#9e6b15]">(kg)</span>}
            </Label>
            <div className="mt-1 flex items-center gap-2">
              <Input
                autoFocus
                type="number"
                min="0"
                step={item.venta_por_peso ? '0.001' : '1'}
                inputMode={item.venta_por_peso ? 'decimal' : 'numeric'}
                value={carga.cantidad}
                onChange={(e) => set({ cantidad: e.target.value })}
                placeholder={item.venta_por_peso ? '0,000' : '0'}
                className="h-14 flex-1 border-[#e4c9b0] text-2xl font-semibold tabular-nums focus-visible:ring-[#f9b44c]"
              />
              {item.venta_por_peso ? (
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-[#e4c9b0] bg-white text-base font-bold text-[#9e6b15]">
                  kg
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => set({ cantidad: String(cantNum + 1) })}
                  aria-label="Sumar 1"
                  className="h-14 w-14 shrink-0 rounded-md border border-[#e4c9b0] bg-white text-base font-bold text-[#9e6b15] active:scale-95"
                >
                  +1
                </button>
              )}
            </div>

            {esGramos ? (
              <div className="mt-2 space-y-1.5 rounded-lg border-2 border-[#c43e2c]/60 bg-[#c43e2c]/10 p-2">
                <p className="flex items-start gap-1 text-[11px] font-bold text-[#c43e2c]">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />¿
                  {formatearNumero(cantNum)} KILOS? Parece un peso en gramos de la
                  balanza.
                </p>
                <button
                  type="button"
                  onClick={() => set({ cantidad: String(cantNum / 1000) })}
                  className="w-full rounded-md border border-[#c43e2c]/50 bg-white px-2 py-1.5 text-xs font-bold text-[#c43e2c] active:bg-[#c43e2c]/10"
                >
                  Eran gramos → usar {formatearCantidad(cantNum / 1000, true)}
                </button>
              </div>
            ) : (
              item.venta_por_peso &&
              cantNum > 0 && (
                <p className="mt-1 text-[10px] text-[#6f3a2a]">
                  = {formatearNumero(Math.round(cantNum * 1000))} g
                </p>
              )
            )}

            {diferencia !== 0 && !Number.isNaN(diferencia) && cantNum > 0 && (
              <p
                className={cn(
                  'mt-1 text-xs font-medium tabular-nums',
                  diferencia > 0 ? 'text-[#9e6b15]' : 'text-[#c43e2c]'
                )}
              >
                {diferencia > 0 ? 'Llegaron ' : 'Faltan '}
                {formatearCantidad(Math.abs(diferencia), item.venta_por_peso)}
                {diferencia > 0 ? ' de más' : ' para completar el pedido'}
              </p>
            )}
          </div>

          <div>
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-[#6f3a2a]">
              ¿Cuándo vence?
            </Label>
            <div className="mt-1">
              {carga.sin_vencimiento ? (
                <button
                  type="button"
                  onClick={() => set({ sin_vencimiento: false })}
                  className="flex h-12 w-full items-center justify-between rounded-md border border-[#e4c9b0] bg-white px-3 text-sm text-[#6f3a2a] active:scale-[0.99]"
                >
                  <span className="flex items-center gap-2 font-medium text-[#391511]">
                    <Check className="h-4 w-4 text-[#2f7d4f]" />
                    Este producto no vence
                  </span>
                  <span className="text-xs font-semibold text-[#9e6b15]">
                    Cambiar
                  </span>
                </button>
              ) : (
                <>
                  <CampoFechaVencimiento
                    value={carga.fecha_vencimiento}
                    onChange={(iso) => set({ fecha_vencimiento: iso })}
                    fechaAnterior={fechaAnterior}
                    diasMinimo={item.dias_vencimiento_minimo}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      set({ sin_vencimiento: true, fecha_vencimiento: '' })
                    }
                    className="mt-1.5 text-xs font-semibold text-[#9e6b15] underline underline-offset-2"
                  >
                    Este producto no vence
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onQuitar}
              aria-label="Sacar de la factura"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-[#e4c9b0] bg-white text-[#c43e2c] active:scale-95"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <Button
              type="button"
              onClick={onCerrar}
              className="h-12 flex-1 bg-[#f9b44c] text-base font-semibold text-[#391511] hover:bg-[#e4a42a]"
            >
              Listo
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
