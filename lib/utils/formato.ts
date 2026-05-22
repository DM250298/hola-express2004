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

export function formatearNumero(numero: number): string {
  return new Intl.NumberFormat('es-AR').format(numero)
}
