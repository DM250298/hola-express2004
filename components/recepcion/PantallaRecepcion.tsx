'use client'

import { useState } from 'react'
import {
  Calendar,
  CheckCircle2,
  History,
  Loader2,
  PackageCheck,
  Printer,
  Truck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MontoARS } from '@/components/shared/MontoARS'
import { ModalRecepcion } from '@/components/pedidos/ModalRecepcion'
import {
  ModalImprimirEtiquetas,
  type ItemParaEtiqueta,
} from './ModalImprimirEtiquetas'
import { usePedidos, usePedidoDetalle } from '@/lib/hooks/usePedidos'
import { getLotesPorPedido } from '@/lib/queries/pedidos'
import { formatearFechaCorta, formatearFechaHora } from '@/lib/utils/formato'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function PantallaRecepcion() {
  const {
    data: enviados,
    isLoading: cargandoEnviados,
    isError: errorEnviados,
  } = usePedidos({ estado: 'enviado' })
  const { data: recibidos, isLoading: cargandoRecibidos } = usePedidos({
    estado: 'recibido',
  })

  const [pedidoARecibirId, setPedidoARecibirId] = useState<number | null>(null)
  const { data: pedidoARecibir } = usePedidoDetalle(
    pedidoARecibirId ?? undefined
  )

  // Reimpresión: traer lotes del pedido recibido + abrir modal de etiquetas
  const [reimprimiendo, setReimprimiendo] = useState<number | null>(null)
  const [itemsReimprimir, setItemsReimprimir] = useState<ItemParaEtiqueta[]>([])
  const [modalReimprimirAbierto, setModalReimprimirAbierto] = useState(false)

  async function reimprimirEtiquetas(pedido_id: number) {
    setReimprimiendo(pedido_id)
    try {
      const lotes = await getLotesPorPedido(pedido_id)
      if (lotes.length === 0) {
        toast.info(
          'Este pedido no tiene lotes con fecha de vencimiento registrados.'
        )
        return
      }
      const items: ItemParaEtiqueta[] = lotes.map((l) => ({
        producto_id: l.producto_id,
        producto_nombre: l.producto_nombre,
        codigo_barras: l.codigo_barras,
        fecha_vencimiento: l.fecha_vencimiento,
        cantidad_recibida: l.cantidad_inicial,
        lote_id: l.id,
      }))
      setItemsReimprimir(items)
      setModalReimprimirAbierto(true)
    } catch (e) {
      toast.error(
        `No se pudieron cargar los lotes: ${
          e instanceof Error ? e.message : 'error'
        }`
      )
    } finally {
      setReimprimiendo(null)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <header>
        <h1 className="text-[#391511] text-2xl font-bold flex items-center gap-2">
          <Truck className="h-6 w-6 text-[#f9b44c]" />
          Recepción de mercadería
        </h1>
        <p className="text-[#6f3a2a] text-sm mt-1">
          Pedidos enviados que esperan recibirse, y los ya recibidos para
          reimprimir etiquetas si hace falta.
        </p>
      </header>

      <Tabs defaultValue="pendientes" className="space-y-4">
        <TabsList className="bg-white border border-[#e4c9b0]/60 p-1 h-auto">
          <TabsTrigger
            value="pendientes"
            className="gap-1.5 data-[state=active]:bg-[#f9b44c]/20 data-[state=active]:text-[#391511] data-[state=active]:shadow-sm"
          >
            <PackageCheck className="h-3.5 w-3.5" />
            Por recibir
            {enviados && enviados.length > 0 && (
              <span className="ml-1 text-[10px] font-bold bg-[#f9b44c]/30 text-[#391511] rounded-full px-1.5 py-0.5 tabular-nums">
                {enviados.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="recibidos"
            className="gap-1.5 data-[state=active]:bg-[#6f3a2a]/10 data-[state=active]:text-[#391511] data-[state=active]:shadow-sm"
          >
            <History className="h-3.5 w-3.5" />
            Recibidos
            {recibidos && recibidos.length > 0 && (
              <span className="ml-1 text-[10px] font-bold bg-[#c8a58a]/40 text-[#6f3a2a] rounded-full px-1.5 py-0.5 tabular-nums">
                {recibidos.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* PESTAÑA: pendientes */}
        <TabsContent value="pendientes" className="space-y-4">
          <div className="rounded-2xl bg-[#f9b44c]/10 border-2 border-[#f9b44c]/30 p-4">
            <div className="text-[#391511] font-semibold text-sm mb-1">
              ¿Cómo se usa?
            </div>
            <ol className="text-[#6f3a2a] text-xs space-y-0.5 list-decimal pl-5">
              <li>Cuando llega la mercadería, buscá su pedido acá.</li>
              <li>
                Tocá <span className="font-semibold">Recibir mercadería</span>.
              </li>
              <li>
                Ajustá la <em>cantidad recibida</em> si llegó distinto a lo
                pedido. Cargá fecha de vencimiento si corresponde.
              </li>
              <li>
                Confirmá. El stock se actualiza y se ofrece imprimir las
                etiquetas para depósito.
              </li>
            </ol>
          </div>

          {cargandoEnviados ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-44 rounded-2xl bg-[#f9d2a2]/30" />
              ))}
            </div>
          ) : errorEnviados ? (
            <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-10 text-center text-[#c43e2c] text-sm">
              No se pudieron cargar los pedidos.
            </div>
          ) : !enviados || enviados.length === 0 ? (
            <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-12 text-center">
              <div className="inline-flex p-3 rounded-full bg-[#f9b44c]/15 mb-3">
                <CheckCircle2 className="h-6 w-6 text-[#6f3a2a]" />
              </div>
              <p className="text-[#391511] font-semibold">
                Sin mercadería pendiente
              </p>
              <p className="text-[#6f3a2a] text-sm mt-1">
                Cuando el encargado envíe un pedido nuevo va a aparecer acá.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {enviados.map((p) => {
                const fechaEsperada = p.fecha_entrega_esperada
                  ? new Date(p.fecha_entrega_esperada)
                  : null
                const hoy = new Date()
                hoy.setHours(0, 0, 0, 0)
                const llegoElDia = fechaEsperada
                  ? fechaEsperada.getTime() <= hoy.getTime()
                  : false

                return (
                  <div
                    key={p.id}
                    className={cn(
                      'bg-white border-2 rounded-2xl p-5 shadow-sm transition-all',
                      llegoElDia ? 'border-[#f9b44c]/60' : 'border-[#e4c9b0]/60'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-xs text-[#c8a58a]">
                            Pedido #{p.id}
                          </span>
                          {llegoElDia && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-[#f9b44c]/20 text-[#6f3a2a] px-1.5 py-0.5 rounded-full">
                              <span className="h-1 w-1 rounded-full bg-[#f9b44c] animate-pulse" />
                              Para hoy
                            </span>
                          )}
                        </div>
                        <h3 className="font-bold text-[#391511] text-lg leading-tight">
                          {p.proveedor?.nombre ?? 'Proveedor eliminado'}
                        </h3>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs mb-4">
                      <div className="rounded-lg bg-[#fdfaf6] px-3 py-2 border border-[#e4c9b0]/40">
                        <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Entrega esperada
                        </div>
                        <div className="text-[#391511] font-semibold mt-0.5 tabular-nums">
                          {p.fecha_entrega_esperada
                            ? formatearFechaCorta(p.fecha_entrega_esperada)
                            : 'Sin definir'}
                        </div>
                      </div>
                      <div className="rounded-lg bg-[#fdfaf6] px-3 py-2 border border-[#e4c9b0]/40">
                        <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                          Total esperado
                        </div>
                        <div className="text-[#391511] font-bold tabular-nums mt-0.5">
                          <MontoARS monto={p.total} />
                        </div>
                      </div>
                    </div>

                    <Button
                      onClick={() => setPedidoARecibirId(p.id)}
                      className="w-full h-12 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-extrabold rounded-xl gap-2"
                    >
                      <PackageCheck className="h-5 w-5" />
                      Recibir mercadería
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </TabsContent>

        {/* PESTAÑA: recibidos */}
        <TabsContent value="recibidos" className="space-y-4">
          <p className="text-xs text-[#6f3a2a]">
            Pedidos ya ingresados. Tocá <span className="font-semibold">Reimprimir
            etiquetas</span> si necesitás volver a imprimirlas.
          </p>

          {cargandoRecibidos ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-20 rounded-xl bg-[#f9d2a2]/30" />
              ))}
            </div>
          ) : !recibidos || recibidos.length === 0 ? (
            <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-12 text-center">
              <History className="h-6 w-6 text-[#c8a58a] mx-auto mb-2" />
              <p className="text-[#391511] font-semibold">
                Todavía no hay pedidos recibidos
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {recibidos.map((p) => (
                <li
                  key={p.id}
                  className="bg-white border border-[#e4c9b0]/60 rounded-xl p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-mono text-xs text-[#c8a58a]">
                        #{p.id}
                      </span>
                      <span className="font-semibold text-[#391511] truncate">
                        {p.proveedor?.nombre ?? '—'}
                      </span>
                    </div>
                    <div className="text-xs text-[#6f3a2a] mt-0.5">
                      Recibido el{' '}
                      <span className="font-medium tabular-nums">
                        {formatearFechaHora(p.updated_at)}
                      </span>
                      {' · '}
                      <MontoARS monto={p.total} />
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => reimprimirEtiquetas(p.id)}
                    disabled={reimprimiendo === p.id}
                    className="border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#fdfaf6] gap-1.5 shrink-0"
                  >
                    {reimprimiendo === p.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Printer className="h-3.5 w-3.5" />
                    )}
                    Reimprimir etiquetas
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      {/* Modal de recepción */}
      {pedidoARecibir && (
        <ModalRecepcion
          abierto={pedidoARecibirId !== null}
          onCambioAbierto={(v) => {
            if (!v) setPedidoARecibirId(null)
          }}
          pedido={pedidoARecibir}
        />
      )}

      {/* Modal de reimpresión */}
      <ModalImprimirEtiquetas
        abierto={modalReimprimirAbierto}
        onCambioAbierto={setModalReimprimirAbierto}
        items={itemsReimprimir}
      />
    </div>
  )
}
