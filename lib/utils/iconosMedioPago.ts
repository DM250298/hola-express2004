import {
  Banknote,
  CreditCard,
  Wallet,
  Smartphone,
  Landmark,
  Coins,
  QrCode,
  HandCoins,
  PiggyBank,
  Gift,
  Receipt,
  type LucideIcon,
} from 'lucide-react'

/**
 * Iconos disponibles para los medios de pago. La clave (string en kebab-case)
 * es lo que se guarda en `medios_pago.icono`.
 */
export const ICONOS_MEDIO_PAGO: Record<string, LucideIcon> = {
  banknote: Banknote,
  'credit-card': CreditCard,
  wallet: Wallet,
  smartphone: Smartphone,
  landmark: Landmark,
  coins: Coins,
  'qr-code': QrCode,
  'hand-coins': HandCoins,
  'piggy-bank': PiggyBank,
  gift: Gift,
  receipt: Receipt,
}

/** Devuelve el componente de icono para un nombre dado (fallback: Wallet). */
export function resolverIconoMedio(nombre: string | null | undefined): LucideIcon {
  if (nombre && ICONOS_MEDIO_PAGO[nombre]) return ICONOS_MEDIO_PAGO[nombre]
  return Wallet
}

const ETIQUETAS_BASE: Record<string, string> = {
  efectivo: 'Efectivo',
  debito: 'Débito',
  credito: 'Crédito',
  transferencia: 'Transferencia',
}

/**
 * Etiqueta legible de un medio de pago a partir de su código, sin consultar
 * la base. Útil para medios que ya no existen en la tabla (borrados) o cuando
 * la lista de medios aún no cargó.
 */
export function etiquetaMedioFallback(codigo: string): string {
  if (ETIQUETAS_BASE[codigo]) return ETIQUETAS_BASE[codigo]
  return codigo
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')
}

/** Opciones para el selector de icono en el ABM de medios de pago. */
export const OPCIONES_ICONO_MEDIO: Array<{ valor: string; etiqueta: string }> = [
  { valor: 'banknote', etiqueta: 'Billete' },
  { valor: 'credit-card', etiqueta: 'Tarjeta' },
  { valor: 'wallet', etiqueta: 'Billetera' },
  { valor: 'smartphone', etiqueta: 'Celular' },
  { valor: 'landmark', etiqueta: 'Banco' },
  { valor: 'coins', etiqueta: 'Monedas' },
  { valor: 'qr-code', etiqueta: 'QR' },
  { valor: 'hand-coins', etiqueta: 'Mano con monedas' },
  { valor: 'piggy-bank', etiqueta: 'Alcancía' },
  { valor: 'gift', etiqueta: 'Regalo' },
  { valor: 'receipt', etiqueta: 'Comprobante' },
]
