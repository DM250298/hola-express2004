'use client'

import { useMemo, useState } from 'react'
import { Scale, TrendingUp, Users } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Label } from '@/components/ui/label'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { MontoARS } from '@/components/shared/MontoARS'
import { Semaforo } from '@/components/shared/Semaforo'
import { SelectorPeriodo } from '@/components/reportes/SelectorPeriodo'
import {
  useDesfasajes,
  useOrdenes,
  useProductosProduccion,
} from '@/lib/hooks/useProduccion'
import { useUsuariosActivos } from '@/lib/hooks/useConteos'
import {
  rangoDesdeFechas,
  rangoPredefinido,
  type ClavePeriodo,
} from '@/lib/utils/periodos'

const UMBRAL_MARGEN = 30
const SIN_ASIGNAR = '__sin__'
const TODOS = 'todos'

const MOTIVO_LABEL: Record<string, string> = {
  desperdicio: 'Desperdicio',
  se_quemo: 'Se quemó',
  mal_porcionado: 'Mal porcionado',
  error_carga: 'Error de carga',
  otro: 'Otro',
}

export function TabAnalisis() {
  const { data: productos, isLoading } = useProductosProduccion([
    'semi_elaborado',
    'elaborado',
  ])
  const { data: cerradas } = useOrdenes({ estado: 'cerrada' })

  // ── Filtros del reporte de desfasajes ──────────────────────────────────────
  const [periodo, setPeriodo] = useState<ClavePeriodo>('mes_actual')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [empleado, setEmpleado] = useState<string>(TODOS)

  const rango = useMemo(() => {
    if (periodo === 'personalizado' && desde && hasta) {
      return rangoDesdeFechas(desde, hasta)
    }
    return rangoPredefinido(periodo)
  }, [periodo, desde, hasta])

  const { data: desfasajes } = useDesfasajes(rango)
  const { data: usuarios } = useUsuariosActivos()

  const nombrePorId = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of usuarios ?? []) m.set(u.id, u.nombre)
    return m
  }, [usuarios])

  const lineas = useMemo(() => desfasajes ?? [], [desfasajes])

  // Agregado por empleado (todo el período, para comparar entre empleados).
  const porEmpleado = useMemo(() => {
    const m = new Map<
      string,
      {
        id: string
        nombre: string
        ordenes: Set<number>
        items: number
        neto: number
        abs: number
      }
    >()
    for (const d of lineas) {
      const id = d.responsable_id ?? SIN_ASIGNAR
      if (!m.has(id)) {
        m.set(id, {
          id,
          nombre:
            id === SIN_ASIGNAR
              ? 'Sin asignar'
              : nombrePorId.get(id) ?? 'Usuario',
          ordenes: new Set(),
          items: 0,
          neto: 0,
          abs: 0,
        })
      }
      const g = m.get(id)!
      g.ordenes.add(d.orden_id)
      g.items += 1
      g.neto += d.diferencia_costo
      g.abs += Math.abs(d.diferencia_costo)
    }
    return [...m.values()].sort((a, b) => b.abs - a.abs)
  }, [lineas, nombrePorId])

  // Detalle filtrado por el empleado elegido.
  const detalle = useMemo(
    () =>
      empleado === TODOS
        ? lineas
        : lineas.filter((d) => (d.responsable_id ?? SIN_ASIGNAR) === empleado),
    [lineas, empleado]
  )

  // KPIs sobre el detalle (período + empleado elegido).
  const resumen = useMemo(() => {
    const neto = detalle.reduce((a, d) => a + d.diferencia_costo, 0)
    const abs = detalle.reduce((a, d) => a + Math.abs(d.diferencia_costo), 0)
    const ordenes = new Set(detalle.map((d) => d.orden_id)).size
    return { neto, abs, ordenes, items: detalle.length }
  }, [detalle])

  return (
    <div className="space-y-6">
      {/* Márgenes */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[#391511] flex items-center gap-1.5">
          <TrendingUp className="h-4 w-4 text-[#f9b44c]" />
          Margen de elaborados
        </h2>
        <div className="rounded-xl border border-[#e4c9b0]/60 bg-white overflow-hidden">
          {isLoading ? (
            <div className="p-4">
              <SkeletonTabla filas={4} columnas={5} />
            </div>
          ) : !productos || productos.length === 0 ? (
            <div className="p-8 text-center text-[#6f3a2a] text-sm">
              No hay productos elaborados todavía.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-[#e4c9b0]/40">
                  <TableHead className="text-[#6f3a2a]">Producto</TableHead>
                  <TableHead className="text-[#6f3a2a] text-right">Costo</TableHead>
                  <TableHead className="text-[#6f3a2a] text-right">Precio</TableHead>
                  <TableHead className="text-[#6f3a2a] text-right">Margen</TableHead>
                  <TableHead className="text-[#6f3a2a] text-right">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productos.map((p) => {
                  const margen = p.precio_venta - p.precio_costo
                  const margenPct =
                    p.precio_venta > 0 ? (margen / p.precio_venta) * 100 : 0
                  const bajo = p.precio_venta > 0 && margenPct < UMBRAL_MARGEN
                  return (
                    <TableRow key={p.id} className="border-[#e4c9b0]/30">
                      <TableCell className="font-medium text-[#391511]">
                        {p.nombre}
                        {p.tipo === 'semi_elaborado' && (
                          <span className="ml-1.5 text-[10px] text-[#c8a58a]">
                            (intermedia)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <MontoARS monto={p.precio_costo} className="text-[#6f3a2a]" />
                      </TableCell>
                      <TableCell className="text-right">
                        <MontoARS monto={p.precio_venta} className="text-[#391511]" />
                      </TableCell>
                      <TableCell className="text-right">
                        <MontoARS monto={margen} className="text-[#391511]" />
                      </TableCell>
                      <TableCell className="text-right">
                        {p.precio_venta > 0 ? (
                          bajo ? (
                            <Semaforo
                              clase="rojo"
                              etiqueta={`${margenPct.toFixed(0)}%`}
                            />
                          ) : (
                            <span className="font-semibold text-[#2f8f4e]">
                              {margenPct.toFixed(0)}%
                            </span>
                          )
                        ) : (
                          <span className="text-[#c8a58a]">s/precio</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      {/* Historial de producción */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[#391511]">
          Últimas producciones
        </h2>
        <div className="rounded-xl border border-[#e4c9b0]/60 bg-white overflow-hidden">
          {!cerradas || cerradas.length === 0 ? (
            <div className="p-8 text-center text-[#6f3a2a] text-sm">
              Todavía no se cerró ninguna orden.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-[#e4c9b0]/40">
                  <TableHead className="text-[#6f3a2a]">Producto</TableHead>
                  <TableHead className="text-[#6f3a2a] text-right">Plan.</TableHead>
                  <TableHead className="text-[#6f3a2a] text-right">Prod.</TableHead>
                  <TableHead className="text-[#6f3a2a] text-right">Merma</TableHead>
                  <TableHead className="text-[#6f3a2a] text-right">Costo total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cerradas.slice(0, 15).map((o) => {
                  const merma =
                    o.cantidad_producida != null
                      ? o.cantidad_planificada - o.cantidad_producida
                      : 0
                  return (
                    <TableRow key={o.id} className="border-[#e4c9b0]/30">
                      <TableCell className="font-medium text-[#391511]">
                        {o.producto?.nombre ?? '—'}
                      </TableCell>
                      <TableCell className="text-right text-[#6f3a2a] tabular-nums">
                        {o.cantidad_planificada}
                      </TableCell>
                      <TableCell className="text-right text-[#6f3a2a] tabular-nums">
                        {o.cantidad_producida ?? '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {merma > 0 ? (
                          <span className="text-[#c45e14] font-medium">{merma}</span>
                        ) : (
                          <span className="text-[#c8a58a]">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <MontoARS monto={o.costo_total} className="text-[#391511]" />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      {/* Desfasajes de insumos (real vs receta) — por empleado y período */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-[#391511] flex items-center gap-1.5">
            <Scale className="h-4 w-4 text-[#f9b44c]" />
            Desfasajes de insumos (real vs receta)
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            <SelectorPeriodo
              periodo={periodo}
              onCambioPeriodo={setPeriodo}
              desdePersonalizado={desde}
              hastaPersonalizado={hasta}
              onCambioDesde={setDesde}
              onCambioHasta={setHasta}
            />
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Empleado
              </Label>
              <select
                value={empleado}
                onChange={(e) => setEmpleado(e.target.value)}
                className="h-9 rounded-md border border-[#e4c9b0] bg-white px-2 text-sm text-[#391511] focus:outline-none focus:ring-2 focus:ring-[#f9b44c]"
              >
                <option value={TODOS}>Todos</option>
                {porEmpleado.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.nombre}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* KPIs del período (con el empleado elegido) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiDesfasaje
            etiqueta="Impacto neto"
            valor={<MontoARS monto={resumen.neto} />}
            ayuda="Sobre-consumo (+) menos ahorro (−)"
            acento={resumen.neto > 0 ? 'rojo' : 'verde'}
          />
          <KpiDesfasaje
            etiqueta="Impacto total"
            valor={<MontoARS monto={resumen.abs} />}
            ayuda="Suma de desvíos en valor absoluto"
          />
          <KpiDesfasaje
            etiqueta="Órdenes"
            valor={<span>{resumen.ordenes}</span>}
            ayuda="Con al menos un desfasaje"
          />
          <KpiDesfasaje
            etiqueta="Ítems"
            valor={<span>{resumen.items}</span>}
            ayuda="Líneas de insumo desfasadas"
          />
        </div>

        {/* Atribución por empleado */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-[#6f3a2a] flex items-center gap-1.5 uppercase tracking-wide">
            <Users className="h-3.5 w-3.5 text-[#f9b44c]" />
            Por empleado
          </h3>
          <div className="rounded-xl border border-[#e4c9b0]/60 bg-white overflow-hidden">
            {porEmpleado.length === 0 ? (
              <div className="p-6 text-center text-[#6f3a2a] text-sm">
                Sin desfasajes en el período elegido.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-[#e4c9b0]/40">
                    <TableHead className="text-[#6f3a2a]">Empleado</TableHead>
                    <TableHead className="text-[#6f3a2a] text-right">Órdenes</TableHead>
                    <TableHead className="text-[#6f3a2a] text-right">Ítems</TableHead>
                    <TableHead className="text-[#6f3a2a] text-right">Neto</TableHead>
                    <TableHead className="text-[#6f3a2a] text-right">Impacto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porEmpleado.map((g) => (
                    <TableRow
                      key={g.id}
                      className="border-[#e4c9b0]/30 cursor-pointer hover:bg-[#fdfaf6]"
                      onClick={() =>
                        setEmpleado((prev) => (prev === g.id ? TODOS : g.id))
                      }
                    >
                      <TableCell className="font-medium text-[#391511]">
                        {g.nombre}
                        {empleado === g.id && (
                          <span className="ml-1.5 text-[10px] text-[#b07d1e]">
                            (filtrando)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-[#6f3a2a] tabular-nums">
                        {g.ordenes.size}
                      </TableCell>
                      <TableCell className="text-right text-[#6f3a2a] tabular-nums">
                        {g.items}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            g.neto > 0
                              ? 'text-[#c45e14] font-semibold'
                              : 'text-[#2f8f4e] font-semibold'
                          }
                        >
                          {g.neto > 0 ? '+' : ''}
                          <MontoARS monto={g.neto} />
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-semibold text-[#391511]">
                        <MontoARS monto={g.abs} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>

        {/* Detalle */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-[#6f3a2a] uppercase tracking-wide">
            Detalle
          </h3>
          <div className="rounded-xl border border-[#e4c9b0]/60 bg-white overflow-hidden">
            {detalle.length === 0 ? (
              <div className="p-8 text-center text-[#6f3a2a] text-sm">
                Sin desfasajes. Aparecen cuando el consumo real difiere de la receta
                al cerrar una orden.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-[#e4c9b0]/40">
                      <TableHead className="text-[#6f3a2a]">Insumo</TableHead>
                      <TableHead className="text-[#6f3a2a]">Elaborado</TableHead>
                      <TableHead className="text-[#6f3a2a]">Empleado</TableHead>
                      <TableHead className="text-[#6f3a2a] text-right">Receta</TableHead>
                      <TableHead className="text-[#6f3a2a] text-right">Real</TableHead>
                      <TableHead className="text-[#6f3a2a]">Motivo</TableHead>
                      <TableHead className="text-[#6f3a2a] text-right">Impacto $</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detalle.slice(0, 100).map((d) => (
                      <TableRow key={d.id} className="border-[#e4c9b0]/30">
                        <TableCell className="font-medium text-[#391511]">
                          {d.insumo}
                        </TableCell>
                        <TableCell className="text-[#6f3a2a]">{d.elaborado}</TableCell>
                        <TableCell className="text-[#6f3a2a] text-xs">
                          {d.responsable_id
                            ? nombrePorId.get(d.responsable_id) ?? 'Usuario'
                            : '—'}
                        </TableCell>
                        <TableCell className="text-right text-[#6f3a2a] tabular-nums">
                          {d.teorico} {d.unidad}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span
                            className={
                              d.diferencia > 0 ? 'text-[#c45e14]' : 'text-[#2f8f4e]'
                            }
                          >
                            {d.real} {d.unidad}
                          </span>
                        </TableCell>
                        <TableCell className="text-[#6f3a2a] text-xs">
                          {d.motivo ? MOTIVO_LABEL[d.motivo] ?? d.motivo : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={
                              d.diferencia_costo > 0
                                ? 'text-[#c45e14] font-semibold'
                                : 'text-[#2f8f4e] font-semibold'
                            }
                          >
                            {d.diferencia_costo > 0 ? '+' : ''}
                            <MontoARS monto={d.diferencia_costo} />
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function KpiDesfasaje({
  etiqueta,
  valor,
  ayuda,
  acento,
}: {
  etiqueta: string
  valor: React.ReactNode
  ayuda: string
  acento?: 'rojo' | 'verde'
}) {
  const color =
    acento === 'rojo'
      ? 'text-[#c45e14]'
      : acento === 'verde'
        ? 'text-[#2f8f4e]'
        : 'text-[#391511]'
  return (
    <div className="rounded-xl border border-[#e4c9b0]/60 bg-white p-3">
      <p className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
        {etiqueta}
      </p>
      <p className={`text-lg font-bold tabular-nums ${color}`}>{valor}</p>
      <p className="text-[10px] text-[#c8a58a] mt-0.5">{ayuda}</p>
    </div>
  )
}
