'use client'

import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ClipboardCheck,
  ShoppingCart,
  Tag,
  XOctagon,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatearNumero } from '@/lib/utils/formato'
import { useResumenAlertasStock } from '@/lib/hooks/useInventario'
import { useResumenVencimientos } from '@/lib/hooks/useVencimientos'
import { useConteos } from '@/lib/hooks/useConteos'
import { useEtiquetasPendientes } from '@/lib/hooks/useEtiquetas'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { tienePermiso } from '@/lib/permisos'
import type { EstadoStock } from '@/lib/queries/inventario'

interface Props {
  estadoFiltro: EstadoStock | null
  onCambiarFiltro: (estado: EstadoStock | null) => void
}

/**
 * Encabezado de "Pendientes": junta en tarjetas lo accionable de todo el área.
 * Las de stock FILTRAN la tabla; las de otros módulos NAVEGAN (gateadas por
 * permiso). Reemplaza al antiguo PanelAlertas (que solo cubría stock).
 */
export function PanelPendientes({ estadoFiltro, onCambiarFiltro }: Props) {
  const { data: usuario } = useUsuario()
  const { data: alertas, isLoading } = useResumenAlertasStock()
  const { data: venc } = useResumenVencimientos()
  const { data: conteos } = useConteos()
  const { data: etiquetas } = useEtiquetasPendientes()

  const puedeVencimientos = tienePermiso(usuario?.permisos, 'vencimientos')
  const puedeConteos = tienePermiso(usuario?.permisos, 'conteo_gestion')
  const puedeEtiquetas = tienePermiso(usuario?.permisos, 'etiquetas')

  const bajo = alertas?.bajo_stock ?? 0
  const sinStock = alertas?.agotados ?? 0
  // Unidades por vencer redondeadas a entero: la suma puede traer decimales de
  // productos por peso, pero en el KPI se muestra como unidades enteras.
  const porVencer = Math.round(venc?.unidades_por_vencer ?? 0)
  const conteosPorAprobar = (conteos ?? []).filter((c) => c.estado === 'contado').length
  const etiquetasPend = etiquetas?.length ?? 0

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl bg-[#f9d2a2]/30" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
      <Tarjeta
        etiqueta="A reponer"
        valor={bajo}
        sufijo="productos"
        icono={AlertTriangle}
        color="#e4a42a"
        activo={estadoFiltro === 'bajo'}
        destacar={bajo > 0}
        onClick={() => onCambiarFiltro(estadoFiltro === 'bajo' ? null : 'bajo')}
        accionHref="/pedidos/nuevo"
        accionIcono={ShoppingCart}
        accionLabel="Comprar"
      />
      <Tarjeta
        etiqueta="Sin stock"
        valor={sinStock}
        sufijo="productos"
        icono={XOctagon}
        color="#c43e2c"
        activo={estadoFiltro === 'critico'}
        destacar={sinStock > 0}
        onClick={() =>
          onCambiarFiltro(estadoFiltro === 'critico' ? null : 'critico')
        }
      />
      {puedeVencimientos && (
        <Tarjeta
          etiqueta="Por vencer"
          valor={porVencer}
          sufijo="unidades"
          icono={CalendarClock}
          color="#c43e2c"
          destacar={porVencer > 0}
          href="/vencimientos"
        />
      )}
      {puedeConteos && (
        <Tarjeta
          etiqueta="Conteos por aprobar"
          valor={conteosPorAprobar}
          icono={ClipboardCheck}
          color="#1e5fb0"
          destacar={conteosPorAprobar > 0}
          href="/inventario/control"
        />
      )}
      {puedeEtiquetas && (
        <Tarjeta
          etiqueta="Etiquetas pendientes"
          valor={etiquetasPend}
          icono={Tag}
          color="#6f3a2a"
          destacar={etiquetasPend > 0}
          href="/etiquetas"
        />
      )}
    </div>
  )
}

interface TarjetaProps {
  etiqueta: string
  valor: number
  sufijo?: string
  icono: React.ElementType
  color: string
  destacar?: boolean
  /** Tarjeta de filtro (in-situ) */
  activo?: boolean
  onClick?: () => void
  /** Tarjeta de navegación */
  href?: string
  /** Acción secundaria (link) en una tarjeta de filtro, ej. "Comprar". */
  accionHref?: string
  accionLabel?: string
  accionIcono?: React.ElementType
}

function Tarjeta({
  etiqueta,
  valor,
  sufijo,
  icono: Icono,
  color,
  destacar,
  activo,
  onClick,
  href,
  accionHref,
  accionLabel,
  accionIcono: AccionIcono,
}: TarjetaProps) {
  const contenido = (
    <>
      <div className="shrink-0 p-2.5 rounded-xl" style={{ backgroundColor: `${color}22` }}>
        <Icono className="h-5 w-5" style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold flex items-center gap-1">
          {etiqueta}
          {href && <ArrowRight className="h-3 w-3 opacity-50" />}
        </div>
        <div className="text-3xl font-extrabold text-[#391511] tabular-nums leading-tight">
          {formatearNumero(valor)}
        </div>
        {sufijo && (
          <div className="text-[10px] text-[#c8a58a] -mt-0.5">{sufijo}</div>
        )}
      </div>
      {activo && (
        <span className="text-[9px] font-medium text-[#391511] uppercase tracking-wider opacity-70 self-start">
          filtrado
        </span>
      )}
    </>
  )

  const clases = cn(
    'group text-left rounded-2xl border-2 transition-all p-4 flex items-center gap-3 bg-white',
    activo ? 'border-[#391511] shadow-md' : 'border-[#e4c9b0]/60 hover:border-[#c8a58a]',
    destacar && !activo && 'ring-2 ring-offset-1 ring-[#f9b44c]/40'
  )

  if (href) {
    return (
      <Link href={href} className={clases}>
        {contenido}
      </Link>
    )
  }

  // Tarjeta de filtro con acción secundaria (link): el botón filtra y el link
  // de acción se posiciona encima, sin anidar <a> dentro de <button>.
  if (accionHref) {
    return (
      <div className="relative">
        <button type="button" onClick={onClick} className={cn(clases, 'w-full')}>
          {contenido}
        </button>
        <Link
          href={accionHref}
          className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-lg bg-[#391511] px-2 py-1 text-[10px] font-semibold text-white hover:bg-[#4d1f17]"
        >
          {AccionIcono && <AccionIcono className="h-3 w-3" />}
          {accionLabel}
        </Link>
      </div>
    )
  }

  return (
    <button type="button" onClick={onClick} className={clases}>
      {contenido}
    </button>
  )
}
