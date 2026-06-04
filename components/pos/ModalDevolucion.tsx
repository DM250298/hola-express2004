'use client'

import { useMemo, useState } from 'react'
import {
  CheckCircle2,
  Loader2,
  RotateCcw,
  Search,
  Ticket,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MontoARS } from '@/components/shared/MontoARS'
import {
  useVentaParaDevolucion,
  useCrearDevolucion,
} from '@/lib/hooks/useDevoluciones'
import { formatearFechaHora } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import type { DestinoItemDevolucion, TipoReembolso } from '@/types/database'
import type { ResultadoDevolucion } from '@/lib/queries/devoluciones'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  turnoId: number
  usuarioId: string
}

const REEMBOLSOS: { valor: TipoReembolso; etiqueta: string }[] = [
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'nota_credito', etiqueta: 'Nota de crédito' },
  { valor: 'tarjeta', etiqueta: 'Reverso a tarjeta' },
]

export function ModalDevolucion({
  abierto,
  onCambioAbierto,
  turnoId,
  usuarioId,
}: Props) {
  const [ventaIdInput, setVentaIdInput] = useState('')
  const [ventaId, setVentaId] = useState<number | undefined>(undefined)
  const { data: venta, isLoading, isError } = useVentaParaDevolucion(ventaId)
  const crear = useCrearDevolucion()

  const [cantidades, setCantidades] = useState<Record<number, number>>({})
  const [destinos, setDestinos] = useState<Record<number, DestinoItemDevolucion>>(
    {}
  )
  const [reembolso, setReembolso] = useState<TipoReembolso>('efectivo')
  const [motivo, setMotivo] = useState('')
  const [resultado, setResultado] = useState<ResultadoDevolucion | null>(null)

  function reset() {
    setVentaIdInput('')
    setVentaId(undefined)
    setCantidades({})
    setDestinos({})
    setReembolso('efectivo')
    setMotivo('')
    setResultado(null)
  }

  function cerrar(v: boolean) {
    if (crear.isPending) return
    if (!v) reset()
    onCambioAbierto(v)
  }

  function buscar() {
    const n = Number(ventaIdInput)
    if (Number.isFinite(n) && n > 0) {
      setVentaId(n)
      setCantidades({})
      setDestinos({})
    }
  }

  const total = useMemo(() => {
    if (!venta) return 0
    return venta.items.reduce((acc, it) => {
      const c = cantidades[it.item_venta_id] ?? 0
      return acc + c * it.precio_unitario
    }, 0)
  }, [venta, cantidades])

  const hayItems = total > 0

  function confirmar() {
    if (!venta || !hayItems) return
    const items = venta.items
      .filter((it) => (cantidades[it.item_venta_id] ?? 0) > 0)
      .map((it) => ({
        item_venta_id: it.item_venta_id,
        producto_id: it.producto_id,
        cantidad: cantidades[it.item_venta_id],
        precio_unitario: it.precio_unitario,
        destino: destinos[it.item_venta_id] ?? 'stock',
      }))
    crear.mutate(
      {
        venta_id: venta.venta_id,
        usuario_id: usuarioId,
        turno_id: turnoId,
        motivo: motivo.trim() || null,
        tipo_reembolso: reembolso,
        cliente_id: venta.cliente_id,
        items,
      },
      {
        onSuccess: (res) => setResultado(res),
      }
    )
  }

  return (
    <Dialog open={abierto} onOpenChange={cerrar}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="px-6 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-[#f9b44c]" />
            Devolución
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Buscá la venta, elegí qué devolver y cómo reembolsar.
          </DialogDescription>
        </DialogHeader>

        {/* Resultado OK */}
        {resultado ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center gap-3">
            <div className="inline-flex p-3 rounded-full bg-[#2f7d4f]/15">
              <CheckCircle2 className="h-8 w-8 text-[#2f7d4f]" />
            </div>
            <p className="text-[#391511] font-bold text-lg">
              Devolución registrada
            </p>
            <p className="text-[#6f3a2a]">
              Total devuelto: <MontoARS monto={resultado.total_devuelto} />
            </p>
            {resultado.codigo_nc && (
              <div className="rounded-xl border-2 border-[#f9b44c]/50 bg-[#f9b44c]/10 px-6 py-3">
                <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  Nota de crédito — entregá este código al cliente
                </div>
                <div className="text-2xl font-extrabold text-[#391511] font-mono tracking-wider">
                  {resultado.codigo_nc}
                </div>
              </div>
            )}
            <Button
              onClick={() => cerrar(false)}
              className="mt-2 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
            >
              Listo
            </Button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Buscar venta */}
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label className="text-[#391511] font-medium text-sm">
                    N.º de venta
                  </Label>
                  <Input
                    type="number"
                    value={ventaIdInput}
                    onChange={(e) => setVentaIdInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && buscar()}
                    placeholder="Ej: 1234"
                    className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
                  />
                </div>
                <Button
                  onClick={buscar}
                  className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
                >
                  <Search className="h-4 w-4" />
                  Buscar
                </Button>
              </div>

              {isLoading && (
                <div className="flex items-center justify-center py-8 text-[#6f3a2a]">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              )}

              {ventaId != null && !isLoading && (isError || !venta) && (
                <div className="text-center py-8 text-[#c43e2c] text-sm">
                  No se encontró la venta #{ventaId}.
                </div>
              )}

              {venta && venta.estado !== 'completada' && (
                <div className="text-center py-8 text-[#c43e2c] text-sm">
                  Esta venta está {venta.estado}; no admite devoluciones.
                </div>
              )}

              {venta && venta.estado === 'completada' && (
                <>
                  <div className="rounded-xl bg-[#fdfaf6] border border-[#e4c9b0]/60 px-3 py-2 text-xs text-[#6f3a2a] flex items-center gap-2">
                    <Ticket className="h-3.5 w-3.5 text-[#f9b44c]" />
                    Venta #{venta.venta_id} ·{' '}
                    {formatearFechaHora(venta.fecha)} ·{' '}
                    {venta.medio_pago} · <MontoARS monto={venta.total} />
                  </div>

                  {/* Items */}
                  <ul className="space-y-2">
                    {venta.items.map((it) => {
                      const max =
                        it.cantidad_vendida - it.cantidad_ya_devuelta
                      const cant = cantidades[it.item_venta_id] ?? 0
                      const dest = destinos[it.item_venta_id] ?? 'stock'
                      return (
                        <li
                          key={it.item_venta_id}
                          className={cn(
                            'bg-white border rounded-xl p-3',
                            max <= 0
                              ? 'border-[#e4c9b0]/40 opacity-50'
                              : 'border-[#e4c9b0]/60'
                          )}
                        >
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="min-w-0 flex-1">
                              <div className="font-medium text-[#391511] text-sm">
                                {it.nombre}
                              </div>
                              <div className="text-xs text-[#6f3a2a]">
                                Vendido: {it.cantidad_vendida}
                                {it.cantidad_ya_devuelta > 0 &&
                                  ` · ya devuelto: ${it.cantidad_ya_devuelta}`}
                                {' · '}
                                <MontoARS monto={it.precio_unitario} /> c/u
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                min={0}
                                max={max}
                                value={cant || ''}
                                disabled={max <= 0}
                                onChange={(e) => {
                                  const v = Math.max(
                                    0,
                                    Math.min(max, Number(e.target.value) || 0)
                                  )
                                  setCantidades((p) => ({
                                    ...p,
                                    [it.item_venta_id]: v,
                                  }))
                                }}
                                placeholder="0"
                                className="h-9 w-20 text-center tabular-nums border-[#e4c9b0]"
                              />
                              {cant > 0 && (
                                <div className="flex rounded-lg overflow-hidden border border-[#e4c9b0]">
                                  {(['stock', 'merma'] as const).map((d) => (
                                    <button
                                      key={d}
                                      type="button"
                                      onClick={() =>
                                        setDestinos((p) => ({
                                          ...p,
                                          [it.item_venta_id]: d,
                                        }))
                                      }
                                      className={cn(
                                        'px-2.5 py-1.5 text-xs font-semibold',
                                        dest === d
                                          ? d === 'stock'
                                            ? 'bg-[#2f7d4f]/15 text-[#2f7d4f]'
                                            : 'bg-[#c43e2c]/15 text-[#c43e2c]'
                                          : 'bg-white text-[#6f3a2a]'
                                      )}
                                    >
                                      {d === 'stock' ? 'A stock' : 'Merma'}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>

                  {/* Reembolso + motivo */}
                  <div className="space-y-3 pt-2">
                    <div className="space-y-1.5">
                      <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                        Reembolso
                      </Label>
                      <div className="flex gap-2 flex-wrap">
                        {REEMBOLSOS.map((r) => (
                          <button
                            key={r.valor}
                            type="button"
                            onClick={() => setReembolso(r.valor)}
                            className={cn(
                              'px-3 py-2 rounded-xl border-2 text-sm font-semibold',
                              reembolso === r.valor
                                ? 'border-[#f9b44c] bg-[#f9b44c]/15 text-[#391511]'
                                : 'border-[#e4c9b0] bg-white text-[#6f3a2a]'
                            )}
                          >
                            {r.etiqueta}
                          </button>
                        ))}
                      </div>
                    </div>
                    <Input
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      placeholder="Motivo (opcional): fallado, no le gustó…"
                      maxLength={200}
                      className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                    />
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-3 flex items-center justify-between shrink-0">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  Total a devolver
                </div>
                <div className="text-2xl font-extrabold text-[#391511] tabular-nums">
                  <MontoARS monto={total} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => cerrar(false)}
                  disabled={crear.isPending}
                  className="border-[#e4c9b0] text-[#6f3a2a]"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={confirmar}
                  disabled={!hayItems || crear.isPending}
                  className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold disabled:opacity-40"
                >
                  {crear.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Procesando…
                    </>
                  ) : (
                    'Confirmar devolución'
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
