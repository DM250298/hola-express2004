import {
  AlertCircle,
  Check,
  Clock,
  FileQuestion,
  ShieldCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ETIQUETA_ESTADO,
  type EstadoFactura,
  type FilaPortal,
  type MarcaFactura,
} from '@/lib/facturas/portal'

const ESTILO: Record<
  EstadoFactura,
  { clase: string; icono: React.ElementType }
> = {
  sin_factura: {
    clase: 'bg-[#f9b44c]/20 text-[#7a4a0b] border-[#f9b44c]/50',
    icono: FileQuestion,
  },
  a_validar: {
    clase: 'bg-[#7f77dd]/15 text-[#3c3489] border-[#7f77dd]/40',
    icono: ShieldCheck,
  },
  a_pagar: {
    clase: 'bg-[#378add]/15 text-[#0c447c] border-[#378add]/40',
    icono: Clock,
  },
  vencida: {
    clase: 'bg-[#c43e2c]/15 text-[#9e2f25] border-[#c43e2c]/40',
    icono: AlertCircle,
  },
  pagada: {
    clase: 'bg-[#2f8f4e]/15 text-[#1f5e34] border-[#2f8f4e]/40',
    icono: Check,
  },
}

/** Color de acento del estado (borde de las tarjetas de arriba). */
export const COLOR_ESTADO: Record<EstadoFactura, string> = {
  sin_factura: '#e4a42a',
  a_validar: '#7f77dd',
  a_pagar: '#378add',
  vencida: '#c43e2c',
  pagada: '#2f8f4e',
}

interface Props {
  estado: EstadoFactura
  size?: 'sm' | 'md'
  className?: string
}

export function ChipEstadoFactura({ estado, size = 'sm', className }: Props) {
  const { clase, icono: Icono } = ESTILO[estado]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap',
        clase,
        size === 'md' && 'text-xs px-2.5 py-1',
        className
      )}
    >
      <Icono className={size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3'} />
      {ETIQUETA_ESTADO[estado]}
    </span>
  )
}

/** Texto de una marca secundaria (debajo del chip). */
export function textoMarca(marca: MarcaFactura, fila: FilaPortal): string {
  switch (marca) {
    case 'parcial':
      return 'pago parcial'
    case 'cuotas': {
      const c = fila.cuenta
      if (c?.proxima_cuota) {
        return `cuota ${c.proxima_cuota.numero}/${c.cuotas.length}`
      }
      return `${c?.cuotas.length ?? 0} cuotas`
    }
    case 'con_diferencias': {
      const n = fila.factura?.renglones_diferentes ?? 0
      return n === 1 ? '1 renglón difiere de la recepción' : `${n} renglones difieren de la recepción`
    }
    case 'sin_datos_fiscales':
      return 'faltan datos fiscales'
    case 'pagada_sin_factura':
      return 'pagada · falta la factura'
    case 'pago_inmediato':
      return 'pagada en el acto'
  }
}

/** ¿La marca es un problema a resolver (se pinta en rojo)? */
export function marcaEsAlerta(marca: MarcaFactura): boolean {
  return marca === 'con_diferencias' || marca === 'sin_datos_fiscales' || marca === 'pagada_sin_factura'
}
