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

const formateadorKg = new Intl.NumberFormat('es-AR', {
  maximumFractionDigits: 3,
})

/**
 * Formatea una cantidad de producto según su unidad de medida.
 * Por peso: hasta 3 decimales con sufijo "kg" (ej: 4,7 kg). Por unidad:
 * entero con "u." (ej: 3 u.). Se usa para que la recepción, el pedido y las
 * diferencias muestren la unidad correcta de cada producto.
 */
export function formatearCantidad(cantidad: number, porPeso: boolean): string {
  if (porPeso) return `${formateadorKg.format(cantidad)} kg`
  return `${formatearNumero(cantidad)} u.`
}
