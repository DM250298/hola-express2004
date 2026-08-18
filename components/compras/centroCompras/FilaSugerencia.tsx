'use client'

// Fila memoizada del Centro de Compras: al tocar un checkbox o tipear una
// cantidad solo se re-renderiza la fila afectada (patrón TabReposicion — con
// miles de filas sin memo el navegador se congela).

import { memo } from 'react'
import { Truck } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { TableCell, TableRow } from '@/components/ui/table'
import { esAjusteFuerte } from '@/lib/compras/cobertura'
import type { EstadoCobertura } from '@/lib/compras/tiposCobertura'
import { formatearCantidad, formatearNumero } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import type { SugerenciaFila } from './CentroCompras'

const COLOR_ESTADO: Record<EstadoCobertura, string> = {
  rojo: 'bg-[#c43e2c]',
  naranja: 'bg-[#e4a42a]',
  verde: 'bg-[#2f6f4f]',
  gris: 'bg-[#c8a58a]',
}

const TITULO_ESTADO: Record<EstadoCobertura, string> = {
  rojo: 'Necesita compra / riesgo de quiebre',
  naranja: 'Cerca del punto de reposición',
  verde: 'Stock suficiente',
  gris: 'Sin ventas recientes',
}

interface Props {
  fila: SugerenciaFila
  marcado: boolean
  cantidad: string
  /** Motivo del ajuste (mig 152); el input aparece solo ante ajuste fuerte. */
  motivo: string
  mostrarCostos: boolean
  onToggle: (id: number) => void
  onCantidad: (id: number, valor: string) => void
  onMotivo: (id: number, valor: string) => void
}

export const FilaSugerencia = memo(function FilaSugerencia({
  fila: f,
  marcado,
  cantidad,
  motivo,
  mostrarCostos,
  onToggle,
  onCantidad,
  onMotivo,
}: Props) {
  const cantidadNum = Number(cantidad.replace(',', '.')) || 0
  const ajusteFuerte =
    marcado && esAjusteFuerte(f.cantidad_sugerida_redondeada, cantidadNum)

  // Trazabilidad de la sugerencia (spec §29): qué datos usó el cálculo.
  const explicacion =
    f.venta_diaria > 0
      ? `${formatearNumero(f.venta_diaria)}/día × ${formatearNumero(f.dias_cobertura_objetivo)} días objetivo = ${formatearCantidad(f.stock_objetivo, f.venta_por_peso)} − ${formatearCantidad(f.stock_actual, f.venta_por_peso)} stock − ${formatearCantidad(f.stock_en_transito, f.venta_por_peso)} en camino`
      : f.requiere_compra
        ? `Sin ventas 30d: piso = stock mínimo ${formatearCantidad(f.stock_minimo, f.venta_por_peso)}`
        : 'Sin ventas en los últimos 30 días'

  return (
    <TableRow
      className={cn('border-b-[#e4c9b0]/40', !marcado && 'opacity-50')}
    >
      <TableCell>
        <input
          type="checkbox"
          checked={marcado}
          onChange={() => onToggle(f.producto_id)}
          className="accent-[#f9b44c] h-4 w-4"
          aria-label={`Incluir ${f.nombre}`}
        />
      </TableCell>
      <TableCell className="min-w-[220px]">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'h-2.5 w-2.5 rounded-full shrink-0',
              COLOR_ESTADO[f.estado]
            )}
            title={TITULO_ESTADO[f.estado]}
          />
          <div className="min-w-0">
            <div className="font-medium text-[#391511] text-sm truncate">
              {f.nombre}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {f.codigo_barras && (
                <span className="text-[#c8a58a] text-xs font-mono">
                  {f.codigo_barras}
                </span>
              )}
              {f.es_critico && (
                <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-[#c43e2c]/10 text-[#c43e2c]">
                  Crítico
                </span>
              )}
              {f.producto_nuevo && (
                <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-[#f9b44c]/25 text-[#a15c2f]">
                  Nuevo
                </span>
              )}
              {f.es_sobrestock && (
                <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-[#6f3a2a]/10 text-[#6f3a2a]">
                  Sobrestock
                </span>
              )}
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-center">
        {f.clase_abc ? (
          <span
            className={cn(
              'inline-flex h-5 w-5 items-center justify-center rounded font-bold text-[11px]',
              f.clase_abc === 'A' && 'bg-[#2f6f4f]/15 text-[#2f6f4f]',
              f.clase_abc === 'B' && 'bg-[#e4a42a]/20 text-[#a15c2f]',
              f.clase_abc === 'C' && 'bg-[#c8a58a]/20 text-[#6f3a2a]'
            )}
          >
            {f.clase_abc}
          </span>
        ) : (
          <span className="text-[#c8a58a]">—</span>
        )}
      </TableCell>
      <TableCell
        className={cn(
          'text-right tabular-nums font-bold',
          f.stock_actual <= 0 ? 'text-[#c43e2c]' : 'text-[#391511]'
        )}
      >
        {formatearCantidad(f.stock_actual, f.venta_por_peso)}
      </TableCell>
      <TableCell className="text-right tabular-nums text-[#6f3a2a]">
        {formatearCantidad(f.venta_30d, f.venta_por_peso)}
      </TableCell>
      <TableCell className="text-right tabular-nums text-[#6f3a2a]">
        {f.venta_diaria > 0 ? formatearNumero(f.venta_diaria) : '—'}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {f.dias_stock == null ? (
          <span className="text-[#c8a58a] text-xs italic">sin ventas</span>
        ) : (
          <span
            className={cn(
              'font-semibold',
              f.dias_stock < 0 || f.estado === 'rojo'
                ? 'text-[#c43e2c]'
                : f.estado === 'naranja'
                  ? 'text-[#a15c2f]'
                  : 'text-[#391511]'
            )}
          >
            {formatearNumero(f.dias_stock)} d
          </span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums text-[#6f3a2a]">
        {f.stock_en_transito > 0 ? (
          <span className="inline-flex items-center gap-1 text-[#2f6f4f] font-semibold">
            <Truck className="h-3 w-3" />
            {formatearCantidad(f.stock_en_transito, f.venta_por_peso)}
          </span>
        ) : (
          '—'
        )}
        {f.borrador_pendiente > 0 && (
          <div
            className="text-[10px] text-[#a15c2f]"
            title="Hay una orden en borrador con estas unidades: no descuentan la sugerencia."
          >
            borrador: {formatearCantidad(f.borrador_pendiente, f.venta_por_peso)}
          </div>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums text-[#6f3a2a]">
        {formatearCantidad(f.punto_reposicion, f.venta_por_peso)}
      </TableCell>
      <TableCell className="text-right tabular-nums text-[#6f3a2a]">
        {formatearCantidad(f.stock_objetivo, f.venta_por_peso)}
      </TableCell>
      <TableCell className="text-right tabular-nums" title={explicacion}>
        {f.cantidad_sugerida_redondeada > 0 ? (
          <div>
            <span className="font-bold text-[#391511]">
              {formatearCantidad(f.cantidad_sugerida_redondeada, f.venta_por_peso)}
            </span>
            {f.multiplo_compra != null &&
              f.multiplo_compra > 0 &&
              f.cantidad_sugerida !== f.cantidad_sugerida_redondeada && (
                <div className="text-[10px] text-[#6f3a2a]">
                  necesidad:{' '}
                  {formatearCantidad(f.cantidad_sugerida, f.venta_por_peso)}
                </div>
              )}
          </div>
        ) : (
          <span className="text-[#c8a58a]">0</span>
        )}
      </TableCell>
      <TableCell className="text-center text-[#6f3a2a] tabular-nums text-sm">
        {f.multiplo_compra != null && f.multiplo_compra > 0
          ? `x${formatearNumero(f.multiplo_compra)}`
          : '—'}
      </TableCell>
      {mostrarCostos && (
        <TableCell className="text-right tabular-nums text-sm text-[#6f3a2a]">
          {f.precio_costo > 0 ? (
            <div>
              ${formatearNumero(f.precio_costo)}
              {f.variacion_costo_pct != null &&
                Math.abs(f.variacion_costo_pct) >= 0.1 && (
                  <div
                    className={cn(
                      'text-[10px] font-semibold',
                      f.variacion_costo_pct > 0
                        ? 'text-[#c43e2c]'
                        : 'text-[#2f6f4f]'
                    )}
                    title={`Variación contra el último costo del proveedor${f.ultimo_costo != null ? ` ($${formatearNumero(f.ultimo_costo)})` : ''}. Margen: ${f.margen_pct != null ? `${formatearNumero(f.margen_pct)}%` : '—'}`}
                  >
                    {f.variacion_costo_pct > 0 ? '+' : ''}
                    {formatearNumero(f.variacion_costo_pct)}%
                  </div>
                )}
            </div>
          ) : (
            '—'
          )}
        </TableCell>
      )}
      <TableCell>
        <Input
          type="number"
          min="0"
          step={f.venta_por_peso ? '0.001' : '1'}
          inputMode="decimal"
          value={cantidad}
          onChange={(e) => onCantidad(f.producto_id, e.target.value)}
          className={cn(
            'h-8 w-24 text-center tabular-nums border-[#e4c9b0]',
            ajusteFuerte && 'border-[#e4a42a] ring-1 ring-[#e4a42a]/50'
          )}
          title={
            ajusteFuerte
              ? `Ajuste fuerte: el sistema sugirió ${formatearCantidad(f.cantidad_sugerida_redondeada, f.venta_por_peso)}`
              : undefined
          }
          aria-label={`Pedido final de ${f.nombre}`}
        />
        {ajusteFuerte && (
          // Motivo opcional del ajuste (mig 152): queda guardado en la orden
          // para analizar después las decisiones de compra.
          <Input
            value={motivo}
            onChange={(e) => onMotivo(f.producto_id, e.target.value)}
            placeholder="Motivo (opcional)"
            maxLength={120}
            className="h-7 w-24 mt-1 text-xs border-[#e4a42a]/60 placeholder:text-[#c8a58a]"
            aria-label={`Motivo del ajuste de ${f.nombre}`}
          />
        )}
      </TableCell>
    </TableRow>
  )
})
