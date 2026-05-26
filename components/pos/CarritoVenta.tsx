'use client'

import { Minus, Plus, Scale, ShoppingCart, Trash2, User, Wifi, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MontoARS } from '@/components/shared/MontoARS'
import {
  calcularTotal,
  contarUnidades,
  formatearCantidadItem,
  type AccionCarrito,
  type ItemCarrito,
} from './carrito'
import { cn } from '@/lib/utils'

interface Props {
  items: ItemCarrito[]
  dispatch: React.Dispatch<AccionCarrito>
  onCobrar: () => void
  /** Nombre del cliente asociado a la venta, o null si es al mostrador. */
  clienteNombre: string | null
  onElegirCliente: () => void
  onQuitarCliente: () => void
  /** Cobrar directo en una terminal Point. */
  onCobrarTerminal?: () => void
  /** ¿Hay alguna terminal Point activa configurada en el sistema? */
  hayTerminalActiva?: boolean
  /** Abre el modal de peso para re-editar un ítem por kg. */
  onEditarPeso?: (productoId: number) => void
}

export function CarritoVenta({
  items,
  dispatch,
  onCobrar,
  clienteNombre,
  onElegirCliente,
  onQuitarCliente,
  onCobrarTerminal,
  hayTerminalActiva = false,
  onEditarPeso,
}: Props) {
  const total = calcularTotal(items)
  const unidades = contarUnidades(items)
  const vacio = items.length === 0

  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl flex flex-col h-full overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-4 w-4 text-[#391511]" />
          <h2 className="text-[#391511] font-bold">Venta</h2>
          {!vacio && (
            <span className="text-xs text-[#6f3a2a]">
              · {unidades} {unidades === 1 ? 'ítem' : 'ítems'}
            </span>
          )}
        </div>
        {!vacio && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dispatch({ tipo: 'VACIAR' })}
            className="text-[#c43e2c] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c] text-xs h-7"
          >
            Vaciar
          </Button>
        )}
      </div>

      {/* Cliente de la venta */}
      <div className="px-3 py-2 border-b border-[#e4c9b0]/40 bg-white">
        {clienteNombre ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onElegirCliente}
              className="flex-1 flex items-center gap-2 min-w-0 text-left rounded-lg px-2 py-1.5 bg-[#f9b44c]/15 hover:bg-[#f9b44c]/25 transition-colors"
            >
              <User className="h-3.5 w-3.5 text-[#6f3a2a] shrink-0" />
              <span className="text-sm font-semibold text-[#391511] truncate">
                {clienteNombre}
              </span>
            </button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onQuitarCliente}
              className="h-7 w-7 text-[#c8a58a] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c] shrink-0"
              aria-label="Quitar cliente"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onElegirCliente}
            className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-[#6f3a2a] hover:bg-[#fdfaf6] transition-colors"
          >
            <User className="h-3.5 w-3.5 text-[#c8a58a]" />
            <span className="text-xs font-medium">
              Agregar cliente (opcional)
            </span>
          </button>
        )}
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {vacio ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6 py-10">
            <div className="p-3 rounded-full bg-[#f9d2a2]/40 mb-2">
              <ShoppingCart className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold text-sm">Carrito vacío</p>
            <p className="text-[#6f3a2a] text-xs mt-1">
              Buscá un producto o tocá uno de los frecuentes.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[#e4c9b0]/40">
            {items.map((it) => (
              <li key={it.producto_id} className="px-3 py-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-[#391511] text-sm leading-tight flex items-center gap-1.5">
                      {it.nombre}
                      {it.venta_por_peso && (
                        <Scale className="h-3 w-3 text-[#c8a58a] shrink-0" />
                      )}
                    </div>
                    <div className="text-xs text-[#6f3a2a] mt-0.5 tabular-nums">
                      <MontoARS monto={it.precio_unitario} />
                      <span className="text-[#c8a58a]">
                        {it.venta_por_peso ? ' / kg' : ' c/u'}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      dispatch({ tipo: 'ELIMINAR', producto_id: it.producto_id })
                    }
                    className="h-7 w-7 text-[#c8a58a] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c] shrink-0"
                    aria-label="Eliminar"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  {it.venta_por_peso ? (
                    /* ── Producto por peso: mostrar gramos + botón editar ── */
                    <button
                      type="button"
                      onClick={() => onEditarPeso?.(it.producto_id)}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#e4c9b0] bg-[#fdfaf6] hover:bg-[#f9d2a2]/40 transition-colors"
                    >
                      <Scale className="h-3.5 w-3.5 text-[#6f3a2a]" />
                      <span className="font-bold text-[#391511] tabular-nums text-sm">
                        {formatearCantidadItem(it)}
                      </span>
                      <span className="text-[10px] text-[#6f3a2a] uppercase tracking-wide">
                        editar
                      </span>
                    </button>
                  ) : (
                    /* ── Producto por unidad: controles +/- ── */
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() =>
                          dispatch({
                            tipo: 'CAMBIAR_CANTIDAD',
                            producto_id: it.producto_id,
                            cantidad: it.cantidad - 1,
                          })
                        }
                        className="h-9 w-9 border-[#e4c9b0] hover:bg-[#f9d2a2]/40"
                        aria-label="Restar"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </Button>
                      <span className="w-10 text-center font-bold text-[#391511] tabular-nums">
                        {it.cantidad}
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() =>
                          dispatch({
                            tipo: 'CAMBIAR_CANTIDAD',
                            producto_id: it.producto_id,
                            cantidad: it.cantidad + 1,
                          })
                        }
                        disabled={it.cantidad >= it.stock_disponible}
                        className="h-9 w-9 border-[#e4c9b0] hover:bg-[#f9d2a2]/40 disabled:opacity-40"
                        aria-label="Sumar"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                  <div className="font-bold text-[#391511] tabular-nums">
                    <MontoARS monto={it.precio_unitario * it.cantidad} />
                  </div>
                </div>
                {!it.venta_por_peso && it.cantidad >= it.stock_disponible && (
                  <p className="text-[10px] text-[#c43e2c] mt-1">
                    Stock máximo alcanzado ({it.stock_disponible})
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Total + cobrar */}
      <div
        className={cn(
          'border-t border-[#e4c9b0]/60 px-4 py-4 space-y-3',
          vacio ? 'bg-[#fdfaf6]' : 'bg-white'
        )}
      >
        <div className="flex items-baseline justify-between">
          <span className="text-[#6f3a2a] text-sm font-medium uppercase tracking-wider">
            Total
          </span>
          <span className="text-[#391511] text-3xl font-extrabold tabular-nums">
            <MontoARS monto={total} />
          </span>
        </div>
        <div
          className={cn(
            'grid gap-2',
            hayTerminalActiva && onCobrarTerminal
              ? 'grid-cols-2'
              : 'grid-cols-1'
          )}
        >
          <Button
            onClick={onCobrar}
            title="Cobrar (F4)"
            disabled={vacio}
            className="h-14 text-base bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-extrabold rounded-xl shadow-md disabled:opacity-50 disabled:cursor-not-allowed gap-2"
          >
            Cobrar
            <kbd className="px-1.5 py-0.5 bg-[#391511]/15 border border-[#391511]/20 rounded text-xs font-mono">
              F4
            </kbd>
          </Button>
          {hayTerminalActiva && onCobrarTerminal && (
            <Button
              onClick={onCobrarTerminal}
              title="Cobrar con la maquinita Point"
              disabled={vacio}
              variant="outline"
              className="h-14 text-base border-2 border-[#391511] text-[#391511] bg-white hover:bg-[#fdfaf6] font-extrabold rounded-xl shadow-sm disabled:opacity-50 disabled:cursor-not-allowed gap-1.5"
            >
              <Wifi className="h-4 w-4" />
              Maquinita
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
