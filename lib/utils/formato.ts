import { format } from 'date-fns'
import { es } from 'date-fns/locale'

export function formatearFecha(fecha: string | Date): string {
  return format(new Date(fecha), "dd 'de' MMMM 'de' yyyy", { locale: es })
}

export function formatearFechaCorta(fecha: string | Date): string {
  return format(new Date(fecha), 'dd/MM/yyyy', { locale: es })
}

export function formatearFechaHora(fecha: string | Date): string {
  return format(new Date(fecha), "dd/MM/yyyy 'a las' HH:mm", { locale: es })
}

const formateadorARS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
})

export function formatearMonto(monto: number): string {
  return formateadorARS.format(monto)
}

const formateadorARSEntero = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

/** Monto redondeado al peso, sin centavos. Ej: 5000.5 → "$ 5.001". */
export function formatearMontoEntero(monto: number): string {
  return formateadorARSEntero.format(Math.round(monto))
}

export function formatearNumero(numero: number): string {
  return new Intl.NumberFormat('es-AR').format(numero)
}
