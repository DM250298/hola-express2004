'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Download, FileText, Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import { EstadoError } from '@/components/shared/EstadoError'
import {
  PaginadorTabla,
  paginarArreglo,
  type PorPagina,
} from '@/components/shared/PaginadorTabla'
import { SelectorPeriodo } from '@/components/reportes/SelectorPeriodo'
import { AyudaContextual } from '@/components/shared/AyudaContextual'
import { cn } from '@/lib/utils'
import {
  formatearCantidad,
  formatearNumero,
} from '@/lib/utils/formato'
import {
  fechaLocal,
  rangoDesdeFechas,
  rangoPredefinido,
  type ClavePeriodo,
} from '@/lib/utils/periodos'
import { exportarTablaExcel, exportarTablaPDF } from '@/lib/utils/exportarTabla'
import { useResumenSkus } from '@/lib/hooks/useMetricasSku'
import type { ResumenSku } from '@/lib/queries/metricasSku'
import {
  ETIQUETA_DIMENSION,
  SIN_VALOR_DIMENSION,
  type DimensionTablero,
} from '@/lib/queries/tablero'

export type Vista = 'todos' | 'con_venta' | 'quiebres' | 'sin_venta' | 'margen_negativo'
export type Orden = 'ingresos' | 'margen' | 'unidades' | 'cobertura' | 'perdida' | 'sin_venta'

/** Estado inicial del tab, para el drill-down desde el tablero del dueño. */
export interface PropsAnalisisSku {
  filtroDimension?: { dimension: DimensionTablero; valor: string } | null
  vistaInicial?: Vista
  ordenInicial?: Orden
  periodoInicial?: ClavePeriodo
  desdeInicial?: string
  hastaInicial?: string
}

/** Mismo texto que fn_metricas_agrupadas usa para agrupar (mig 180). */
function valorDimension(f: ResumenSku, dimension: DimensionTablero): string {
  switch (dimension) {
    case 'categoria':
      return f.categoria ?? SIN_VALOR_DIMENSION.categoria
    case 'marca':
      return f.marca ?? SIN_VALOR_DIMENSION.marca
    case 'proveedor':
      return f.proveedor ?? SIN_VALOR_DIMENSION.proveedor
    case 'gondola':
      return f.gondola ?? SIN_VALOR_DIMENSION.gondola
    case 'clase_abc':
      return f.clase_abc ?? SIN_VALOR_DIMENSION.clase_abc
  }
}

const VISTAS: Record<Vista, string> = {
  todos: 'Todos',
  con_venta: 'Con ventas',
  quiebres: 'Con quiebres',
  sin_venta: 'Sin ventas en el período',
  margen_negativo: 'Margen negativo',
}

const ORDENES: Record<Orden, string> = {
  ingresos: 'Ingresos',
  margen: 'Margen $',
  unidades: 'Unidades',
  cobertura: 'Menor cobertura',
  perdida: 'Venta perdida',
  sin_venta: 'Más días sin vender',
}

const CLASE_COLOR: Record<string, string> = {
  A: 'bg-[#2f8f4e]/15 text-[#2f7d4f]',
  B: 'bg-[#f9b44c]/25 text-[#a3641c]',
  C: 'bg-[#c43e2c]/10 text-[#c43e2c]',
}

/**
 * Tab "Análisis" de /inventario (Fase C): la tabla-madre por SKU del
 * período — ventas, margen real (costo congelado), cobertura, quiebres,
 * última venta y ubicación. Todo agregado en SQL (fn_resumen_skus).
 */
export function TabAnalisisSku({
  filtroDimension = null,
  vistaInicial,
  ordenInicial,
  periodoInicial,
  desdeInicial,
  hastaInicial,
}: PropsAnalisisSku = {}) {
  // Clase ABC no es un filtro de texto: se traduce a los botones A/B/C
  // (o a la vista "sin ventas" para el grupo sin clase).
  const esClase = filtroDimension?.dimension === 'clase_abc'
  const [periodo, setPeriodo] = useState<ClavePeriodo>(periodoInicial ?? 'mes_actual')
  const [desdeP, setDesdeP] = useState(desdeInicial ?? '')
  const [hastaP, setHastaP] = useState(hastaInicial ?? '')
  const [busqueda, setBusqueda] = useState('')
  const [vista, setVista] = useState<Vista>(
    vistaInicial ??
      (esClase && filtroDimension?.valor === SIN_VALOR_DIMENSION.clase_abc
        ? 'sin_venta'
        : filtroDimension
          ? 'todos'
          : 'con_venta')
  )
  const [clases, setClases] = useState<Set<string>>(
    () =>
      new Set(
        esClase && filtroDimension && ['A', 'B', 'C'].includes(filtroDimension.valor)
          ? [filtroDimension.valor]
          : []
      )
  )
  const [filtroDim, setFiltroDim] = useState(esClase ? null : filtroDimension)
  const [orden, setOrden] = useState<Orden>(ordenInicial ?? 'ingresos')
  const [pagina, setPagina] = useState(0)
  const [porPagina, setPorPagina] = useState<PorPagina>(50)

  const rango = useMemo(() => {
    const r =
      periodo === 'personalizado' && desdeP && hastaP
        ? rangoDesdeFechas(desdeP, hastaP)
        : rangoPredefinido(periodo === 'personalizado' ? 'mes_actual' : periodo)
    return { desde: fechaLocal(r.desde), hasta: fechaLocal(r.hasta) }
  }, [periodo, desdeP, hastaP])

  const { data, isLoading, isError, refetch } = useResumenSkus(
    rango.desde,
    rango.hasta
  )

  const hayCostos = useMemo(
    () => (data ?? []).some((f) => f.margen_pesos != null),
    [data]
  )

  const filtrados = useMemo(() => {
    let lista = data ?? []
    const q = busqueda.trim().toLowerCase()
    if (q) {
      lista = lista.filter(
        (f) =>
          f.nombre.toLowerCase().includes(q) ||
          (f.codigo_barras ?? '').toLowerCase().includes(q) ||
          (f.marca ?? '').toLowerCase().includes(q) ||
          (f.categoria ?? '').toLowerCase().includes(q) ||
          (f.proveedor ?? '').toLowerCase().includes(q) ||
          (f.gondola ?? '').toLowerCase().includes(q)
      )
    }
    if (filtroDim) {
      lista = lista.filter(
        (f) => valorDimension(f, filtroDim.dimension) === filtroDim.valor
      )
    }
    if (clases.size > 0) {
      lista = lista.filter((f) => f.clase_abc != null && clases.has(f.clase_abc))
    }
    switch (vista) {
      case 'con_venta':
        lista = lista.filter((f) => f.unidades_vendidas > 0 || f.unidades_via_combo > 0)
        break
      case 'quiebres':
        lista = lista.filter((f) => f.quiebres_periodo > 0)
        break
      case 'sin_venta':
        lista = lista.filter((f) => f.unidades_vendidas === 0 && f.unidades_via_combo === 0)
        break
      case 'margen_negativo':
        lista = lista.filter((f) => (f.margen_pesos ?? 0) < 0 && f.ingresos > 0)
        break
    }
    const ordenar: Record<Orden, (a: ResumenSku, b: ResumenSku) => number> = {
      ingresos: (a, b) => b.ingresos - a.ingresos,
      margen: (a, b) => (b.margen_pesos ?? 0) - (a.margen_pesos ?? 0),
      unidades: (a, b) => b.unidades_vendidas - a.unidades_vendidas,
      cobertura: (a, b) =>
        (a.dias_cobertura ?? Number.POSITIVE_INFINITY) -
        (b.dias_cobertura ?? Number.POSITIVE_INFINITY),
      perdida: (a, b) => b.venta_perdida_pesos - a.venta_perdida_pesos,
      sin_venta: (a, b) => (b.dias_sin_venta ?? -1) - (a.dias_sin_venta ?? -1),
    }
    return [...lista].sort(ordenar[orden])
  }, [data, busqueda, filtroDim, clases, vista, orden])

  const kpis = useMemo(() => {
    const conVenta = (data ?? []).filter((f) => f.ingresos > 0)
    return {
      ingresos: conVenta.reduce((s, f) => s + f.ingresos, 0),
      margen: hayCostos
        ? conVenta.reduce((s, f) => s + (f.margen_pesos ?? 0), 0)
        : null,
      skusConVenta: conVenta.length,
      quiebres: (data ?? []).reduce((s, f) => s + f.quiebres_periodo, 0),
      perdida: (data ?? []).reduce((s, f) => s + f.venta_perdida_pesos, 0),
      hayEstimados: (data ?? []).some((f) => f.costo_estimado && f.ingresos > 0),
    }
  }, [data, hayCostos])

  const paginados = paginarArreglo(filtrados, pagina, porPagina)

  function exportar(formato: 'excel' | 'pdf') {
    const columnas = [
      { titulo: 'Producto', wch: 34 },
      { titulo: 'ABC', wch: 5 },
      { titulo: 'Marca', wch: 14 },
      { titulo: 'Góndola', wch: 14 },
      { titulo: 'Stock', wch: 8, align: 'right' as const },
      { titulo: 'Vendido', wch: 9, align: 'right' as const },
      { titulo: 'Ingresos', wch: 12, align: 'right' as const },
      ...(hayCostos
        ? [
            { titulo: 'Margen $', wch: 12, align: 'right' as const },
            { titulo: 'Margen %', wch: 9, align: 'right' as const },
          ]
        : []),
      { titulo: 'Cobertura (d)', wch: 11, align: 'right' as const },
      { titulo: 'Quiebres', wch: 8, align: 'right' as const },
      { titulo: 'Perdida est.', wch: 12, align: 'right' as const },
    ]
    const filas = filtrados.map((f) => [
      f.nombre,
      f.clase_abc ?? '',
      f.marca ?? '',
      f.gondola ?? '',
      f.stock_actual,
      f.unidades_vendidas,
      f.ingresos,
      ...(hayCostos ? [f.margen_pesos ?? '', f.margen_pct ?? ''] : []),
      f.dias_cobertura ?? '',
      f.quiebres_periodo,
      f.venta_perdida_pesos,
    ])
    const opciones = {
      titulo: 'Análisis por producto',
      subtitulo: `${rango.desde} a ${rango.hasta} · ${VISTAS[vista]}`,
      archivo: 'analisis-sku',
      columnas,
      filas,
      desde: rango.desde,
      hasta: rango.hasta,
      kpis: [
        { etiqueta: 'Ingresos', valor: `$ ${formatearNumero(Math.round(kpis.ingresos))}` },
        ...(kpis.margen != null
          ? [{ etiqueta: 'Margen', valor: `$ ${formatearNumero(Math.round(kpis.margen))}` }]
          : []),
        { etiqueta: 'SKUs con venta', valor: formatearNumero(kpis.skusConVenta) },
        { etiqueta: 'Quiebres', valor: formatearNumero(kpis.quiebres) },
      ],
    }
    if (formato === 'excel') void exportarTablaExcel(opciones)
    else void exportarTablaPDF(opciones)
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 rounded-xl bg-[#f9d2a2]/30" />
        <Skeleton className="h-96 rounded-2xl bg-[#f9d2a2]/30" />
      </div>
    )
  }
  if (isError) {
    return <EstadoError onReintentar={refetch} />
  }
  if (data === null) {
    return (
      <div className="rounded-2xl border-2 border-[#e4a42a]/50 bg-[#f9b44c]/10 p-6 max-w-xl">
        <h2 className="text-[#391511] font-bold mb-1">
          Falta correr la migración 178
        </h2>
        <p className="text-sm text-[#6f3a2a]">
          El análisis por producto usa fn_resumen_skus
          (178_rpcs_metricas_sku.sql). Corrida la migración, este tab se
          habilita solo.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Período + KPIs */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SelectorPeriodo
          periodo={periodo}
          onCambioPeriodo={(p) => {
            setPeriodo(p)
            setPagina(0)
          }}
          desdePersonalizado={desdeP}
          hastaPersonalizado={hastaP}
          onCambioDesde={setDesdeP}
          onCambioHasta={setHastaP}
        />
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportar('excel')}
            className="gap-1.5 border-[#e4c9b0] text-[#6f3a2a]"
          >
            <Download className="h-3.5 w-3.5" /> Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportar('pdf')}
            className="gap-1.5 border-[#e4c9b0] text-[#6f3a2a]"
          >
            <FileText className="h-3.5 w-3.5" /> PDF
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiChico etiqueta="Ingresos del período">
          <MontoARS monto={kpis.ingresos} />
        </KpiChico>
        {kpis.margen != null && (
          <KpiChico
            etiqueta="Margen comercial"
            extra={
              kpis.hayEstimados ? (
                <AyudaContextual titulo="Parcialmente estimado">
                  Algunas ventas del período no tienen costo congelado
                  (anteriores a la migración del costo por ítem, o productos
                  sin costo cargado): para esas se usa el costo actual.
                </AyudaContextual>
              ) : undefined
            }
          >
            <span className={kpis.margen >= 0 ? 'text-[#2f7d4f]' : 'text-[#c43e2c]'}>
              <MontoARS monto={kpis.margen} />
            </span>
          </KpiChico>
        )}
        <KpiChico etiqueta="SKUs con venta">
          {formatearNumero(kpis.skusConVenta)}
        </KpiChico>
        <KpiChico
          etiqueta="Quiebres · perdida est."
          extra={
            <AyudaContextual titulo="Estimación">
              Venta perdida = venta promedio de los 30 días previos al quiebre
              × días sin stock, a precio de venta. Es una estimación, no un
              dato contable.
            </AyudaContextual>
          }
        >
          {formatearNumero(kpis.quiebres)} ·{' '}
          <MontoARS monto={kpis.perdida} />
        </KpiChico>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#c8a58a]" />
          <Input
            value={busqueda}
            onChange={(e) => {
              setBusqueda(e.target.value)
              setPagina(0)
            }}
            placeholder="Buscar producto, marca, góndola…"
            className="pl-8 w-64 border-[#e4c9b0]"
          />
        </div>
        <select
          value={vista}
          onChange={(e) => {
            setVista(e.target.value as Vista)
            setPagina(0)
          }}
          className="h-9 rounded-lg border border-[#e4c9b0] bg-white px-2 text-sm text-[#391511]"
        >
          {Object.entries(VISTAS).map(([v, e]) => (
            <option key={v} value={v}>
              {e}
            </option>
          ))}
        </select>
        <select
          value={orden}
          onChange={(e) => setOrden(e.target.value as Orden)}
          className="h-9 rounded-lg border border-[#e4c9b0] bg-white px-2 text-sm text-[#391511]"
        >
          {Object.entries(ORDENES).map(([v, e]) => (
            <option key={v} value={v}>
              Ordenar: {e}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          {(['A', 'B', 'C'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setClases((prev) => {
                  const s = new Set(prev)
                  if (s.has(c)) s.delete(c)
                  else s.add(c)
                  return s
                })
                setPagina(0)
              }}
              className={cn(
                'h-8 w-8 rounded-lg border text-xs font-bold',
                clases.has(c)
                  ? 'bg-[#391511] text-white border-[#391511]'
                  : 'border-[#e4c9b0] text-[#6f3a2a] hover:border-[#c8a58a]'
              )}
            >
              {c}
            </button>
          ))}
        </div>
        {filtroDim && (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#391511] px-2.5 py-1 text-xs font-semibold text-white">
            {ETIQUETA_DIMENSION[filtroDim.dimension]}: {filtroDim.valor}
            <button
              type="button"
              onClick={() => {
                setFiltroDim(null)
                setPagina(0)
              }}
              aria-label="Quitar filtro"
              className="rounded hover:bg-white/20"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
        <span className="ml-auto text-xs text-[#6f3a2a] tabular-nums">
          {formatearNumero(filtrados.length)} productos
        </span>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#e4c9b0]/60 bg-[#fdfaf6] text-left text-[10px] uppercase tracking-wider text-[#6f3a2a]">
              <th className="px-3 py-2.5 font-semibold">Producto</th>
              <th className="px-2 py-2.5 font-semibold">ABC</th>
              <th className="px-2 py-2.5 font-semibold">Góndola</th>
              <th className="px-2 py-2.5 font-semibold text-right">Stock</th>
              <th className="px-2 py-2.5 font-semibold text-right">Vendido</th>
              <th className="px-2 py-2.5 font-semibold text-right">Ingresos</th>
              {hayCostos && (
                <th className="px-2 py-2.5 font-semibold text-right">Margen</th>
              )}
              <th className="px-2 py-2.5 font-semibold text-right">Cobert.</th>
              <th className="px-2 py-2.5 font-semibold text-right">Últ. venta</th>
              <th className="px-2 py-2.5 font-semibold text-right">Quiebres</th>
            </tr>
          </thead>
          <tbody>
            {paginados.length === 0 ? (
              <tr>
                <td
                  colSpan={hayCostos ? 10 : 9}
                  className="px-3 py-10 text-center text-sm text-[#c8a58a]"
                >
                  Sin resultados con estos filtros.
                </td>
              </tr>
            ) : (
              paginados.map((f) => (
                <tr
                  key={f.producto_id}
                  className="border-b border-[#e4c9b0]/40 last:border-0 hover:bg-[#fdfaf6]"
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/inventario/${f.producto_id}`}
                      className="font-medium text-[#391511] hover:underline"
                    >
                      {f.nombre}
                    </Link>
                    <div className="text-[11px] text-[#c8a58a] truncate max-w-64">
                      {[f.marca, f.categoria].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    {f.clase_abc && (
                      <span
                        className={cn(
                          'inline-flex h-5 w-5 items-center justify-center rounded-md text-[11px] font-bold',
                          CLASE_COLOR[f.clase_abc]
                        )}
                      >
                        {f.clase_abc}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs text-[#6f3a2a] max-w-28 truncate">
                    {f.gondola ?? '—'}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatearCantidad(f.stock_actual, f.venta_por_peso)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatearCantidad(f.unidades_vendidas, f.venta_por_peso)}
                    {f.unidades_via_combo > 0 && (
                      <span className="text-[10px] text-[#c8a58a]">
                        {' '}
                        +{formatearCantidad(f.unidades_via_combo, f.venta_por_peso)} combo
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    <MontoARS monto={f.ingresos} />
                  </td>
                  {hayCostos && (
                    <td
                      className={cn(
                        'px-2 py-2 text-right tabular-nums',
                        (f.margen_pesos ?? 0) < 0 && 'text-[#c43e2c] font-semibold'
                      )}
                    >
                      {f.margen_pesos != null ? (
                        <>
                          <MontoARS monto={f.margen_pesos} />
                          {f.margen_pct != null && (
                            <span className="text-[10px] text-[#c8a58a]">
                              {' '}
                              {f.margen_pct.toFixed(1)}%
                            </span>
                          )}
                          {f.costo_estimado && (
                            <span
                              className="ml-0.5 text-[10px] text-[#a06b00]"
                              title="Costo parcialmente estimado"
                            >
                              *
                            </span>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  )}
                  <td
                    className={cn(
                      'px-2 py-2 text-right tabular-nums',
                      f.dias_cobertura != null && f.dias_cobertura < 3 && 'text-[#c43e2c] font-semibold'
                    )}
                  >
                    {f.dias_cobertura != null ? `${formatearNumero(f.dias_cobertura)} d` : '—'}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-xs text-[#6f3a2a]">
                    {f.dias_sin_venta != null
                      ? f.dias_sin_venta === 0
                        ? 'hoy'
                        : `hace ${formatearNumero(f.dias_sin_venta)} d`
                      : '—'}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {f.quiebres_periodo > 0 ? (
                      <span className="text-[#9e2f25] font-semibold">
                        {f.quiebres_periodo}
                        {f.venta_perdida_pesos > 0 && (
                          <span className="block text-[10px] font-normal">
                            ~<MontoARS monto={f.venta_perdida_pesos} />
                          </span>
                        )}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaginadorTabla
        total={filtrados.length}
        pagina={pagina}
        porPagina={porPagina}
        onCambioPagina={setPagina}
        onCambioPorPagina={(n) => {
          setPorPagina(n)
          setPagina(0)
        }}
      />
    </div>
  )
}

function KpiChico({
  etiqueta,
  children,
  extra,
}: {
  etiqueta: string
  children: React.ReactNode
  extra?: React.ReactNode
}) {
  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-3.5">
      <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold flex items-center gap-1">
        {etiqueta}
        {extra}
      </div>
      <div className="text-xl font-extrabold text-[#391511] tabular-nums leading-tight mt-0.5">
        {children}
      </div>
    </div>
  )
}
