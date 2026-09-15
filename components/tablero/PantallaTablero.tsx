'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Lightbulb,
  Map as MapIcon,
  Receipt,
  Timer,
  TrendingUp,
  Trophy,
  Warehouse,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { EstadoError } from '@/components/shared/EstadoError'
import { AyudaContextual } from '@/components/shared/AyudaContextual'
import { CardKPI, Variacion } from '@/components/shared/CardKPI'
import { SelectorPeriodo } from '@/components/reportes/SelectorPeriodo'
import { cn } from '@/lib/utils'
import {
  formatearFechaCortaISO,
  formatearMontoEntero,
  formatearNumero,
} from '@/lib/utils/formato'
import {
  fechaLocal,
  isoMasDias,
  rangoDesdeFechas,
  rangoPredefinido,
  type ClavePeriodo,
} from '@/lib/utils/periodos'
import { useTableroGerencial } from '@/lib/hooks/useTablero'
import type {
  CategoriaCantidad,
  GondolaTablero,
  TableroGerencial,
} from '@/lib/queries/tablero'
import { GraficoVentasMargen } from './GraficoVentasMargen'
import { TablaDimensiones } from './TablaDimensiones'

const formatoUnDecimal = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

type Severidad = 'critico' | 'atencion' | 'oportunidad'

interface Situacion {
  severidad: Severidad
  texto: string
  detalle?: string
  accion: string
  href: string
}

const COLOR_SEVERIDAD: Record<Severidad, string> = {
  critico: 'bg-[#c43e2c]',
  atencion: 'bg-[#e4a42a]',
  oportunidad: 'bg-[#1e5fb0]',
}

function conCantidad(n: number, uno: string, varios: string): string {
  return `${formatearNumero(n)} ${n === 1 ? uno : varios}`
}

function detalleCategorias(lista: CategoriaCantidad[]): string | undefined {
  if (lista.length === 0) return undefined
  return lista.map((c) => `${c.categoria} ${formatearNumero(c.cantidad)}`).join(' · ')
}

/**
 * DATO → DIAGNÓSTICO → ACCIÓN. Solo situaciones que piden intervención,
 * agrupadas (nunca una fila por producto) y con el lugar donde se actúa.
 * El motor de alertas configurable (Fase F) reemplaza estas reglas fijas.
 */
function armarSituaciones(t: TableroGerencial, paramsPeriodo: string): Situacion[] {
  const s = t.situaciones
  const lista: Situacion[] = []

  if (s.criticos_sin_stock.cantidad > 0) {
    lista.push({
      severidad: 'critico',
      texto: `${conCantidad(s.criticos_sin_stock.cantidad, 'producto clave está', 'productos clave están')} sin stock`,
      detalle: detalleCategorias(s.criticos_sin_stock.por_categoria),
      accion: 'Reponer',
      href: '/compras',
    })
  }
  if (s.a_por_quebrar.cantidad > 0) {
    lista.push({
      severidad: 'atencion',
      texto: `${conCantidad(s.a_por_quebrar.cantidad, 'producto de los que más venden se queda', 'productos de los que más venden se quedan')} sin stock en menos de 3 días`,
      detalle: detalleCategorias(s.a_por_quebrar.por_categoria),
      accion: 'Ver compras',
      href: '/compras',
    })
  }
  if (t.lotes_por_vencer > 0) {
    lista.push({
      severidad: 'atencion',
      texto: `${conCantidad(t.lotes_por_vencer, 'lote vencido o por vencer', 'lotes vencidos o por vencer')} en los próximos 7 días`,
      accion: 'Revisar',
      href: '/vencimientos',
    })
  }
  const negativos = s.margen_negativo.cantidad
  if (negativos != null && negativos > 0) {
    lista.push({
      severidad: 'atencion',
      texto: `${conCantidad(negativos, 'producto se vendió', 'productos se vendieron')} por debajo del costo`,
      accion: 'Ver productos',
      href: `/inventario?tab=analisis&vista=margen_negativo&${paramsPeriodo}`,
    })
  }
  const inmovilizado = t.inventario.inmovilizado ?? 0
  if (inmovilizado > 0 && t.inventario.skus_inmovilizados > 0) {
    lista.push({
      severidad: 'oportunidad',
      texto: `${formatearMontoEntero(inmovilizado)} inmovilizados en ${conCantidad(t.inventario.skus_inmovilizados, 'producto', 'productos')} sin vender hace más de 45 días`,
      accion: 'Ver productos',
      href: `/inventario?tab=analisis&vista=sin_venta&orden=sin_venta&${paramsPeriodo}`,
    })
  }
  return lista
}

export function PantallaTablero() {
  const [periodo, setPeriodo] = useState<ClavePeriodo>('mes_actual')
  const [desdeP, setDesdeP] = useState('')
  const [hastaP, setHastaP] = useState('')

  const personalizadoCompleto = periodo === 'personalizado' && !!desdeP && !!hastaP

  const rango = useMemo(() => {
    const r = personalizadoCompleto
      ? rangoDesdeFechas(desdeP, hastaP)
      : rangoPredefinido(periodo === 'personalizado' ? 'mes_actual' : periodo)
    return { desde: fechaLocal(r.desde), hasta: fechaLocal(r.hasta) }
  }, [periodo, desdeP, hastaP, personalizadoCompleto])

  const paramsPeriodo = personalizadoCompleto
    ? `periodo=personalizado&desde=${desdeP}&hasta=${hastaP}`
    : `periodo=${periodo === 'personalizado' ? 'mes_actual' : periodo}`

  const { data, isLoading, isError, error, refetch } = useTableroGerencial(
    rango.desde,
    rango.hasta
  )

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#391511]">Tablero del dueño</h1>
          <p className="mt-1 text-sm text-[#6f3a2a]">
            Cómo viene el negocio y qué requiere tu atención.
          </p>
        </div>
        <SelectorPeriodo
          periodo={periodo}
          onCambioPeriodo={setPeriodo}
          desdePersonalizado={desdeP}
          hastaPersonalizado={hastaP}
          onCambioDesde={setDesdeP}
          onCambioHasta={setHastaP}
        />
      </header>

      {isLoading ? (
        <EsqueletoTablero />
      ) : isError ? (
        <EstadoError
          mensaje={
            error?.message?.includes('permiso')
              ? error.message
              : 'No pudimos cargar el tablero. Revisá tu conexión e intentá de nuevo.'
          }
          onReintentar={refetch}
        />
      ) : data === null || data === undefined ? (
        <div className="max-w-xl rounded-2xl border-2 border-[#e4a42a]/50 bg-[#f9b44c]/10 p-6">
          <h2 className="mb-1 font-bold text-[#391511]">
            Faltan correr las migraciones 179 a 182
          </h2>
          <p className="text-sm text-[#6f3a2a]">
            El tablero usa fn_tablero_gerencial. Corridas las migraciones, esta pantalla se
            habilita sola.
          </p>
        </div>
      ) : (
        <CuerpoTablero datos={data} paramsPeriodo={paramsPeriodo} />
      )}
    </div>
  )
}

function CuerpoTablero({
  datos,
  paramsPeriodo,
}: {
  datos: TableroGerencial
  paramsPeriodo: string
}) {
  const v = datos.ventas
  const m = datos.margen
  const costos = datos.puede_ver_costos
  const situaciones = armarSituaciones(datos, paramsPeriodo)
  const urgentes = situaciones.filter((s) => s.severidad !== 'oportunidad').slice(0, 5)
  const oportunidades = situaciones.filter((s) => s.severidad === 'oportunidad')
  const snapshotAtrasado =
    datos.ultimo_snapshot == null || datos.ultimo_snapshot < isoMasDias(datos.hoy, -1)
  const anterior = `${formatearFechaCortaISO(datos.periodo.anterior_desde)} – ${formatearFechaCortaISO(datos.periodo.anterior_hasta)}`

  return (
    <>
      {snapshotAtrasado && (
        <p className="flex items-center gap-2 rounded-xl border border-[#e4a42a]/50 bg-[#f9b44c]/10 px-3 py-2 text-xs text-[#6f3a2a]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#e4a42a]" />
          {datos.ultimo_snapshot
            ? `El resumen diario no corre desde el ${formatearFechaCortaISO(datos.ultimo_snapshot)}. Los números de acá están al día; lo que se atrasa es la historia de la ficha de cada producto.`
            : 'El resumen diario todavía no corrió nunca: la historia de la ficha de cada producto va a estar vacía.'}
        </p>
      )}

      {/* Ventas: hoy / ayer / 7 días / mes, cada una con su comparación */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CeldaVenta
          etiqueta="Hoy"
          monto={v.hoy}
          pie={
            <span className="text-[#6f3a2a]">
              {conCantidad(v.hoy_tickets, 'ticket', 'tickets')} · en curso
            </span>
          }
        />
        <CeldaVenta
          etiqueta="Ayer"
          monto={v.ayer}
          pie={
            <Variacion
              actual={v.ayer}
              anterior={v.ayer_semana_anterior}
              texto="vs mismo día semana pasada"
            />
          }
        />
        <CeldaVenta
          etiqueta="Últimos 7 días"
          monto={v.semana}
          pie={
            <Variacion actual={v.semana} anterior={v.semana_anterior} texto="vs 7 días previos" />
          }
        />
        <CeldaVenta
          etiqueta="Mes en curso"
          monto={v.mes}
          pie={
            <Variacion
              actual={v.mes}
              anterior={v.mes_anterior_mismo_tramo}
              texto="vs mismo tramo mes pasado"
            />
          }
        />
      </section>

      {/* KPIs del período elegido */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CardKPI
          icono={Receipt}
          etiqueta="Ventas del período"
          valor={formatearMontoEntero(v.periodo)}
          detalle={`${conCantidad(v.periodo_tickets, 'ticket', 'tickets')} · ticket promedio ${formatearMontoEntero(v.ticket_promedio)}`}
          pie={
            <Variacion
              actual={v.periodo}
              anterior={v.periodo_anterior}
              texto={`vs ${anterior}`}
            />
          }
        />
        <CardKPI
          icono={CircleDollarSign}
          etiqueta="Margen comercial"
          destacado
          ayuda={
            <AyudaContextual titulo="Qué es el margen comercial">
              Lo que vendiste menos lo que te costó la mercadería vendida. No descuenta
              gastos del local (alquiler, sueldos, servicios): no es la ganancia final.
              {m.estimado &&
                ' Parte del período usa el costo actual, porque esas ventas son anteriores al registro del costo en cada venta.'}
            </AyudaContextual>
          }
          valor={
            costos && m.margen != null ? (
              <span className={m.margen >= 0 ? 'text-[#2f7d4f]' : 'text-[#c43e2c]'}>
                {formatearMontoEntero(m.margen)}
                {m.margen_pct != null && (
                  <span className="text-base font-bold text-[#6f3a2a]">
                    {' '}
                    · {formatoUnDecimal.format(m.margen_pct)}%
                  </span>
                )}
              </span>
            ) : (
              <span className="text-base text-[#c8a58a]">Sin permiso para ver costos</span>
            )
          }
          detalle={costos && m.estimado ? '* parcialmente estimado' : undefined}
          pie={
            costos ? (
              <Variacion
                modo="puntos"
                actual={m.margen_pct}
                anterior={m.anterior_margen_pct}
                texto={`vs ${anterior}`}
              />
            ) : undefined
          }
        />
        <CardKPI
          icono={Warehouse}
          etiqueta="Inventario a costo"
          valor={
            datos.inventario.valorizado != null
              ? formatearMontoEntero(datos.inventario.valorizado)
              : '—'
          }
          detalle={
            datos.inventario.dias_inventario != null
              ? `${formatearNumero(datos.inventario.dias_inventario)} días de inventario`
              : undefined
          }
          pie={
            datos.inventario.inmovilizado != null ? (
              <span className="text-[#6f3a2a]">
                Inmovilizado +45 días:{' '}
                <strong className="text-[#391511]">
                  {formatearMontoEntero(datos.inventario.inmovilizado)}
                </strong>{' '}
                ({conCantidad(datos.inventario.skus_inmovilizados, 'producto', 'productos')})
              </span>
            ) : undefined
          }
        />
        <CardKPI
          icono={Timer}
          etiqueta="Quiebres de stock"
          ayuda={
            <AyudaContextual titulo="Cómo se estima la venta perdida">
              Venta promedio de los 30 días previos a cada quiebre × días sin stock dentro
              del período × precio de venta. Es una estimación, no un dato contable.
            </AyudaContextual>
          }
          valor={
            <span className={datos.quiebres.activos > 0 ? 'text-[#c43e2c]' : 'text-[#2f7d4f]'}>
              {formatearNumero(datos.quiebres.activos)}
              <span className="text-base font-bold text-[#6f3a2a]"> activos ahora</span>
            </span>
          }
          detalle={`${conCantidad(datos.quiebres.criticos_activos, 'crítico', 'críticos')} (top ventas o que no pueden faltar)`}
          pie={
            <span className="text-[#6f3a2a]">
              En el período: {formatearNumero(Math.round(datos.quiebres.horas_periodo))} h sin
              stock · venta perdida est.{' '}
              <strong className="text-[#9e2f25]">
                ~{formatearMontoEntero(datos.quiebres.perdida_periodo)}
              </strong>
            </span>
          }
        />
      </section>

      {/* Requiere intervención */}
      <section className="overflow-hidden rounded-2xl border border-[#e4c9b0]/60 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] px-4 py-2.5">
          <AlertTriangle className="h-4 w-4 text-[#f9b44c]" />
          <h2 className="text-sm font-semibold text-[#391511]">Requiere intervención</h2>
          <span className="text-xs text-[#c8a58a]">· solo lo que pide una acción</span>
        </div>
        {urgentes.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-4 text-sm text-[#2f7d4f]">
            <CheckCircle2 className="h-4 w-4" />
            Todo en orden: no hay nada urgente para resolver.
          </div>
        ) : (
          <ul className="divide-y divide-[#e4c9b0]/40">
            {urgentes.map((s) => (
              <FilaSituacion key={s.texto} situacion={s} />
            ))}
          </ul>
        )}
        {oportunidades.length > 0 && (
          <div className="border-t border-[#e4c9b0]/60 bg-[#1e5fb0]/[0.03]">
            <div className="flex items-center gap-1.5 px-4 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[#1e5fb0]">
              <Lightbulb className="h-3.5 w-3.5" />
              Oportunidades
            </div>
            <ul className="divide-y divide-[#e4c9b0]/40">
              {oportunidades.map((s) => (
                <FilaSituacion key={s.texto} situacion={s} />
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Evolución + concentración */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-4 shadow-sm lg:col-span-2">
          <div className="mb-2 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[#f9b44c]" />
            <h2 className="text-sm font-semibold text-[#391511]">
              {costos ? 'Ventas y margen' : 'Ventas'}
            </h2>
          </div>
          <GraficoVentasMargen serie={datos.serie} puedeVerCostos={costos} />
        </section>
        <PanelTopSkus datos={datos} />
      </div>

      <PanelGondolas datos={datos} paramsPeriodo={paramsPeriodo} />

      <TablaDimensiones
        desde={datos.periodo.desde}
        hasta={datos.periodo.hasta}
        paramsPeriodo={paramsPeriodo}
        puedeVerCostos={costos}
      />
    </>
  )
}

function CeldaVenta({
  etiqueta,
  monto,
  pie,
}: {
  etiqueta: string
  monto: number
  pie: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-3.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6f3a2a]">
        {etiqueta}
      </div>
      <div className="text-xl font-extrabold leading-tight tabular-nums text-[#391511]">
        {formatearMontoEntero(monto)}
      </div>
      <div className="mt-0.5 text-[11px]">{pie}</div>
    </div>
  )
}

function FilaSituacion({ situacion: s }: { situacion: Situacion }) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', COLOR_SEVERIDAD[s.severidad])}
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#391511]">{s.texto}</p>
          {s.detalle && <p className="truncate text-xs text-[#6f3a2a]">{s.detalle}</p>}
        </div>
      </div>
      <Link
        href={s.href}
        className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#9e6b15] hover:text-[#391511] hover:underline"
      >
        {s.accion}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </li>
  )
}

function PanelTopSkus({ datos }: { datos: TableroGerencial }) {
  const porMargen = datos.concentracion.criterio === 'margen'
  const top = datos.top_skus
  const maximo = Math.max(1, ...top.map((s) => s.valor))

  return (
    <section className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <Trophy className="h-4 w-4 text-[#f9b44c]" />
        <h2 className="text-sm font-semibold text-[#391511]">
          Qué explica tu {porMargen ? 'margen' : 'venta'}
        </h2>
      </div>
      {top.length === 0 ? (
        <p className="py-6 text-center text-sm text-[#c8a58a]">Sin ventas en el período.</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-[#391511]">
            <strong>{formatearNumero(datos.concentracion.skus_80)}</strong> de{' '}
            {formatearNumero(datos.concentracion.skus_total)} productos explican el 80%{' '}
            {porMargen ? 'del margen' : 'de las ventas'}.
          </p>
          <ol className="space-y-2">
            {top.map((s, i) => (
              <li key={s.producto_id}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <Link
                    href={`/inventario/${s.producto_id}`}
                    className="truncate text-[#391511] hover:underline"
                  >
                    {i + 1}. {s.nombre}
                  </Link>
                  <span className="shrink-0 font-semibold tabular-nums text-[#391511]">
                    {formatearMontoEntero(s.valor)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#f9d2a2]/40">
                  <div
                    className="h-full rounded-full bg-[#f9b44c]"
                    style={{ width: `${Math.max(3, (s.valor / maximo) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  )
}

function PanelGondolas({
  datos,
  paramsPeriodo,
}: {
  datos: TableroGerencial
  paramsPeriodo: string
}) {
  const costos = datos.puede_ver_costos
  const gondolas = datos.gondolas
  const pctMapeo =
    datos.mapeo.productos_activos > 0
      ? Math.round((datos.mapeo.ubicados / datos.mapeo.productos_activos) * 100)
      : 0
  const valor = (g: GondolaTablero) => (costos ? (g.margen ?? 0) : g.ingresos)
  const maximo = Math.max(1, ...gondolas.map((g) => Math.abs(valor(g))))
  const mejores = gondolas.slice(0, 5)
  const paraRevisar =
    gondolas.length > 5 ? gondolas.slice(Math.max(5, gondolas.length - 5)).reverse() : []

  return (
    <section className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <MapIcon className="h-4 w-4 text-[#f9b44c]" />
        <h2 className="text-sm font-semibold text-[#391511]">
          Góndolas por {costos ? 'margen' : 'ventas'}
        </h2>
        <span className="text-xs text-[#6f3a2a]">
          · {pctMapeo}% de los productos ubicados
        </span>
        <Link
          href="/mapa"
          className="ml-auto text-xs text-[#6f3a2a] underline underline-offset-2 hover:text-[#391511]"
        >
          Mapa del local
        </Link>
      </div>

      {gondolas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#e4c9b0] p-5 text-center">
          <p className="text-sm text-[#391511]">
            Ubicá tus productos en góndolas para ver cuál rinde más.
          </p>
          <p className="mt-1 text-xs text-[#6f3a2a]">
            Se completa sola contando por zonas o escaneando desde el celular.
          </p>
          <Link
            href="/mapa"
            className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#9e6b15] hover:underline"
          >
            Ir al mapa <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <>
          {pctMapeo < 60 && (
            <p className="mb-3 text-[11px] text-[#a06b00]">
              Ojo: este análisis cubre solo el {pctMapeo}% del catálogo. Cuantos más productos
              ubiques, más fiel es la comparación.
            </p>
          )}
          <div className={cn('grid gap-6', paraRevisar.length > 0 && 'md:grid-cols-2')}>
            <ListaGondolas
              titulo={paraRevisar.length > 0 ? 'Las que más rinden' : undefined}
              gondolas={mejores}
              maximo={maximo}
              costos={costos}
              paramsPeriodo={paramsPeriodo}
            />
            {paraRevisar.length > 0 && (
              <ListaGondolas
                titulo="Para revisar"
                gondolas={paraRevisar}
                maximo={maximo}
                costos={costos}
                paramsPeriodo={paramsPeriodo}
              />
            )}
          </div>
        </>
      )}
    </section>
  )
}

function ListaGondolas({
  titulo,
  gondolas,
  maximo,
  costos,
  paramsPeriodo,
}: {
  titulo?: string
  gondolas: GondolaTablero[]
  maximo: number
  costos: boolean
  paramsPeriodo: string
}) {
  return (
    <div>
      {titulo && (
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#c8a58a]">
          {titulo}
        </p>
      )}
      <ul className="space-y-2.5">
        {gondolas.map((g) => {
          const monto = costos ? (g.margen ?? 0) : g.ingresos
          return (
            <li key={g.nombre}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <Link
                  href={`/inventario?tab=analisis&dim=gondola&valor=${encodeURIComponent(g.nombre)}&${paramsPeriodo}`}
                  className="truncate font-medium text-[#391511] hover:underline"
                >
                  {g.nombre}
                </Link>
                <span
                  className={cn(
                    'shrink-0 font-semibold tabular-nums',
                    monto < 0 ? 'text-[#c43e2c]' : 'text-[#391511]'
                  )}
                >
                  {formatearMontoEntero(monto)}
                  {costos && g.margen_pct != null && (
                    <span className="text-[11px] font-normal text-[#6f3a2a]">
                      {' '}
                      · {formatoUnDecimal.format(g.margen_pct)}%
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#f9d2a2]/40">
                <div
                  className={cn(
                    'h-full rounded-full',
                    monto < 0 ? 'bg-[#c43e2c]' : 'bg-[#f9b44c]'
                  )}
                  style={{ width: `${Math.max(3, (Math.abs(monto) / maximo) * 100)}%` }}
                />
              </div>
              <div className="mt-0.5 text-[11px] text-[#6f3a2a]">
                {conCantidad(g.skus, 'producto', 'productos')}
                {g.quiebres > 0 && (
                  <span className="text-[#9e2f25]">
                    {' '}
                    · {conCantidad(g.quiebres, 'quiebre', 'quiebres')}
                  </span>
                )}
                {g.sin_movimiento > 0 && <> · {formatearNumero(g.sin_movimiento)} sin vender</>}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function EsqueletoTablero() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 rounded-2xl bg-[#f9d2a2]/30" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-2xl bg-[#f9d2a2]/30" />
        ))}
      </div>
      <Skeleton className="h-28 rounded-2xl bg-[#f9d2a2]/30" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-2xl bg-[#f9d2a2]/30 lg:col-span-2" />
        <Skeleton className="h-72 rounded-2xl bg-[#f9d2a2]/30" />
      </div>
    </div>
  )
}
