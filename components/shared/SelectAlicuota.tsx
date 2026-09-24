'use client'

import { useMemo } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ALICUOTAS_IVA,
  claveAlicuota,
  esAlicuotaValida,
  etiquetaAlicuota,
} from '@/lib/utils/fiscal'
import { cn } from '@/lib/utils'

interface Props {
  /** Alícuota como string (`'10.5'`, `'21'`); '' = sin definir. */
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  className?: string
  size?: 'sm' | 'default'
  /** Etiqueta accesible (en tablas no hay label visible). */
  ariaLabel?: string
}

/**
 * Selector de alícuota de IVA: solo deja elegir las legales (0, 2,5, 5, 10,5,
 * 21, 27). Reemplaza al input numérico libre, que con la rueda del mouse
 * cambiaba el 21 por un 22 sin que nadie lo notara. Un valor viejo fuera de
 * la lista se muestra en rojo como "(inválido)" hasta que se corrija.
 */
export function SelectAlicuota({
  value,
  onChange,
  disabled,
  className,
  size = 'default',
  ariaLabel = 'Alícuota de IVA',
}: Props) {
  const clave = claveAlicuota(value)
  const invalida = clave !== '' && !esAlicuotaValida(clave)

  const items = useMemo(() => {
    const r: Record<string, string> = {}
    // El trigger va en celdas angostas: texto corto ("10,5 %"); la lista
    // desplegada usa la etiqueta completa.
    for (const a of ALICUOTAS_IVA) r[String(a)] = `${String(a).replace('.', ',')} %`
    if (invalida) r[clave] = `${clave.replace('.', ',')} % ✕`
    return r
  }, [clave, invalida])

  return (
    <Select
      items={items}
      value={clave}
      onValueChange={(v) => onChange(v ?? '')}
      disabled={disabled}
    >
      <SelectTrigger
        size={size}
        aria-label={ariaLabel}
        aria-invalid={invalida || undefined}
        title={
          invalida
            ? `${clave.replace('.', ',')} % no es una alícuota de IVA legal: elegí otra.`
            : undefined
        }
        className={cn(
          'w-full border-[#e4c9b0] tabular-nums',
          invalida && 'font-bold text-[#c43e2c]',
          className
        )}
      >
        <SelectValue placeholder="IVA" />
      </SelectTrigger>
      <SelectContent>
        {ALICUOTAS_IVA.map((a) => (
          <SelectItem key={a} value={String(a)}>
            {etiquetaAlicuota(a)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
