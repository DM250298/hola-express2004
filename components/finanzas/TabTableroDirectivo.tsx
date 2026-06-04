'use client'

import {
  AlertTriangle,
  Banknote,
  Boxes,
  Calculator,
  CreditCard,
  Landmark,
  Receipt,
  Scale,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { MontoARS } from '@/components/shared/MontoARS'
import { GraficoVentasEgresos } from './GraficoVentasEgresos'
import { useResumenFinanciero } from '@/lib/hooks/useFinanzas'
import { useTableroDirectivo } from '@/lib/hooks/useTableroDirectivo'
import { cn } from '@/lib/utils'

interface Props {
  desde: string
  hasta: string
}

export function TabTableroDirectivo({ desde, hasta }: Props) {
  const { data: resumen } = useResumenFinanciero(desde, hasta)
  const { data: t } = useTableroDirectivo(desde, hasta)

  const resultado = resumen?.resultado_neto ?? 0

  return (
    <div className="space-y-5">
      <p className="text-[#6f3a2a] text-sm">
        Centro de mando: la foto del dinero del negocio en tiempo real. Todos
        los socios ven exactamente lo mismo.
      </p>

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
          detalle="Efectivo + bancos + billeteras"
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
          detalle={`${t?.por_cobrar_pendientes ?? 0} acreditación(es) en camino`}
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
          <Linea
            label="Total disponible"
            monto={t?.posicion_caja.total ?? 0}
            fuerte
          />
        </Card>

        {/* Deudas a corto plazo */}
        <Card titulo="Deudas a corto plazo (proveedores)" icono={Receipt}>
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
      </div>
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
}: {
  icono: React.ElementType
  etiqueta: string
  monto: number
  detalle: string
  tono?: 'verde' | 'rojo'
  destacado?: boolean
}) {
  const color =
    tono === 'verde'
      ? 'text-[#2f7d4f]'
      : tono === 'rojo'
        ? 'text-[#c43e2c]'
        : 'text-[#391511]'
  return (
    <div
      className={cn(
        'rounded-2xl p-4',
        destacado
          ? 'border-2 border-[#f9b44c]/50 bg-[#f9b44c]/10'
          : 'border border-[#e4c9b0]/60 bg-white shadow-sm'
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
}: {
  titulo: string
  icono: React.ElementType
  children: React.ReactNode
}) {
  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
      <div className="px-4 py-2.5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
        <h3 className="text-[#391511] font-semibold text-sm flex items-center gap-2">
          <Icono className="h-4 w-4 text-[#f9b44c]" />
          {titulo}
        </h3>
      </div>
      <div className="divide-y divide-[#e4c9b0]/40">{children}</div>
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
