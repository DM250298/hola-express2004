'use client'

import { Loader2, PackageX, AlertTriangle } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import {
  useConfigVentas,
  useActualizarConfigVentas,
} from '@/lib/hooks/useConfigVentas'

export function PantallaVentas() {
  const { data: config, isLoading } = useConfigVentas()
  const actualizar = useActualizarConfigVentas()
  const permitir = config?.permitir_venta_sin_stock ?? false

  return (
    <div className="space-y-4">
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="shrink-0 p-2.5 rounded-xl bg-[#b5701f]/12">
              <PackageX className="h-5 w-5 text-[#b5701f]" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[#391511] font-semibold">
                Permitir vender sin stock
              </h3>
              <p className="text-[#6f3a2a] text-sm mt-1 max-w-xl">
                Cuando está activo, el POS deja agregar y cobrar productos aunque
                el stock sea 0 o quede en negativo. El stock del producto puede
                bajar de cero y se corrige después con un ajuste o un conteo
                físico. Con la opción desactivada (por defecto), el POS bloquea
                la venta de productos sin stock.
              </p>
            </div>
          </div>
          <div className="shrink-0 pt-1">
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-[#c8a58a]" />
            ) : (
              <Switch
                checked={permitir}
                disabled={actualizar.isPending}
                onCheckedChange={(v) =>
                  actualizar.mutate({ permitir_venta_sin_stock: v })
                }
                aria-label="Permitir vender sin stock"
              />
            )}
          </div>
        </div>

        {permitir && (
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-[#b5701f]/10 border border-[#b5701f]/20 px-3 py-2.5">
            <AlertTriangle className="h-4 w-4 text-[#b5701f] shrink-0 mt-0.5" />
            <p className="text-[#6f3a2a] text-xs">
              La venta en negativo está <strong>activada</strong>. El stock de
              inventario puede quedar por debajo de cero — recordá regularizarlo
              con un ajuste o conteo para que los reportes cierren bien.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
