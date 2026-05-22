'use client'

import { useMemo, useState } from 'react'
import { ArrowDownCircle, ArrowUpCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import { useLiquidacionIva } from '@/lib/hooks/useContabilidad'
import { cn } from '@/lib/utils'

function mesActual(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function TabImpuestos() {
  const [mes, setMes] = useState(mesActual())

  const { desde, hastaExcl } = useMemo(() => {
    const [anio, m] = mes.split('-').map(Number)
    const sig =
      m === 12
        ? `${anio + 1}-01`
        : `${anio}-${String(m + 1).padStart(2, '0')}`
    return { desde: `${mes}-01`, hastaExcl: `${sig}-01` }
  }, [mes])

  const { data, isLoading } = useLiquidacionIva(desde, hastaExcl)

  const posicion = data?.posicion ?? 0
  const aPagar = posicion > 0.009
  const aFavor = posicion < -0.009

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[#391511] font-bold">Liquidación de IVA</h2>
          <p className="text-[#6f3a2a] text-sm">
            IVA débito (ventas) menos IVA crédito (compras) del período.
          </p>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
            Período
          </Label>
          <Input
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value || mesActual())}
            className="w-[170px] border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
          />
        </div>
      </div>

      {isLoading || !data ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-2xl bg-[#f9d2a2]/30" />
          <Skeleton className="h-28 rounded-2xl bg-[#f9d2a2]/30" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-4">
              <div className="flex items-center gap-2 mb-1">
                <ArrowUpCircle className="h-4 w-4 text-[#2f8f4e]" />
                <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  IVA Débito (ventas)
                </span>
              </div>
              <div className="text-2xl font-extrabold text-[#391511] tabular-nums">
                <MontoARS monto={data.iva_debito} />
              </div>
              <div className="text-xs text-[#6f3a2a] mt-1">
                Ventas del mes: <MontoARS monto={data.ventas_total} />
              </div>
            </div>
            <div className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-4">
              <div className="flex items-center gap-2 mb-1">
                <ArrowDownCircle className="h-4 w-4 text-[#c43e2c]" />
                <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  IVA Crédito (compras)
                </span>
              </div>
              <div className="text-2xl font-extrabold text-[#391511] tabular-nums">
                <MontoARS monto={data.iva_credito} />
              </div>
              <div className="text-xs text-[#6f3a2a] mt-1">
                Compras netas del mes: <MontoARS monto={data.compras_neto} />
              </div>
            </div>
          </div>

          <div
            className={cn(
              'rounded-2xl border-2 p-5 flex items-center justify-between gap-3',
              aPagar
                ? 'border-[#c43e2c]/40 bg-[#c43e2c]/10'
                : aFavor
                  ? 'border-[#2f8f4e]/40 bg-[#2f8f4e]/10'
                  : 'border-[#f9b44c]/40 bg-[#f9b44c]/10'
            )}
          >
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Posición de IVA del período
              </div>
              <div className="text-sm text-[#6f3a2a]">
                {aPagar
                  ? 'Tenés que pagar IVA este mes.'
                  : aFavor
                    ? 'Te queda saldo a favor para el próximo período.'
                    : 'El IVA débito y el crédito se compensan.'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider font-bold text-[#6f3a2a]">
                {aPagar
                  ? 'IVA a pagar'
                  : aFavor
                    ? 'Saldo a favor'
                    : 'Sin saldo'}
              </div>
              <div
                className={cn(
                  'text-3xl font-extrabold tabular-nums',
                  aPagar
                    ? 'text-[#c43e2c]'
                    : aFavor
                      ? 'text-[#2f8f4e]'
                      : 'text-[#391511]'
                )}
              >
                <MontoARS monto={Math.abs(posicion)} />
              </div>
            </div>
          </div>

          <p className="text-[11px] text-[#c8a58a]">
            El IVA débito se calcula asumiendo que el precio de venta del POS
            incluye 21%. El IVA crédito surge de las facturas de compra
            cargadas en Cuentas a pagar.
          </p>
        </>
      )}
    </div>
  )
}
