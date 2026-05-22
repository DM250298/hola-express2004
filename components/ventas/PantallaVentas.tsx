'use client'

import { useEffect, useMemo, useState } from 'react'
import { Eye, Receipt } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { MontoARS } from '@/components/shared/MontoARS'
import {
  PaginadorTabla,
  paginarArreglo,
  type PorPagina,
} from '@/components/shared/PaginadorTabla'
import { DrawerDetalleVenta } from './DrawerDetalleVenta'
import { useVentasListado } from '@/lib/hooks/useVentasListado'
import { useMediosPago } from '@/lib/hooks/useMediosPago'
import {
  etiquetaMedioFallback,
  resolverIconoMedio,
} from '@/lib/utils/iconosMedioPago'
import { formatearFechaHora, formatearMonto } from '@/lib/utils/formato'
import {
  rangoDesdeFechas,
  rangoPredefinido,
  type ClavePeriodo,
} from '@/lib/utils/periodos'
import type { MedioPago } from '@/types/database'

const TODOS = '__todos__'

function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function PantallaVentas() {
  const [periodo, setPeriodo] = useState<ClavePeriodo>('mes_actual')
  const [desdePers, setDesdePers] = useState(hoyIso())
  const [hastaPers, setHastaPers] = useState(hoyIso())
  const [medioFiltro, setMedioFiltro] = useState<string>(TODOS)
  const [estadoFiltro, setEstadoFiltro] = useState<string>('completada')
  const [pagina, setPagina] = useState(0)
  const [porPagina, setPorPagina] = useState<PorPagina>(25)
  const [ventaSeleccionada, setVentaSeleccionada] = useState<number | null>(null)

  const rango = useMemo(() => {
    if (periodo === 'personalizado') {
      return rangoDesdeFechas(desdePers, hastaPers)
    }
    return rangoPredefinido(periodo)
  }, [periodo, desdePers, hastaPers])

  const filtros = useMemo(
    () => ({
      desde: rango.desde,
      hasta: rango.hasta,
      medio_pago: (medioFiltro === TODOS ? null : (medioFiltro as MedioPago)),
      estado:
        estadoFiltro === TODOS ? null : (estadoFiltro as 'completada' | 'anulada'),
    }),
    [rango.desde, rango.hasta, medioFiltro, estadoFiltro]
  )

  const { data: ventas, isLoading, isError } = useVentasListado(filtros)
  const { data: medios } = useMediosPago()

  const medioInfo = useMemo(() => {
    const mapa = new Map<string, { nombre: string; icono: string }>()
    for (const m of medios ?? [])
      mapa.set(m.codigo, { nombre: m.nombre, icono: m.icono })
    return mapa
  }, [medios])

  useEffect(() => {
    setPagina(0)
  }, [filtros])

  const ventasPagina = useMemo(
    () => paginarArreglo(ventas ?? [], pagina, porPagina),
    [ventas, pagina, porPagina]
  )

  const totalPeriodo = (ventas ?? []).reduce(
    (acc, v) => acc + Number(v.total),
    0
  )

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <header>
        <h1 className="text-[#391511] text-2xl font-bold">Ventas</h1>
        <p className="text-[#6f3a2a] text-sm mt-1">
          Detalle de todas las ventas realizadas en el punto de venta.
        </p>
      </header>

      {/* KPI total */}
      <div className="rounded-2xl border-2 border-[#f9b44c]/40 bg-[#f9b44c]/10 p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#f9b44c]/30">
            <Receipt className="h-5 w-5 text-[#391511]" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Total del período filtrado
            </div>
            <div className="text-xs text-[#6f3a2a]">
              {ventas?.length ?? 0} {ventas?.length === 1 ? 'venta' : 'ventas'}
            </div>
          </div>
        </div>
        <div className="text-3xl font-extrabold text-[#391511] tabular-nums">
          {formatearMonto(totalPeriodo)}
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-end gap-3">
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
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hoy">Hoy</SelectItem>
                <SelectItem value="ultimos_7">Última semana</SelectItem>
                <SelectItem value="mes_actual">Este mes</SelectItem>
                <SelectItem value="mes_anterior">Mes anterior</SelectItem>
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
                  value={desdePers}
                  max={hastaPers}
                  onChange={(e) => setDesdePers(e.target.value)}
                  className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] bg-white tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  Hasta
                </Label>
                <Input
                  type="date"
                  value={hastaPers}
                  min={desdePers}
                  max={hoyIso()}
                  onChange={(e) => setHastaPers(e.target.value)}
                  className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] bg-white tabular-nums"
                />
              </div>
            </>
          )}

          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Medio de pago
            </Label>
            <Select
              value={medioFiltro}
              onValueChange={(v) => setMedioFiltro(v ?? TODOS)}
            >
              <SelectTrigger className="w-[180px] border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos</SelectItem>
                {(medios ?? []).map((m) => (
                  <SelectItem key={m.codigo} value={m.codigo}>
                    {m.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Estado
            </Label>
            <Select
              value={estadoFiltro}
              onValueChange={(v) => setEstadoFiltro(v ?? 'completada')}
            >
              <SelectTrigger className="w-[160px] border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="completada">Completadas</SelectItem>
                <SelectItem value="anulada">Anuladas</SelectItem>
                <SelectItem value={TODOS}>Todas</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={8} columnas={6} />
          </div>
        ) : isError ? (
          <div className="p-10 text-center text-[#c43e2c] text-sm">
            No se pudieron cargar las ventas.
          </div>
        ) : !ventas || ventas.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              <Receipt className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">Sin ventas en el período</p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              Probá ampliar el rango o cambiar los filtros.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                  <TableHead className="text-[#391511] font-semibold w-16">
                    #
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Fecha
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Cajero
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Turno
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Items
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Medio
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Total
                  </TableHead>
                  <TableHead className="text-right w-16 text-[#391511] font-semibold">
                    Ver
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ventasPagina.map((v) => {
                  const info = medioInfo.get(v.medio_pago)
                  const Icono = resolverIconoMedio(info?.icono)
                  return (
                    <TableRow
                      key={v.id}
                      className="border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6] cursor-pointer"
                      onClick={() => setVentaSeleccionada(v.id)}
                    >
                      <TableCell className="font-mono text-xs text-[#6f3a2a] tabular-nums">
                        #{v.id}
                      </TableCell>
                      <TableCell className="text-[#6f3a2a] text-xs tabular-nums whitespace-nowrap">
                        {formatearFechaHora(v.fecha)}
                      </TableCell>
                      <TableCell className="text-[#391511] text-sm">
                        {v.cajero_nombre ?? (
                          <span className="text-[#c8a58a] italic">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-[#6f3a2a] text-xs tabular-nums">
                        #{v.turno_id}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-[#6f3a2a]">
                        {v.cantidad_items}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1 text-xs text-[#391511]">
                          <Icono className="h-3.5 w-3.5 text-[#6f3a2a]" />
                          {info?.nombre ?? etiquetaMedioFallback(v.medio_pago)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-bold text-[#391511] tabular-nums">
                        <MontoARS monto={v.total} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            setVentaSeleccionada(v.id)
                          }}
                          className="text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511]"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {ventas && ventas.length > 0 && (
        <PaginadorTabla
          total={ventas.length}
          porPagina={porPagina}
          pagina={pagina}
          onCambioPorPagina={setPorPagina}
          onCambioPagina={setPagina}
        />
      )}

      <DrawerDetalleVenta
        ventaId={ventaSeleccionada}
        onCambioAbierto={(v) => !v && setVentaSeleccionada(null)}
      />
    </div>
  )
}
