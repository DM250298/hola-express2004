'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownRight, ArrowUpRight, Bell, ChevronDown } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { getMovimientosStock } from '@/lib/queries/movimientosStock'
import { cn } from '@/lib/utils'

const LS_VISTO = 'hola-novedades-stock-visto'

interface Props {
  /** Cantidad de movimientos recientes a traer. */
  limite?: number
  className?: string
}

/**
 * Novedades de stock: panel plegable con los últimos movimientos de stock
 * (ventas, recepciones, ajustes, conteos, mermas), positivos y negativos, con
 * un contador de no leídos. El "leído" se guarda por dispositivo en
 * localStorage. Se usa en el modo móvil y en la pantalla de Stock.
 */
export function NovedadesStock({ limite = 30, className }: Props) {
  const [abierto, setAbierto] = useState(false)
  const [visto, setVisto] = useState<string>('')

  useEffect(() => {
    try {
      setVisto(localStorage.getItem(LS_VISTO) ?? '')
    } catch {
      // localStorage no disponible — se ignora
    }
  }, [])

  const { data } = useQuery({
    queryKey: ['novedades-stock', limite],
    queryFn: () => getMovimientosStock({}, 0, limite),
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
  })

  const movimientos = data?.movimientos ?? []

  const noLeidas = useMemo(
    () => movimientos.filter((m) => !visto || m.created_at > visto).length,
    [movimientos, visto]
  )

  function alternar() {
    const siguiente = !abierto
    setAbierto(siguiente)
    if (siguiente) {
      // Al abrir, marcamos todo como leído (por dispositivo).
      const ahora = new Date().toISOString()
      try {
        localStorage.setItem(LS_VISTO, ahora)
      } catch {
        // se ignora
      }
      setVisto(ahora)
    }
  }

  return (
    <div
      className={cn(
        'rounded-2xl border border-[#e4c9b0]/70 bg-white shadow-sm',
        className
      )}
    >
      <button
        type="button"
        onClick={alternar}
        className="flex w-full items-center gap-3 px-4 py-3"
      >
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f9b44c]/15 text-[#9e6b15]">
          <Bell className="h-5 w-5" />
          {noLeidas > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#c43e2c] px-1 text-[10px] font-bold text-white">
              {noLeidas > 99 ? '99+' : noLeidas}
            </span>
          )}
        </span>
        <span className="flex-1 text-left">
          <span className="block font-semibold text-[#391511]">
            Novedades de stock
          </span>
          <span className="block text-xs text-[#6f3a2a]">
            {noLeidas > 0
              ? `${noLeidas} cambio${noLeidas === 1 ? '' : 's'} nuevo${
                  noLeidas === 1 ? '' : 's'
                }`
              : 'Estás al día'}
          </span>
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-[#c8a58a] transition-transform',
            abierto && 'rotate-180'
          )}
        />
      </button>

      {abierto && (
        <ul className="max-h-96 overflow-y-auto border-t border-[#e4c9b0]/50">
          {movimientos.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-[#6f3a2a]">
              Todavía no hay movimientos de stock.
            </li>
          ) : (
            movimientos.map((m) => {
              const delta = m.stock_nuevo - m.stock_anterior
              const positivo = delta >= 0
              return (
                <li
                  key={m.id}
                  className="flex items-center gap-3 border-b border-[#f1e4d4]/70 px-4 py-2.5 last:border-b-0"
                >
                  <span
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                      positivo
                        ? 'bg-[#2f7d4f]/12 text-[#2f7d4f]'
                        : 'bg-[#c43e2c]/12 text-[#c43e2c]'
                    )}
                  >
                    {positivo ? (
                      <ArrowUpRight className="h-4 w-4" />
                    ) : (
                      <ArrowDownRight className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-[#391511]">
                      {m.producto_nombre}
                    </p>
                    <p className="truncate text-xs text-[#6f3a2a]">
                      {m.origen_label}
                      {m.usuario_nombre ? ` · ${m.usuario_nombre}` : ''} ·{' '}
                      {tiempoRelativo(m.created_at)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={cn(
                        'font-bold tabular-nums',
                        positivo ? 'text-[#2f7d4f]' : 'text-[#c43e2c]'
                      )}
                    >
                      {positivo ? '+' : ''}
                      {delta}
                    </p>
                    <p className="text-[10px] text-[#c8a58a]">
                      queda {m.stock_nuevo}
                    </p>
                  </div>
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}

function tiempoRelativo(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { locale: es, addSuffix: true })
  } catch {
    return ''
  }
}
