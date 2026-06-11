'use client'

import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Boxes,
  Calculator,
  CheckCircle2,
  CreditCard,
  Landmark,
  ListChecks,
  Receipt,
  Scale,
  Ticket,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { MontoARS } from '@/components/shared/MontoARS'
import { Skeleton } from '@/components/ui/skeleton'
import { EstadoError } from '@/components/shared/EstadoError'
import { GraficoVentasEgresos } from './GraficoVentasEgresos'
import { useResumenFinanciero } from '@/lib/hooks/useFinanzas'
import { useTableroDirectivo } from '@/lib/hooks/useTableroDirectivo'
import { useSangriasEnBuzon } from '@/lib/hooks/useCajaFuerte'
import { cn } from '@/lib/utils'

interface Props {
  desde: string
  hasta: string
  navegar?: (tab: string) => void
}

export function TabTableroDirectivo({ desde, hasta, navegar }: Props) {
  const {
    data: resumen,
    isLoading: cargandoResumen,
    isError: errorResumen,
    refetch: refetchResumen,
  } = useResumenFinanciero(desde, hasta)
  const {
    data: t,
    isLoading: cargandoTablero,
    isError: errorTablero,
    refetch: refetchTablero,
  } = useTableroDirectivo(desde, hasta)

  const { data: buzon } = useSangriasEnBuzon()

  const cargando = cargandoResumen || cargandoTablero
  const error = errorResumen || errorTablero
  const resultado = resumen?.resultado_neto ?? 0

  // "Para hacer hoy": acciones pendientes con su monto y a dónde llevan.
  const tareas: {
    texto: string
    monto?: number
    accion: string
    tab: string
    tono?: 'rojo'
  }[] = []
  if ((t?.por_pagar.vencidas ?? 0) > 0)
    tareas.push({
      texto: 'Tenés deudas vencidas',
      monto: t?.por_pagar.vencidas ?? 0,
      accion: 'Pagar',
      tab: 'cuentas_pagar',
      tono: 'rojo',
    })
  if ((t?.por_pagar.vence_7 ?? 0) > 0)
    tareas.push({
      texto: 'Deudas que vencen esta semana',
      monto: t?.por_pagar.vence_7 ?? 0,
      accion: 'Ver',
      tab: 'cuentas_pagar',
    })
  if ((buzon?.length ?? 0) > 0)
    tareas.push({
      texto: `${buzon?.length} retiro(s) de caja sin contar`,
      accion: 'Contar',
      tab: 'caja_fuerte',
    })
  if ((t?.por_cobrar_pendientes ?? 0) > 0)
    tareas.push({
      texto: `${t?.por_cobrar_pendientes} cobro(s) de tarjeta en camino`,
      monto: t?.por_cobrar_neto ?? 0,
      accion: 'Ver',
      tab: 'por_cobrar',
    })

  return (
    <div className="space-y-5">
      <p className="text-[#6f3a2a] text-sm">
        Centro de mando: la foto del dinero del negocio en tiempo real. Todos
        los socios ven exactamente lo mismo.
      </p>

      {error ? (
        <EstadoError
          mensaje="No pudimos cargar el tablero. Revisá tu conexión e intentá de nuevo."
          onReintentar={() => {
            refetchResumen()
            refetchTablero()
          }}
        />
      ) : cargando ? (
        <TableroSkeleton />
      ) : (
        <>
          <PanelHacerHoy tareas={tareas} navegar={navegar} />

          {/* Fila principal */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          icono={resultado >= 0 ? TrendingUp : TrendingDown}
          etiqueta="Resultado del período"
          monto={resultado}
          detalle="Ventas − costos − egresos"
          tono={resultado >= 0 ? 'verde' : 'rojo'}
          destacado
        />
        <Kpi
          icono={Scale}
          etiqueta="Posición de caja"
          monto={t?.posicion_caja.total ?? 0}
          detalle="Disponible hoy (sin contar lo ya depositado)"
        />
        <Kpi
          icono={Boxes}
          etiqueta="Capital en inventario"
          monto={t?.capital_inventario ?? 0}
          detalle="Mercadería a costo (inmovilizado)"
        />
        <Kpi
          icono={CreditCard}
          etiqueta="Por cobrar (tarjetas)"
          monto={t?.por_cobrar_neto ?? 0}
          detalle={`${t?.por_cobrar_pendientes ?? 0} cobro(s) en camino`}
          onClick={navegar ? () => navegar('por_cobrar') : undefined}
        />
      </div>

      {/* Cash flow del período */}
      {resumen && resumen.series_semanales.length > 0 && (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 shadow-sm">
          <h3 className="text-[#391511] font-semibold text-sm mb-3">
            Flujo del período — ventas vs. egresos
          </h3>
          <GraficoVentasEgresos series={resumen.series_semanales} />
        </div>
      )}

      {/* Posición de caja + Deudas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Posición de caja desglosada */}
        <Card titulo="Dónde está el efectivo" icono={Wallet}>
          <Linea
            icono={Banknote}
            label="Efectivo (cajas)"
            monto={t?.posicion_caja.efectivo ?? 0}
          />
          <Linea
            icono={Landmark}
            label="Bancos"
            monto={t?.posicion_caja.banco ?? 0}
          />
          <Linea
            icono={CreditCard}
            label="Billeteras (MP, etc.)"
            monto={t?.posicion_caja.billetera ?? 0}
          />
          {(t?.posicion_caja.remesado ?? 0) > 0 && (
            <Linea
              label="Menos lo ya depositado (ya figura en Bancos)"
              monto={-(t?.posicion_caja.remesado ?? 0)}
              tono="rojo"
            />
          )}
          <Linea
            label="Total disponible"
            monto={t?.posicion_caja.total ?? 0}
            fuerte
          />
        </Card>

        {/* Deudas a corto plazo */}
        <Card
          titulo="Deudas a corto plazo (proveedores)"
          icono={Receipt}
          onClick={navegar ? () => navegar('cuentas_pagar') : undefined}
        >
          {(t?.por_pagar.vencidas ?? 0) > 0 && (
            <Linea
              icono={AlertTriangle}
              label="Vencidas"
              monto={t?.por_pagar.vencidas ?? 0}
              tono="rojo"
            />
          )}
          <Linea label="Vencen en 7 días" monto={t?.por_pagar.vence_7 ?? 0} />
          <Linea label="Vencen en 8–15 días" monto={t?.por_pagar.vence_15 ?? 0} />
          <Linea label="Vencen en 16–30 días" monto={t?.por_pagar.vence_30 ?? 0} />
          <Linea
            label="Total pendiente"
            monto={t?.por_pagar.total_pendiente ?? 0}
            fuerte
          />
        </Card>
      </div>

      {/* Secundarios */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          icono={TrendingDown}
          etiqueta="Comisiones del período"
          monto={t?.comisiones_periodo ?? 0}
          detalle="Costo de tarjetas / MP"
        />
        <Kpi
          icono={Calculator}
          etiqueta="Diferencias de arqueo"
          monto={t?.arqueos.diferencia_total ?? 0}
          detalle={`${t?.arqueos.con_diferencia ?? 0} con diferencia de ${
            t?.arqueos.cantidad ?? 0
          }`}
          tono={(t?.arqueos.diferencia_total ?? 0) < 0 ? 'rojo' : undefined}
        />
        <Kpi
          icono={Receipt}
          etiqueta="Margen bruto"
          monto={resumen?.margen_bruto ?? 0}
          detalle="Ventas − costo de mercadería"
        />
        <Kpi
          icono={TrendingDown}
          etiqueta="Mermas del período"
          monto={resumen?.mermas ?? 0}
          detalle="Productos dados de baja"
          tono="rojo"
        />
        <Kpi
          icono={Ticket}
          etiqueta="Ticket promedio"
          monto={resumen?.ticket_promedio ?? 0}
          detalle="Promedio por venta"
        />
          </div>
        </>
      )}
    </div>
  )
}

function TableroSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <KpiSkeleton key={i} />
        ))}
      </div>
      <Skeleton className="h-56 w-full rounded-2xl bg-[#f9d2a2]/25" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-48 w-full rounded-2xl bg-[#f9d2a2]/25" />
        <Skeleton className="h-48 w-full rounded-2xl bg-[#f9d2a2]/25" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <KpiSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}

function KpiSkeleton() {
  return (
    <div className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-4 shadow-sm space-y-2">
      <Skeleton className="h-3 w-2/3 bg-[#f9d2a2]/40" />
      <Skeleton className="h-6 w-1/2 bg-[#f9d2a2]/30" />
      <Skeleton className="h-2.5 w-3/4 bg-[#f9d2a2]/25" />
    </div>
  )
}

function Kpi({
  icono: Icono,
  etiqueta,
  monto,
  detalle,
  tono,
  destacado,
  onClick,
}: {
  icono: React.ElementType
  etiqueta: string
  monto: number
  detalle: string
  tono?: 'verde' | 'rojo'
  destacado?: boolean
  onClick?: () => void
}) {
  const color =
    tono === 'verde'
      ? 'text-[#2f7d4f]'
      : tono === 'rojo'
        ? 'text-[#c43e2c]'
        : 'text-[#391511]'
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
      className={cn(
        'rounded-2xl p-4',
        destacado
          ? 'border-2 border-[#f9b44c]/50 bg-[#f9b44c]/10'
          : 'border border-[#e4c9b0]/60 bg-white shadow-sm',
        onClick &&
          'cursor-pointer transition-colors hover:border-[#f9b44c] hover:shadow-md'
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
        <Icono className="h-3.5 w-3.5 text-[#f9b44c]" />
        {etiqueta}
      </div>
      <div className={cn('text-xl font-extrabold tabular-nums mt-1', color)}>
        <MontoARS monto={monto} />
      </div>
      <div className="text-[11px] text-[#6f3a2a] mt-0.5">{detalle}</div>
    </div>
  )
}

function Card({
  titulo,
  icono: Icono,
  children,
  onClick,
}: {
  titulo: string
  icono: React.ElementType
  children: React.ReactNode
  onClick?: () => void
}) {
  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
      <div className="px-4 py-2.5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] flex items-center justify-between gap-2">
        <h3 className="text-[#391511] font-semibold text-sm flex items-center gap-2">
          <Icono className="h-4 w-4 text-[#f9b44c]" />
          {titulo}
        </h3>
        {onClick && (
          <button
            type="button"
            onClick={onClick}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#9e6b15] hover:text-[#391511] hover:underline"
          >
            Ver
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="divide-y divide-[#e4c9b0]/40">{children}</div>
    </div>
  )
}

function PanelHacerHoy({
  tareas,
  navegar,
}: {
  tareas: {
    texto: string
    monto?: number
    accion: string
    tab: string
    tono?: 'rojo'
  }[]
  navegar?: (tab: string) => void
}) {
  return (
    <div className="rounded-2xl border border-[#e4c9b0]/60 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-[#f9b44c]" />
        <h3 className="text-[#391511] font-semibold text-sm">Para hacer hoy</h3>
      </div>
      {tareas.length === 0 ? (
        <div className="px-4 py-5 flex items-center gap-2 text-[#2f7d4f] text-sm">
          <CheckCircle2 className="h-4 w-4" />
          Estás al día. No hay nada pendiente.
        </div>
      ) : (
        <ul className="divide-y divide-[#e4c9b0]/40">
          {tareas.map((t, i) => (
            <li
              key={i}
              className="px-4 py-2.5 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                {t.tono === 'rojo' && (
                  <AlertTriangle className="h-3.5 w-3.5 text-[#c43e2c] shrink-0" />
                )}
                <span
                  className={cn(
                    'text-sm',
                    t.tono === 'rojo'
                      ? 'text-[#c43e2c] font-medium'
                      : 'text-[#391511]'
                  )}
                >
                  {t.texto}
                </span>
                {t.monto !== undefined && (
                  <span className="text-sm font-bold text-[#391511] tabular-nums">
                    <MontoARS monto={t.monto} />
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => navegar?.(t.tab)}
                className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-[#9e6b15] hover:text-[#391511] hover:underline"
              >
                {t.accion}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Linea({
  icono: Icono,
  label,
  monto,
  fuerte,
  tono,
}: {
  icono?: React.ElementType
  label: string
  monto: number
  fuerte?: boolean
  tono?: 'rojo'
}) {
  return (
    <div
      className={cn(
        'px-4 py-2.5 flex items-center justify-between gap-2',
        fuerte && 'bg-[#fdfaf6]'
      )}
    >
      <span
        className={cn(
          'text-sm flex items-center gap-1.5',
          fuerte ? 'font-bold text-[#391511]' : 'text-[#6f3a2a]',
          tono === 'rojo' && 'text-[#c43e2c]'
        )}
      >
        {Icono && <Icono className="h-3.5 w-3.5" />}
        {label}
      </span>
      <span
        className={cn(
          'tabular-nums',
          fuerte ? 'font-extrabold text-[#391511]' : 'font-semibold text-[#391511]',
          tono === 'rojo' && 'text-[#c43e2c]'
        )}
      >
        <MontoARS monto={monto} />
      </span>
    </div>
  )
}
