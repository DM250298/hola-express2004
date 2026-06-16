'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Database, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { formatearNumero } from '@/lib/utils/formato'
import {
  usePlanSincronizacionStock,
  useSincronizarStockConLotes,
} from '@/lib/hooks/useVencimientos'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
}

function fechaUnAnoAdelante(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function ModalSincronizarStock({ abierto, onCambioAbierto }: Props) {
  const [fechaVenc, setFechaVenc] = useState(fechaUnAnoAdelante())
  const { data: plan, isLoading: cargandoPlan } =
    usePlanSincronizacionStock(abierto)
  const sincronizar = useSincronizarStockConLotes()

  useEffect(() => {
    if (abierto) setFechaVenc(fechaUnAnoAdelante())
  }, [abierto])

  const fechaValida = !!fechaVenc && fechaVenc >= hoyIso()
  const hayQueSincronizar = (plan?.total_productos ?? 0) > 0

  function confirmar() {
    if (!fechaValida || !hayQueSincronizar) return
    sincronizar.mutate(fechaVenc, {
      onSuccess: () => onCambioAbierto(false),
    })
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !sincronizar.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <Database className="h-5 w-5 text-[#f9b44c]" />
            Sincronizar stock inicial
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Crea un lote por cada producto con stock que no tenga lote
            asociado. Permite que el FIFO funcione para los productos que
            cargaste antes de empezar a controlar vencimientos.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Selector de fecha */}
          <div className="space-y-1.5">
            <Label
              htmlFor="fecha-sinc"
              className="text-[#391511] font-medium text-sm"
            >
              Fecha de vencimiento a aplicar
            </Label>
            <Input
              id="fecha-sinc"
              type="date"
              min={hoyIso()}
              value={fechaVenc}
              onChange={(e) => setFechaVenc(e.target.value)}
              disabled={sincronizar.isPending}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
            />
            <p className="text-[10px] text-[#6f3a2a]">
              Usá una fecha lejana (default: 1 año desde hoy) para que el
              stock viejo se descuente <em>después</em> que la mercadería
              nueva en el FIFO. Cuando ingrese mercadería real con
              vencimientos más cercanos, se va a vender primero.
            </p>
          </div>

          {/* Preview del plan */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold mb-2">
              Diagnóstico
            </div>

            {cargandoPlan ? (
              <Skeleton className="h-24 rounded-xl bg-[#f9d2a2]/30" />
            ) : !plan || plan.total_productos === 0 ? (
              <div className="rounded-xl bg-[#f9b44c]/10 border-2 border-[#f9b44c]/30 p-4 text-center">
                <CheckCircle2 className="h-6 w-6 text-[#6f3a2a] mx-auto mb-1" />
                <p className="text-[#391511] font-semibold text-sm">
                  Stock ya sincronizado
                </p>
                <p className="text-[#6f3a2a] text-xs mt-0.5">
                  Todo el stock de productos activos ya está cubierto por
                  lotes. No hay nada que crear.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="rounded-xl bg-[#f9b44c]/10 border border-[#f9b44c]/40 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                      Lotes a crear
                    </div>
                    <div className="text-2xl font-extrabold text-[#391511] tabular-nums">
                      {plan.total_productos}
                    </div>
                  </div>
                  <div className="rounded-xl bg-[#fdfaf6] border border-[#e4c9b0]/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                      Unidades cubiertas
                    </div>
                    <div className="text-2xl font-extrabold text-[#391511] tabular-nums">
                      {formatearNumero(plan.total_unidades)}
                    </div>
                  </div>
                </div>

                {/* Lista preview */}
                <div className="rounded-xl border border-[#e4c9b0]/60 bg-white max-h-48 overflow-y-auto">
                  <ul className="divide-y divide-[#e4c9b0]/40">
                    {plan.productos.slice(0, 30).map((p) => (
                      <li
                        key={p.producto_id}
                        className="px-3 py-2 flex items-center justify-between text-xs"
                      >
                        <span className="text-[#391511] truncate">
                          {p.nombre}
                        </span>
                        <span className="text-[#6f3a2a] tabular-nums shrink-0">
                          {p.cubierto_por_lotes > 0 && (
                            <span className="text-[#c8a58a] mr-1">
                              {formatearNumero(p.cubierto_por_lotes)} ya en lotes,
                            </span>
                          )}
                          <span className="font-bold text-[#391511]">
                            +{formatearNumero(p.faltante)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {plan.productos.length > 30 && (
                    <div className="px-3 py-2 text-[10px] text-center text-[#6f3a2a] bg-[#fdfaf6]">
                      + {plan.productos.length - 30} productos más
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="rounded-xl bg-[#fdfaf6] border border-[#e4c9b0]/60 p-3 text-xs text-[#6f3a2a]">
            <Sparkles className="h-3.5 w-3.5 text-[#f9b44c] inline mr-1" />
            Esta acción <strong>NO modifica</strong> el stock actual de tus
            productos. Solo crea registros en la tabla de lotes para que
            cuando se venda, el sistema sepa de qué lote descontar (FIFO).
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-[#e4c9b0]/60 bg-[#fdfaf6] flex-row gap-2 sm:gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={sincronizar.isPending}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={confirmar}
            disabled={
              sincronizar.isPending || !fechaValida || !hayQueSincronizar
            }
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
          >
            {sincronizar.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creando lotes…
              </>
            ) : hayQueSincronizar ? (
              `Crear ${plan?.total_productos ?? 0} lotes`
            ) : (
              'Nada para sincronizar'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
