'use client'

import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface Props {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: string
  className?: string
  autoFocus?: boolean
  disabled?: boolean
  title?: string
}

/**
 * Input numérico que evita el "0 pegado adelante":
 *  - maneja el valor como texto mientras se edita (borrar deja el campo vacío,
 *    no lo fuerza a 0),
 *  - selecciona todo al hacer foco, así al tipear se reemplaza el valor por
 *    defecto en vez de quedar prefijado.
 * Expone value/onChange numéricos para no cambiar la lógica de quien lo usa.
 */
export function InputNumero({
  value,
  onChange,
  min,
  max,
  step,
  className,
  autoFocus,
  disabled,
  title,
}: Props) {
  const [texto, setTexto] = useState(value ? String(value) : '')

  // Sincroniza el texto cuando el valor cambia desde afuera (reset, cambio de
  // orden, etc.). Durante el tipeo el valor parseado coincide, así que no pisa
  // lo que el usuario está escribiendo (ni el "0." de un decimal en curso).
  useEffect(() => {
    if ((Number(texto) || 0) !== value) {
      setTexto(value ? String(value) : '')
    }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Input
      type="number"
      min={min}
      max={max}
      step={step}
      title={title}
      value={texto}
      disabled={disabled}
      autoFocus={autoFocus}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        setTexto(e.target.value)
        onChange(e.target.value === '' ? 0 : Number(e.target.value))
      }}
      className={cn('border-[#e4c9b0] focus-visible:ring-[#f9b44c]', className)}
    />
  )
}
