'use client'

import { Calendar, Package, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Semaforo } from '@/components/shared/Semaforo'
import { formatearFechaCorta } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import type { LoteConProducto } from '@/lib/queries/vencimientos'

interface Props {
  lote: LoteConProducto
  onDarDeBaja: (lote: LoteConProducto) => void
}

export function CardLote({ lote, onDarDeBaja }: Props) {
  const dias = lote.dias_restantes
  const vencido = lote.clase === 'vencido'
  const necesitaAccion = lote.clase !== 'verde'

  const textoDias =
    vencido
      ? `Venció hace ${Math.abs(dias)} ${Math.abs(dias) === 1 ? 'día' : 'días'}`
      : dias === 0
      ? 'Vence hoy'
      : `${dias} ${dias === 1 ? 'día' : 'días'} restantes`

  return (
    <div
      className={cn(
        'bg-white border rounded-2xl p-4 shadow-sm transition-all hover:shadow-md',
        vencido
          ? 'border-[#c43e2c]/30 bg-[#c43e2c]/[0.03]'
          : 'border-[#e4c9b0]/60'
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-[#391511] leading-tight truncate">
            {lote.producto.nombre}
          </h3>
          {lote.producto.codigo_barras && (
            <p className="text-[10px] text-[#c8a58a] font-mono mt-0.5">
              {lote.producto.codigo_barras}
            </p>
          )}
        </div>
        <Semaforo clase={lote.clase} />
      </div>

      <div className="space-y-1.5 mb-3 text-sm">
        <div className="flex items-center gap-1.5 text-[#6f3a2a]">
          <Calendar className="h-3.5 w-3.5 text-[#c8a58a]" />
          <span>Vence el </span>
          <span className="font-semibold text-[#391511] tabular-nums">
            {formatearFechaCorta(lote.fecha_vencimiento)}
          </span>
        </div>
        <div
          className={cn(
            'text-xs font-medium',
            vencido
              ? 'text-[#c43e2c]'
              : lote.clase === 'rojo'
              ? 'text-[#c43e2c]'
              : lote.clase === 'amarillo'
              ? 'text-[#6f3a2a]'
              : 'text-[#6f3a2a]'
          )}
        >
          {textoDias}
        </div>
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-[#e4c9b0]/40">
        <div className="flex items-center gap-1.5 text-[#391511]">
          <Package className="h-3.5 w-3.5 text-[#c8a58a]" />
          <span className="text-2xl font-extrabold tabular-nums leading-none">
            {lote.cantidad_actual}
          </span>
          <span className="text-xs text-[#6f3a2a]">/ {lote.cantidad_inicial}</span>
        </div>

        {necesitaAccion && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDarDeBaja(lote)}
            className="border-[#c43e2c]/30 text-[#c43e2c] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c] gap-1.5"
          >
            <Trash2 className="h-3 w-3" />
            Dar de baja
          </Button>
        )}
      </div>
    </div>
  )
}
