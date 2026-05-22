'use client'

import { useState } from 'react'
import { ArrowRight, Check, Loader2, Printer, Tag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import { ModalImprimirEtiquetaPrecio } from '@/components/inventario/ModalImprimirEtiquetaPrecio'
import {
  useEtiquetasPendientes,
  useQuitarEtiqueta,
} from '@/lib/hooks/useEtiquetas'
import { formatearFechaHora } from '@/lib/utils/formato'
import type { DatosEtiquetaPrecio } from '@/components/inventario/EtiquetaPrecio'

export function PantallaEtiquetas() {
  const { data: etiquetas, isLoading, isError } = useEtiquetasPendientes()
  const quitar = useQuitarEtiqueta()
  const [productoImprimir, setProductoImprimir] =
    useState<DatosEtiquetaPrecio | null>(null)

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <header>
        <h1 className="text-[#391511] text-2xl font-bold">
          Etiquetas de precio
        </h1>
        <p className="text-[#6f3a2a] text-sm mt-1">
          Productos que cambiaron de precio y necesitan etiqueta nueva en
          góndola. Imprimila, colocala y marcala como colocada.
        </p>
      </header>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 rounded-2xl bg-[#f9d2a2]/30" />
          ))}
        </div>
      ) : isError ? (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-10 text-center text-[#c43e2c] text-sm">
          No se pudieron cargar las etiquetas pendientes.
        </div>
      ) : !etiquetas || etiquetas.length === 0 ? (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-12 text-center">
          <Tag className="h-6 w-6 text-[#c8a58a] mx-auto mb-2" />
          <p className="text-[#391511] font-semibold">
            No hay etiquetas pendientes
          </p>
          <p className="text-[#6f3a2a] text-sm mt-1">
            Cuando cambie el precio de un producto, va a aparecer acá para
            reimprimir la etiqueta.
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-[#6f3a2a]">
            <span className="font-bold text-[#391511]">
              {etiquetas.length}
            </span>{' '}
            etiqueta(s) pendiente(s) de colocar
          </p>
          <ul className="space-y-2">
            {etiquetas.map((e) => (
              <li
                key={e.id}
                className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-4 flex items-center gap-3 flex-wrap"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-[#391511]">
                    {e.producto_nombre}
                  </div>
                  <div className="text-xs text-[#6f3a2a] flex items-center gap-2 flex-wrap mt-0.5">
                    {e.codigo_barras && (
                      <span className="font-mono text-[#c8a58a]">
                        {e.codigo_barras}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      {e.precio_anterior != null && (
                        <>
                          <span className="line-through text-[#c8a58a]">
                            <MontoARS monto={e.precio_anterior} />
                          </span>
                          <ArrowRight className="h-3 w-3 text-[#c8a58a]" />
                        </>
                      )}
                      <span className="font-bold text-[#391511]">
                        <MontoARS monto={e.precio} />
                      </span>
                    </span>
                    <span className="text-[#c8a58a]">
                      · {formatearFechaHora(e.fecha)}
                    </span>
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setProductoImprimir({
                      nombre: e.producto_nombre,
                      codigo_barras: e.codigo_barras,
                      precio_venta: e.precio,
                    })
                  }
                  className="border-[#e4c9b0] text-[#6f3a2a] gap-1.5"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Imprimir
                </Button>
                <Button
                  size="sm"
                  onClick={() => quitar.mutate(e.id)}
                  disabled={quitar.isPending}
                  className="bg-[#2f8f4e] hover:bg-[#267a42] text-white font-semibold gap-1.5"
                >
                  {quitar.isPending && quitar.variables === e.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Ya colocada
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}

      <ModalImprimirEtiquetaPrecio
        abierto={productoImprimir !== null}
        onCambioAbierto={(v) => !v && setProductoImprimir(null)}
        producto={productoImprimir}
      />
    </div>
  )
}
