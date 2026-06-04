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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TabResumen } from './TabResumen'
import { TabCuentasAPagar } from './TabCuentasAPagar'
import { TabEgresos } from './TabEgresos'
import { TabCuentas } from './TabCuentas'
import { TabMovimientos } from './TabMovimientos'
import { TabCajaFuerte } from './TabCajaFuerte'
import { TabPorCobrar } from './TabPorCobrar'
import { TabConciliacionBancaria } from './TabConciliacionBancaria'
import {
  rangoDesdeFechas,
  rangoPredefinido,
  type ClavePeriodo,
} from '@/lib/utils/periodos'

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

  const rango = useMemo(() => {
    if (periodo === 'personalizado') {
      return rangoDesdeFechas(desdePersonalizado, hastaPersonalizado)
    }
    return rangoPredefinido(periodo)
  }, [periodo, desdePersonalizado, hastaPersonalizado])

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

      <Tabs defaultValue="resumen" className="space-y-4">
        <TabsList className="bg-white border border-[#e4c9b0]/60 p-1 h-auto flex-wrap">
          <TabsTrigger
            value="resumen"
            className="data-[state=active]:bg-[#f9b44c]/20 data-[state=active]:text-[#391511] data-[state=active]:shadow-sm"
          >
            Resumen
          </TabsTrigger>
          <TabsTrigger
            value="caja_fuerte"
            className="data-[state=active]:bg-[#f9b44c]/20 data-[state=active]:text-[#391511] data-[state=active]:shadow-sm"
          >
            Caja fuerte
          </TabsTrigger>
          <TabsTrigger
            value="por_cobrar"
            className="data-[state=active]:bg-[#f9b44c]/20 data-[state=active]:text-[#391511] data-[state=active]:shadow-sm"
          >
            Por cobrar
          </TabsTrigger>
          <TabsTrigger
            value="cuentas_bancarias"
            className="data-[state=active]:bg-[#f9b44c]/20 data-[state=active]:text-[#391511] data-[state=active]:shadow-sm"
          >
            Cuentas
          </TabsTrigger>
          <TabsTrigger
            value="movimientos"
            className="data-[state=active]:bg-[#f9b44c]/20 data-[state=active]:text-[#391511] data-[state=active]:shadow-sm"
          >
            Movimientos
          </TabsTrigger>
          <TabsTrigger
            value="conciliacion"
            className="data-[state=active]:bg-[#f9b44c]/20 data-[state=active]:text-[#391511] data-[state=active]:shadow-sm"
          >
            Conciliación
          </TabsTrigger>
          <TabsTrigger
            value="cuentas_pagar"
            className="data-[state=active]:bg-[#f9b44c]/20 data-[state=active]:text-[#391511] data-[state=active]:shadow-sm"
          >
            Cuentas a pagar
          </TabsTrigger>
          <TabsTrigger
            value="egresos"
            className="data-[state=active]:bg-[#f9b44c]/20 data-[state=active]:text-[#391511] data-[state=active]:shadow-sm"
          >
            Egresos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="resumen">
          <TabResumen desde={rango.desde} hasta={rango.hasta} />
        </TabsContent>
        <TabsContent value="caja_fuerte">
          <TabCajaFuerte />
        </TabsContent>
        <TabsContent value="por_cobrar">
          <TabPorCobrar />
        </TabsContent>
        <TabsContent value="cuentas_bancarias">
          <TabCuentas />
        </TabsContent>
        <TabsContent value="movimientos">
          <TabMovimientos desde={rango.desde} hasta={rango.hasta} />
        </TabsContent>
        <TabsContent value="conciliacion">
          <TabConciliacionBancaria />
        </TabsContent>
        <TabsContent value="cuentas_pagar">
          <TabCuentasAPagar />
        </TabsContent>
        <TabsContent value="egresos">
          <TabEgresos desde={rango.desde} hasta={rango.hasta} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
