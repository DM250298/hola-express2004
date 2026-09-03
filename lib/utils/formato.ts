import { format } from 'date-fns'
import { es } from 'date-fns/locale'

export function formatearFecha(fecha: string | Date): string {
  return format(new Date(fecha), "dd 'de' MMMM 'de' yyyy", { locale: es })
}

export function formatearFechaCorta(fecha: string | Date): string {
  return format(new Date(fecha), 'dd/MM/yyyy', { locale: es })
}

/**
 * dd/MM/yyyy de una columna `date` de Postgres (yyyy-MM-dd), SIN pasar por
 * UTC. `new Date('2026-09-04')` se parsea como medianoche UTC y en Argentina
 * (UTC-3) se muestra como el día anterior — en una etiqueta de vencimiento eso
 * es un día de menos. Si viene un timestamp completo cae a formatearFechaCorta.
 */
export function formatearFechaCortaISO(fecha: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    const [anio, mes, dia] = fecha.split('-')
    return `${dia}/${mes}/${anio}`
  }
  return formatearFechaCorta(fecha)
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

// Al GRAMO en pantalla: hasta 3 decimales, sin ceros de relleno (1,56 kg /
// 0,2 kg / 3 kg). Antes se redondeaba a 1 decimal por prolijidad del listado,
// pero mostrar "1,6 kg" cuando hay 1,56 kg hacía que el conteo físico y la
// recepción no cerraran contra la balanza: en fiambrería el gramo es plata.
const formateadorKg = new Intl.NumberFormat('es-AR', {
  maximumFractionDigits: 3,
})

/**
 * Formatea una cantidad de producto según su unidad de medida.
 * Por peso: hasta 3 decimales con sufijo "kg" (ej: 1,56 kg — el gramo es la
 * unidad mínima que guarda la base, numeric(12,3)). Por unidad: entero con
 * "u." (ej: 3 u.). Se usa para que la recepción, el pedido y las diferencias
 * muestren la unidad correcta de cada producto.
 */
export function formatearCantidad(cantidad: number, porPeso: boolean): string {
  if (porPeso) return `${formateadorKg.format(cantidad)} kg`
  return `${formatearNumero(cantidad)} u.`
}

/**
 * Heurística anti-desastre de la carga por peso: un valor ENTERO grande
 * (≥ 100) tipeado en un campo de KILOS es casi seguro un peso leído en
 * GRAMOS de la balanza (ej: "3805" por 3,805 kg → $53 millones de deuda).
 * Solo aplica a enteros: "150.5" son 150,5 kg legítimos.
 */
export function pareceGramosEnKg(valor: string): boolean {
  const limpio = valor.trim()
  if (!/^\d+$/.test(limpio)) return false
  return Number(limpio) >= 100
}

/**
 * Redondea una cantidad a lo que la columna puede guardar: 3 decimales
 * (gramos) si el producto es por peso, entero si es por unidad. Las columnas
 * de stock son numeric(12,3), así que Postgres redondearía igual; se hace acá
 * para que el preview en pantalla ("Stock resultante") muestre el número que
 * realmente va a quedar y no el ruido del float (25.499999999 en vez de 25,5).
 */
export function redondearCantidad(cantidad: number, porPeso: boolean): number {
  if (!porPeso) return Math.round(cantidad)
  return Math.round(cantidad * 1000) / 1000
}

/**
 * Dos cantidades son iguales si difieren en menos de 1 gramo. Las cantidades
 * fraccionadas se comparan así y nunca con `===`: restar kilos arrastra error
 * de float (3 − 1,5 − 1,5 puede dar 2,2e-16) y una comparación exacta deja el
 * lote sin cerrar o inventa una diferencia de conteo que no existe.
 */
export function cantidadesIguales(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.0005
}
