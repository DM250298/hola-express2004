'use client'

import { useMemo } from 'react'
import { MontoARS } from '@/components/shared/MontoARS'
import { cn } from '@/lib/utils'

/** Billetes y monedas de curso legal en Argentina (2026). */
const DENOMINACIONES = [
  { valor: 20000, etiqueta: '$20.000' },
  { valor: 10000, etiqueta: '$10.000' },
  { valor: 5000,  etiqueta: '$5.000'  },
  { valor: 2000,  etiqueta: '$2.000'  },
  { valor: 1000,  etiqueta: '$1.000'  },
  { valor: 500,   etiqueta: '$500'    },
  { valor: 200,   etiqueta: '$200'    },
  { valor: 100,   etiqueta: '$100'    },
  { valor: 50,    etiqueta: '$50'     },
  { valor: 20,    etiqueta: '$20'     },
  { valor: 10,    etiqueta: '$10'     },
]

interface Props {
  /** Record: denominación → cantidad de billetes. */
  cantidades: Record<number, number>
  onChange: (cantidades: Record<number, number>) => void
}

export function ContadorBilletes({ cantidades, onChange }: Props) {
  const total = useMemo(
    () =>
      DENOMINACIONES.reduce(
        (acc, d) => acc + d.valor * (cantidades[d.valor] ?? 0),
        0
      ),
    [cantidades]
  )

  function setCantidad(valor: number, raw: string) {
    const n = parseInt(raw, 10)
    const cantidad = isNaN(n) || n < 0 ? 0 : n
    onChange({ ...cantidades, [valor]: cantidad })
  }

  return (
    <div className="space-y-2">
      {/* Tabla de denominaciones */}
      <div className="rounded-xl border border-[#e4c9b0]/60 overflow-hidden bg-white">
        <div className="grid grid-cols-[1fr_80px_1fr] text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold px-3 py-1.5 bg-[#fdfaf6] border-b border-[#e4c9b0]/40">
          <span>Billete</span>
          <span className="text-center">Cantidad</span>
          <span className="text-right">Subtotal</span>
        </div>
        <ul className="divide-y divide-[#e4c9b0]/30">
          {DENOMINACIONES.map((d) => {
            const cant = cantidades[d.valor] ?? 0
            const subtotal = d.valor * cant
            return (
              <li
                key={d.valor}
                className={cn(
                  'grid grid-cols-[1fr_80px_1fr] items-center px-3 py-1.5 gap-2',
                  cant > 0 ? 'bg-[#f9b44c]/8' : ''
                )}
              >
                {/* Denominación */}
                <span className="font-semibold text-sm text-[#391511] tabular-nums">
                  {d.etiqueta}
                </span>

                {/* Input cantidad */}
                <input
                  type="number"
                  min="0"
                  value={cant === 0 ? '' : cant}
                  onChange={(e) => setCantidad(d.valor, e.target.value)}
                  placeholder="0"
                  className={cn(
                    'w-full text-center font-bold tabular-nums rounded-lg border px-2 py-1 text-sm outline-none transition-colors',
                    cant > 0
                      ? 'border-[#f9b44c] bg-[#f9b44c]/10 text-[#391511]'
                      : 'border-[#e4c9b0] bg-white text-[#391511]',
                    'focus:border-[#f9b44c] focus:bg-[#f9b44c]/10'
                  )}
                />

                {/* Subtotal */}
                <span
                  className={cn(
                    'text-right text-sm tabular-nums font-medium',
                    cant > 0 ? 'text-[#391511] font-bold' : 'text-[#c8a58a]'
                  )}
                >
                  {cant > 0 ? <MontoARS monto={subtotal} /> : '—'}
                </span>
              </li>
            )
          })}
        </ul>

        {/* Total */}
        <div className="grid grid-cols-[1fr_80px_1fr] items-center px-3 py-2.5 bg-[#fdfaf6] border-t border-[#e4c9b0]/60">
          <span className="text-xs font-bold uppercase tracking-wide text-[#391511]">
            Total contado
          </span>
          <span />
          <span className="text-right font-extrabold text-[#391511] tabular-nums">
            <MontoARS monto={total} />
          </span>
        </div>
      </div>
    </div>
  )
}
