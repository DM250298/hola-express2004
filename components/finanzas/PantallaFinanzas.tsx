'use client'

import { useMemo, useState } from 'react'
import { Calendar } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { TabTableroDirectivo } from './TabTableroDirectivo'
import { TabFlujoProyectado } from './TabFlujoProyectado'
import { TabComprobantes } from './TabComprobantes'
import { TabImpuestos } from './TabImpuestos'
import { TabCuentasAPagar } from './TabCuentasAPagar'
import { TabEgresos } from './TabEgresos'
import { TabCuentas } from './TabCuentas'
import { TabMovimientos } from './TabMovimientos'
import { TabCajaFuerte } from './TabCajaFuerte'
import { TabPorCobrar } from './TabPorCobrar'
import {
  rangoDesdeFechas,
  rangoPredefinido,
  type ClavePeriodo,
} from '@/lib/utils/periodos'

const GRUPOS: { titulo: string; tabs: { value: string; label: string }[] }[] = [
  { titulo: 'Mi negocio', tabs: [{ value: 'tablero', label: 'Tablero' }] },
  {
    titulo: 'Plata que entra y sale',
    tabs: [
      { value: 'caja_fuerte', label: 'Caja fuerte' },
      { value: 'por_cobrar', label: 'Por cobrar' },
      { value: 'cuentas_bancarias', label: 'Cuentas' },
      { value: 'movimientos', label: 'Movimientos' },
      { value: 'egresos', label: 'Egresos' },
    ],
  },
  {
    titulo: 'Lo que debo e impuestos',
    tabs: [
      { value: 'cuentas_pagar', label: 'Cuentas a pagar' },
      { value: 'comprobantes', label: 'Facturas de proveedores' },
      { value: 'impuestos', label: 'Impuestos' },
      { value: 'flujo', label: 'Flujo proyectado' },
    ],
  },
]

function isoLocalAHoy(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function inicioMesIso(): string {
  const d = new Date()
  d.setDate(1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export function PantallaFinanzas() {
  const [periodo, setPeriodo] = useState<ClavePeriodo>('mes_actual')
  const [desdePersonalizado, setDesdePersonalizado] =
    useState<string>(inicioMesIso())
  const [hastaPersonalizado, setHastaPersonalizado] =
    useState<string>(isoLocalAHoy())
  const [tab, setTab] = useState<string>('tablero')
  // Cuenta por la que se filtran los Movimientos al llegar desde una card.
  const [cuentaMovs, setCuentaMovs] = useState<number | null>(null)

  const rango = useMemo(() => {
    if (periodo === 'personalizado') {
      return rangoDesdeFechas(desdePersonalizado, hastaPersonalizado)
    }
    return rangoPredefinido(periodo)
  }, [periodo, desdePersonalizado, hastaPersonalizado])

  // Navegación normal por la barra: sin filtro de cuenta pre-aplicado.
  function irATab(value: string) {
    setCuentaMovs(null)
    setTab(value)
  }
  // Desde una cuenta: abre Movimientos ya filtrado por esa cuenta.
  function verMovimientosDeCuenta(cuentaId: number) {
    setCuentaMovs(cuentaId)
    setTab('movimientos')
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[#391511] text-2xl font-bold">Finanzas</h1>
          <p className="text-[#6f3a2a] text-sm mt-1">
            P&L del período, cuentas a pagar y egresos operativos.
          </p>
        </div>

        {/* Selector de período */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Período
            </Label>
            <Select
              value={periodo}
              onValueChange={(v) =>
                setPeriodo((v ?? 'mes_actual') as ClavePeriodo)
              }
            >
              <SelectTrigger className="w-[180px] border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
                <Calendar className="h-3.5 w-3.5 text-[#c8a58a] mr-1.5" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mes_actual">Este mes</SelectItem>
                <SelectItem value="mes_anterior">Mes anterior</SelectItem>
                <SelectItem value="ultimos_7">Últimos 7 días</SelectItem>
                <SelectItem value="personalizado">Personalizado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {periodo === 'personalizado' && (
            <>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  Desde
                </Label>
                <Input
                  type="date"
                  value={desdePersonalizado}
                  max={hastaPersonalizado}
                  onChange={(e) => setDesdePersonalizado(e.target.value)}
                  className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums bg-white"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  Hasta
                </Label>
                <Input
                  type="date"
                  value={hastaPersonalizado}
                  min={desdePersonalizado}
                  max={isoLocalAHoy()}
                  onChange={(e) => setHastaPersonalizado(e.target.value)}
                  className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums bg-white"
                />
              </div>
            </>
          )}
        </div>
      </header>

      <div className="space-y-4">
        {/* Barra de tabs agrupada (botones propios, no el TabsList de base-ui) */}
        <div className="rounded-lg border border-[#e4c9b0]/60 bg-white p-2 space-y-2">
          {GRUPOS.map((g) => (
            <div key={g.titulo} className="space-y-1">
              <div className="px-1 text-[10px] font-bold uppercase tracking-wider text-[#c8a58a]">
                {g.titulo}
              </div>
              <div className="flex flex-wrap gap-1">
                {g.tabs.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => irATab(t.value)}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-sm font-medium transition-colors',
                      tab === t.value
                        ? 'bg-[#f9b44c]/20 text-[#391511] shadow-sm'
                        : 'text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511]'
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Panel activo */}
        {tab === 'tablero' && (
          <TabTableroDirectivo
            desde={rango.desde}
            hasta={rango.hasta}
            navegar={irATab}
          />
        )}
        {tab === 'flujo' && <TabFlujoProyectado />}
        {tab === 'comprobantes' && (
          <TabComprobantes desde={rango.desde} hasta={rango.hasta} />
        )}
        {tab === 'cuentas_pagar' && <TabCuentasAPagar />}
        {tab === 'impuestos' && (
          <TabImpuestos desde={rango.desde} hasta={rango.hasta} />
        )}
        {tab === 'caja_fuerte' && <TabCajaFuerte />}
        {tab === 'por_cobrar' && <TabPorCobrar />}
        {tab === 'cuentas_bancarias' && (
          <TabCuentas onVerMovimientos={verMovimientosDeCuenta} />
        )}
        {tab === 'movimientos' && (
          <TabMovimientos
            desde={rango.desde}
            hasta={rango.hasta}
            cuentaInicial={cuentaMovs}
          />
        )}
        {tab === 'egresos' && (
          <TabEgresos desde={rango.desde} hasta={rango.hasta} />
        )}
      </div>
    </div>
  )
}