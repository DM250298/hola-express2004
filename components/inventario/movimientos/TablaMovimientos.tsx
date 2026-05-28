'use client'

import { Badge } from '@/components/ui/badge'
import { formatearFechaHora } from '@/lib/utils/formato'
import { formatearNumero } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import type { TipoMovimiento } from '@/types/database'
import type { MovimientoCompleto, Turno } from '@/lib/queries/movimientosStock'

interface Props {
  movimientos: MovimientoCompleto[]
}

const BADGE_TIPO: Record<
  TipoMovimiento,
  { label: string; className: string }
> = {
  entrada: {
    label: 'Entrada',
    className: 'bg-[#2f8f4e]/15 text-[#2f8f4e] border-[#2f8f4e]/30',
  },
  salida: {
    label: 'Salida',
    className: 'bg-[#c43e2c]/10 text-[#c43e2c] border-[#c43e2c]/30',
  },
  venta: {
    label: 'Venta',
    className: 'bg-[#c43e2c]/10 text-[#c43e2c] border-[#c43e2c]/30',
  },
  ajuste: {
    label: 'Ajuste',
    className: 'bg-[#f9b44c]/15 text-[#b07d1e] border-[#f9b44c]/40',
  },
  merma: {
    label: 'Merma',
    className: 'bg-[#e97318]/15 text-[#c45e14] border-[#e97318]/30',
  },
}

const ETIQUETA_TURNO: Record<Turno, { label: string; icon: string }> = {
  mañana: { label: 'Mañana', icon: '🌅' },
  tarde: { label: 'Tarde', icon: '☀️' },
  noche: { label: 'Noche', icon: '🌙' },
}

/**
 * Devuelve la cantidad con signo según el tipo de movimiento.
 * Entradas suman, salidas/ventas/mermas restan.
 */
function cantidadConSigno(mov: MovimientoCompleto): {
  texto: string
  positivo: boolean
} {
  const esPositivo =
    mov.tipo === 'entrada' ||
    (mov.tipo === 'ajuste' && mov.stock_nuevo > mov.stock_anterior)

  const signo = esPositivo ? '+' : '−'
  return {
    texto: `${signo}${formatearNumero(mov.cantidad)}`,
    positivo: esPositivo,
  }
}

export function TablaMovimientos({ movimientos }: Props) {
  if (movimientos.length === 0) {
    return (
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-10 text-center">
        <p className="text-[#6f3a2a] font-medium">
          No se encontraron movimientos con esos filtros.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
              <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-[#6f3a2a]">
                Fecha / Hora
              </th>
              <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-[#6f3a2a]">
                Producto
              </th>
              <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-[#6f3a2a]">
                Tipo
              </th>
              <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-[#6f3a2a]">
                Cantidad
              </th>
              <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-[#6f3a2a]">
                Stock
              </th>
              <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-[#6f3a2a]">
                Origen
              </th>
              <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-[#6f3a2a]">
                Turno
              </th>
              <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-[#6f3a2a]">
                Usuario
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e4c9b0]/40">
            {movimientos.map((mov) => {
              const badge = BADGE_TIPO[mov.tipo] ?? BADGE_TIPO.ajuste
              const { texto: cantTexto, positivo } = cantidadConSigno(mov)
              const turno = ETIQUETA_TURNO[mov.turno]

              return (
                <tr
                  key={mov.id}
                  className="hover:bg-[#fdfaf6] transition-colors"
                >
                  <td className="px-4 py-2.5 text-[#391511] tabular-nums whitespace-nowrap text-xs">
                    {formatearFechaHora(mov.created_at)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-[#391511] leading-tight">
                      {mov.producto_nombre}
                    </div>
                    {mov.producto_codigo_barras && (
                      <div className="text-[10px] text-[#c8a58a] tabular-nums">
                        {mov.producto_codigo_barras}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-xs px-2 py-0.5 font-bold',
                        badge.className
                      )}
                    >
                      {badge.label}
                    </Badge>
                  </td>
                  <td
                    className={cn(
                      'px-4 py-2.5 text-right tabular-nums font-bold',
                      positivo ? 'text-[#2f8f4e]' : 'text-[#c43e2c]'
                    )}
                  >
                    {cantTexto}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[#6f3a2a] text-xs">
                    {formatearNumero(mov.stock_anterior)} →{' '}
                    <span className="font-bold text-[#391511]">
                      {formatearNumero(mov.stock_nuevo)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[#6f3a2a] text-xs max-w-[200px] truncate">
                    {mov.origen_label}
                  </td>
                  <td className="px-4 py-2.5 text-center whitespace-nowrap">
                    <span className="text-xs" title={turno.label}>
                      {turno.icon} {turno.label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[#391511] text-xs">
                    {mov.usuario_nombre ?? '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
