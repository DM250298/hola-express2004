'use client'

import { useMemo, useState } from 'react'
import { Landmark } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import {
  useConciliarMovimiento,
  useCuentas,
  useMovimientos,
} from '@/lib/hooks/useCuentas'
import { formatearFechaCorta } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'

export function TabConciliacion() {
  const { data: cuentas } = useCuentas(false)
  const [cuentaId, setCuentaId] = useState<string>('')
  const [saldoExtracto, setSaldoExtracto] = useState('')

  const conciliar = useConciliarMovimiento()
  const { data: movimientos, isLoading } = useMovimientos(
    cuentaId ? { cuenta_id: Number(cuentaId) } : {}
  )

  const itemsCuenta = useMemo(() => {
    const r: Record<string, string> = {}
    for (const c of cuentas ?? []) r[String(c.id)] = c.nombre
    return r
  }, [cuentas])

  const cuenta = (cuentas ?? []).find((c) => String(c.id) === cuentaId)
  const movs = cuentaId ? movimientos ?? [] : []
  const conciliados = movs.filter((m) => m.conciliado).length
  const pendientes = movs.length - conciliados

  const saldoSistema = cuenta ? Number(cuenta.saldo_actual) : 0
  const extractoNum = Number(saldoExtracto)
  const diferencia =
    saldoExtracto !== '' && Number.isFinite(extractoNum)
      ? extractoNum - saldoSistema
      : null

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[#391511] font-bold">Conciliación bancaria</h2>
        <p className="text-[#6f3a2a] text-sm">
          Elegí una cuenta y tildá los movimientos que figuran en el extracto
          del banco.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
            Cuenta
          </Label>
          <Select
            items={itemsCuenta}
            value={cuentaId || undefined}
            onValueChange={(v) => setCuentaId(v ?? '')}
          >
            <SelectTrigger className="w-[240px] border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
              <SelectValue placeholder="Elegí una cuenta…" />
            </SelectTrigger>
            <SelectContent>
              {cuentas?.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {cuenta && (
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Saldo según el extracto
            </Label>
            <Input
              type="number"
              step="0.01"
              value={saldoExtracto}
              onChange={(e) => setSaldoExtracto(e.target.value)}
              placeholder="0,00"
              className="w-[180px] border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
            />
          </div>
        )}
      </div>

      {cuenta && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-4">
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Saldo del sistema
            </div>
            <div className="text-xl font-extrabold text-[#391511] tabular-nums">
              <MontoARS monto={saldoSistema} />
            </div>
          </div>
          <div className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-4">
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Movimientos
            </div>
            <div className="text-sm text-[#391511] mt-1">
              <span className="font-bold text-[#2f8f4e]">{conciliados}</span>{' '}
              conciliados ·{' '}
              <span className="font-bold text-[#c43e2c]">{pendientes}</span>{' '}
              pendientes
            </div>
          </div>
          <div
            className={cn(
              'rounded-2xl border p-4',
              diferencia === null
                ? 'border-[#e4c9b0]/60 bg-white'
                : Math.abs(diferencia) < 0.01
                  ? 'border-[#2f8f4e]/40 bg-[#2f8f4e]/10'
                  : 'border-[#c43e2c]/40 bg-[#c43e2c]/10'
            )}
          >
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Diferencia con el extracto
            </div>
            <div className="text-xl font-extrabold text-[#391511] tabular-nums">
              {diferencia === null ? '—' : <MontoARS monto={diferencia} />}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {!cuentaId ? (
          <div className="p-12 text-center">
            <Landmark className="h-6 w-6 text-[#c8a58a] mx-auto mb-2" />
            <p className="text-[#6f3a2a] text-sm">
              Elegí una cuenta para empezar la conciliación.
            </p>
          </div>
        ) : isLoading ? (
          <div className="p-6 space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 rounded-lg bg-[#f9d2a2]/30" />
            ))}
          </div>
        ) : movs.length === 0 ? (
          <div className="p-10 text-center text-[#6f3a2a] text-sm">
            La cuenta no tiene movimientos.
          </div>
        ) : (
          <ul className="divide-y divide-[#e4c9b0]/40">
            {movs.map((m) => {
              const delta = Number(m.saldo_nuevo) - Number(m.saldo_anterior)
              return (
                <li
                  key={m.id}
                  className={cn(
                    'flex items-center gap-3 px-4 py-2.5',
                    m.conciliado ? 'bg-[#2f8f4e]/[0.05]' : 'hover:bg-[#fdfaf6]'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={m.conciliado}
                    onChange={() =>
                      conciliar.mutate({
                        id: m.id,
                        conciliado: !m.conciliado,
                      })
                    }
                    disabled={conciliar.isPending}
                    className="accent-[#2f8f4e] h-4 w-4 shrink-0"
                    aria-label="Conciliado"
                  />
                  <span className="text-xs text-[#6f3a2a] tabular-nums w-20 shrink-0">
                    {formatearFechaCorta(m.fecha)}
                  </span>
                  <span className="flex-1 text-sm text-[#391511] truncate">
                    {m.descripcion}
                  </span>
                  <span
                    className={cn(
                      'text-sm font-bold tabular-nums shrink-0',
                      delta >= 0 ? 'text-[#2f8f4e]' : 'text-[#c43e2c]'
                    )}
                  >
                    {delta >= 0 ? '+' : '−'}
                    <MontoARS monto={Math.abs(delta)} />
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
