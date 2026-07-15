'use client'

import Link from 'next/link'
import { ChevronLeft, ChevronRight, Truck } from 'lucide-react'
import { usePedidos } from '@/lib/hooks/usePedidos'
import { MontoARS } from '@/components/shared/MontoARS'
import { formatearFechaCorta } from '@/lib/utils/formato'

const ETIQUETA_ESTADO: Record<string, string> = {
  enviado: 'Enviado',
  recepcion_parcial: 'Recepción parcial',
}

export function RecepcionListaMovil() {
  const { data, isLoading } = usePedidos({
    estados: ['enviado', 'recepcion_parcial'],
  })
  const pendientes = data ?? []

  return (
    <div className="mx-auto max-w-md px-4 py-4 pb-24">
      <header className="mb-3">
        <Link
          href="/movil"
          className="flex items-center gap-1 text-sm font-medium text-[#6f3a2a]"
        >
          <ChevronLeft className="h-4 w-4" /> Volver
        </Link>
        <h1 className="mt-1 text-xl font-extrabold text-[#391511]">
          Recibir pedido
        </h1>
        <p className="text-sm text-[#6f3a2a]">
          Elegí el pedido que llegó para escanear la mercadería.
        </p>
      </header>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-2xl border border-[#e4c9b0]/50 bg-white/60"
            />
          ))}
        </div>
      ) : pendientes.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#e4c9b0] bg-white/60 p-6 text-center text-sm text-[#6f3a2a]">
          No hay pedidos esperando recepción. Cuando un pedido se marca como
          enviado, aparece acá.
        </p>
      ) : (
        <ul className="space-y-2">
          {pendientes.map((p) => (
            <li key={p.id}>
              <Link
                href={`/movil/recepcion/${p.id}`}
                className="flex items-center gap-3 rounded-2xl border border-[#e4c9b0]/70 bg-white p-4 shadow-sm transition active:scale-[0.99]"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#2f7d4f]/15 text-[#2f7d4f]">
                  <Truck className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-semibold text-[#391511]">
                      {p.proveedor?.nombre ?? 'Proveedor'}
                    </span>
                    {p.estado === 'recepcion_parcial' && (
                      <span className="shrink-0 rounded-full bg-[#9e6b15]/15 px-2 py-0.5 text-[10px] font-semibold text-[#9e6b15]">
                        Parcial
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-[#6f3a2a]">
                    Pedido #{p.id} · {ETIQUETA_ESTADO[p.estado] ?? p.estado}
                    {p.fecha_entrega_esperada
                      ? ` · llega ${formatearFechaCorta(p.fecha_entrega_esperada)}`
                      : ''}
                  </span>
                  <span className="mt-0.5 block text-sm font-bold text-[#391511]">
                    <MontoARS monto={p.total ?? 0} />
                  </span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-[#c8a58a]" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
