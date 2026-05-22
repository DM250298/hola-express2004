'use client'

import { Delete } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const TECLAS: Array<string | 'borrar'> = [
  '1', '2', '3',
  '4', '5', '6',
  '7', '8', '9',
  '00', '0', 'borrar',
]

const ATAJOS = [500, 1000, 2000, 5000, 10000, 20000]

interface Props {
  valor: string
  onCambio: (v: string) => void
  totalACobrar: number
}

/**
 * Teclado numérico grande pensado para tablet (dedos, no mouse).
 * Cada tecla es ≥56px para tocar sin error. También ofrece atajos de
 * billetes comunes para sumarlos directo al monto recibido.
 */
export function TecladoPago({ valor, onCambio, totalACobrar }: Props) {
  function presionar(tecla: string | 'borrar') {
    if (tecla === 'borrar') {
      onCambio(valor.slice(0, -1))
      return
    }
    // Limitamos a 9 dígitos enteros + 2 decimales para evitar overflow visual
    if (valor.length >= 11) return
    onCambio(valor + tecla)
  }

  function sumarAtajo(monto: number) {
    const actual = Number(valor) || 0
    onCambio(String(actual + monto))
  }

  function setExacto() {
    onCambio(totalACobrar.toFixed(2))
  }

  return (
    <div className="space-y-2">
      {/* Atajos de billetes */}
      <div className="grid grid-cols-3 gap-1.5">
        <Button
          type="button"
          variant="outline"
          onClick={setExacto}
          className="h-10 text-xs font-bold border-[#f9b44c] bg-[#f9b44c]/15 text-[#391511] hover:bg-[#f9b44c]/30"
        >
          Exacto
        </Button>
        {ATAJOS.slice(0, 2).map((m) => (
          <Button
            key={m}
            type="button"
            variant="outline"
            onClick={() => sumarAtajo(m)}
            className="h-10 text-xs font-medium border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#f9d2a2]/40 tabular-nums"
          >
            +${m.toLocaleString('es-AR')}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {ATAJOS.slice(2).map((m) => (
          <Button
            key={m}
            type="button"
            variant="outline"
            onClick={() => sumarAtajo(m)}
            className="h-10 text-xs font-medium border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#f9d2a2]/40 tabular-nums"
          >
            +${m.toLocaleString('es-AR')}
          </Button>
        ))}
      </div>

      {/* Teclado numérico */}
      <div className="grid grid-cols-3 gap-2 pt-1">
        {TECLAS.map((t) => (
          <Button
            key={t}
            type="button"
            variant="outline"
            onClick={() => presionar(t)}
            className={cn(
              'h-14 text-xl font-bold border-[#e4c9b0] active:scale-95 transition-transform',
              t === 'borrar'
                ? 'bg-[#c43e2c]/10 text-[#c43e2c] hover:bg-[#c43e2c]/20'
                : 'bg-white text-[#391511] hover:bg-[#fdfaf6]'
            )}
          >
            {t === 'borrar' ? <Delete className="h-5 w-5" /> : t}
          </Button>
        ))}
      </div>
    </div>
  )
}
