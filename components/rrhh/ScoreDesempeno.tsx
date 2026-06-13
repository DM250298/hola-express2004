import { cn } from '@/lib/utils'

/** Paleta del score por tramo (mismo criterio en tablero, tab y mi-panel). */
export function colorScore(valor: number | null | undefined): {
  texto: string
  fondo: string
  borde: string
  etiqueta: string
} {
  if (valor == null) {
    return {
      texto: 'text-[#c8a58a]',
      fondo: 'bg-[#c8a58a]/10',
      borde: 'border-[#c8a58a]/30',
      etiqueta: 'Sin datos',
    }
  }
  if (valor >= 80)
    return {
      texto: 'text-[#2f7d4f]',
      fondo: 'bg-[#2f7d4f]/10',
      borde: 'border-[#2f7d4f]/30',
      etiqueta: 'Muy bueno',
    }
  if (valor >= 60)
    return {
      texto: 'text-[#a06b00]',
      fondo: 'bg-[#f9b44c]/15',
      borde: 'border-[#f9b44c]/40',
      etiqueta: 'Bueno',
    }
  if (valor >= 40)
    return {
      texto: 'text-[#c4641e]',
      fondo: 'bg-[#e4a42a]/15',
      borde: 'border-[#e4a42a]/40',
      etiqueta: 'A mejorar',
    }
  return {
    texto: 'text-[#c43e2c]',
    fondo: 'bg-[#c43e2c]/10',
    borde: 'border-[#c43e2c]/30',
    etiqueta: 'Crítico',
  }
}

/** Muestra un puntaje 0-100 (o "—" si es null). */
export function formatearScore(valor: number | null | undefined): string {
  if (valor == null) return '—'
  return String(Math.round(Number(valor)))
}

export function ScoreBadge({
  valor,
  size = 'md',
}: {
  valor: number | null | undefined
  size?: 'sm' | 'md' | 'lg'
}) {
  // Redondear UNA vez: el color y el número mostrado deben coincidir en el
  // borde (ej. 79.5 → "80" y verde, no "80" con color de < 80).
  const n = valor == null ? null : Math.round(Number(valor))
  const c = colorScore(n)
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full font-bold tabular-nums border',
        c.texto,
        c.fondo,
        c.borde,
        size === 'sm' && 'text-xs px-2 py-0.5 min-w-[2rem]',
        size === 'md' && 'text-sm px-2.5 py-1 min-w-[2.5rem]',
        size === 'lg' && 'text-2xl px-4 py-2 min-w-[4rem]'
      )}
    >
      {formatearScore(n)}
    </span>
  )
}
