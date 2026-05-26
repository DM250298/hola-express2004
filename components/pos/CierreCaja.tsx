'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Loader2, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MontoARS } from '@/components/shared/MontoARS'
import { ComprobanteCierre, type DatosComprobanteCierre } from './ComprobanteCierre'
import { ContadorBilletes } from './ContadorBilletes'
import { useCerrarTurno } from '@/lib/hooks/useTurno'
import { useMediosPago } from '@/lib/hooks/useMediosPago'
import { createClient } from '@/lib/supabase/client'
import { formatearMonto } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  turnoId: number
  montoApertura: number
  fechaApertura: string
  nombreCajero: string
}

interface DesgloseMedio {
  codigo: string
  total: number
  cantidad: number
}

interface ProductoVendido {
  nombre: string
  cantidad: number
  unidad: string
}

interface ResumenTurno {
  total_ventas_efectivo: number
  cantidad_ventas: number
  total_ventas: number
  por_medio: DesgloseMedio[]
  productos: ProductoVendido[]
  gastos: number
}

async function obtenerResumenTurno(turnoId: number): Promise<ResumenTurno> {
  const supabase = createClient()

  const [resVentas, resPagos, resItems, resGastos] = await Promise.all([
    supabase
      .from('ventas')
      .select('id', { count: 'exact', head: true })
      .eq('turno_id', turnoId)
      .eq('estado', 'completada'),
    supabase
      .from('pagos_venta')
      .select('medio_pago, monto, ventas!inner(turno_id, estado)')
      .eq('ventas.turno_id', turnoId)
      .eq('ventas.estado', 'completada'),
    supabase
      .from('items_venta')
      .select('cantidad, productos(nombre, unidad), ventas!inner(turno_id, estado)')
      .eq('ventas.turno_id', turnoId)
      .eq('ventas.estado', 'completada'),
    supabase.from('egresos').select('monto').eq('turno_id', turnoId),
  ])

  if (resVentas.error) throw resVentas.error
  if (resPagos.error) throw resPagos.error
  if (resItems.error) throw resItems.error
  // resGastos puede fallar si la migración 009 no se corrió → se asume 0.

  type FilaPago = { medio_pago: string; monto: number }
  const filas = (resPagos.data ?? []) as unknown as FilaPago[]

  // Agrupar por código de medio (dinámico)
  const mapa = new Map<string, DesgloseMedio>()
  for (const p of filas) {
    const previo = mapa.get(p.medio_pago)
    if (previo) {
      previo.total += Number(p.monto)
      previo.cantidad += 1
    } else {
      mapa.set(p.medio_pago, {
        codigo: p.medio_pago,
        total: Number(p.monto),
        cantidad: 1,
      })
    }
  }

  const por_medio = [...mapa.values()]
  const total_ventas = por_medio.reduce((acc, m) => acc + m.total, 0)
  const total_efectivo = mapa.get('efectivo')?.total ?? 0

  // Productos vendidos en el turno (agrupados por producto)
  type FilaItem = {
    cantidad: number
    productos: { nombre: string; unidad: string } | null
  }
  const itemsRaw = (resItems.data ?? []) as unknown as FilaItem[]
  const mapaProd = new Map<string, ProductoVendido>()
  for (const it of itemsRaw) {
    if (!it.productos) continue
    const prev = mapaProd.get(it.productos.nombre)
    if (prev) {
      prev.cantidad += it.cantidad
    } else {
      mapaProd.set(it.productos.nombre, {
        nombre: it.productos.nombre,
        cantidad: it.cantidad,
        unidad: it.productos.unidad,
      })
    }
  }
  const productos = [...mapaProd.values()].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es-AR')
  )

  const gastos = (resGastos.data ?? []).reduce(
    (acc, g) => acc + Number((g as { monto: number }).monto),
    0
  )

  return {
    total_ventas_efectivo: total_efectivo,
    cantidad_ventas: resVentas.count ?? 0,
    total_ventas,
    por_medio,
    productos,
    gastos,
  }
}

export function CierreCaja({
  abierto,
  onCambioAbierto,
  turnoId,
  montoApertura,
  fechaApertura,
  nombreCajero,
}: Props) {
  const cerrar = useCerrarTurno()
  const qc = useQueryClient()
  const { data: medios } = useMediosPago()
  const [montoCierre, setMontoCierre] = useState('')
  const [novedades, setNovedades] = useState('')
  const [mostrarContador, setMostrarContador] = useState(false)
  const [cantidadesBilletes, setCantidadesBilletes] = useState<Record<number, number>>({})

  // Calcula el total del contador y actualiza el campo de monto automáticamente
  function handleCantidadesBilletes(nuevas: Record<number, number>) {
    setCantidadesBilletes(nuevas)
    const total = Object.entries(nuevas).reduce(
      (acc, [denom, cant]) => acc + Number(denom) * (cant || 0),
      0
    )
    if (total > 0) setMontoCierre(String(total))
  }
  // Datos del comprobante una vez cerrado el turno
  const [comprobante, setComprobante] = useState<DatosComprobanteCierre | null>(
    null
  )

  const { data: resumen, isLoading } = useQuery({
    queryKey: ['resumen-turno', turnoId],
    queryFn: () => obtenerResumenTurno(turnoId),
    enabled: abierto,
    staleTime: 0,
  })

  useEffect(() => {
    if (abierto) {
      setMontoCierre('')
      setNovedades('')
      setComprobante(null)
      setMostrarContador(false)
      setCantidadesBilletes({})
    }
  }, [abierto])

  // codigo → nombre legible
  const nombreMedio = useMemo(() => {
    const mapa = new Map<string, string>()
    for (const m of medios ?? []) mapa.set(m.codigo, m.nombre)
    return mapa
  }, [medios])

  // Orden de presentación según la tabla de medios
  const ordenMedio = useMemo(() => {
    const mapa = new Map<string, number>()
    ;(medios ?? []).forEach((m) => mapa.set(m.codigo, m.orden))
    return mapa
  }, [medios])

  const desglose = useMemo(() => {
    const ordenDe = (codigo: string) => ordenMedio.get(codigo) ?? 999
    return [...(resumen?.por_medio ?? [])]
      .sort((a, b) => ordenDe(a.codigo) - ordenDe(b.codigo))
      .map((m) => ({
        etiqueta: nombreMedio.get(m.codigo) ?? m.codigo,
        total: m.total,
        cantidad: m.cantidad,
      }))
  }, [resumen, nombreMedio, ordenMedio])

  const montoEsperado = useMemo(
    () =>
      resumen
        ? Number(montoApertura) +
          resumen.total_ventas_efectivo -
          resumen.gastos
        : null,
    [resumen, montoApertura]
  )

  const cierreNumero = Number(montoCierre)
  const cierreValido =
    montoCierre !== '' && Number.isFinite(cierreNumero) && cierreNumero >= 0
  const diferencia =
    cierreValido && montoEsperado !== null ? cierreNumero - montoEsperado : null

  function handleCerrar() {
    if (!cierreValido || !resumen) return
    cerrar.mutate(
      {
        turnoId,
        montoCierreReal: cierreNumero,
        novedades: novedades.trim() ? novedades.trim() : null,
      },
      {
        onSuccess: (resultado) => {
          setComprobante({
            turnoId,
            cajeroNombre: nombreCajero,
            fechaApertura,
            fechaCierre:
              resultado.turno.fecha_cierre ?? new Date().toISOString(),
            montoApertura: Number(montoApertura),
            cantidadVentas: resumen.cantidad_ventas,
            totalVentas: resumen.total_ventas,
            desglose,
            productos: resumen.productos,
            gastosCaja: resumen.gastos,
            efectivoEsperado: resultado.monto_esperado,
            montoContado: cierreNumero,
            diferencia: resultado.diferencia,
            novedades: novedades.trim() ? novedades.trim() : null,
          })
        },
      }
    )
  }

  const cerrado = comprobante !== null

  /**
   * Cierra el modal. Si el turno ya quedó cerrado (fase informe), recién acá
   * se refresca la consulta del turno → la pantalla pasa a "Abrir caja".
   */
  function cerrarModal() {
    if (cerrado) {
      qc.invalidateQueries({ queryKey: ['turno-activo'] })
    }
    onCambioAbierto(false)
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => {
        if (cerrar.isPending) return
        if (!v) cerrarModal()
        else onCambioAbierto(true)
      }}
    >
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        {cerrado && comprobante ? (
          /* ─── FASE: turno cerrado — informe imprimible ─── */
          <>
            <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
              <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-[#2f8f4e]" />
                Turno #{turnoId} cerrado
              </DialogTitle>
              <DialogDescription className="text-[#6f3a2a]">
                Imprimí el informe para que el empleado lo firme.
              </DialogDescription>
            </DialogHeader>

            <div className="px-6 py-5 max-h-[60vh] overflow-y-auto">
              {/* Vista previa del comprobante */}
              <div className="flex justify-center bg-[#fdfaf6] rounded-xl p-3 border border-[#e4c9b0]/60">
                <ComprobanteCierre datos={comprobante} />
              </div>
            </div>

            <DialogFooter className="px-6 py-4 border-t border-[#e4c9b0]/60 bg-[#fdfaf6] flex-row gap-2 sm:gap-2">
              <Button
                variant="outline"
                onClick={cerrarModal}
                className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
              >
                Listo
              </Button>
              <Button
                onClick={() => window.print()}
                className="flex-1 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
              >
                <Printer className="h-4 w-4" />
                Imprimir informe
              </Button>
            </DialogFooter>
          </>
        ) : (
          /* ─── FASE: arqueo previo al cierre ─── */
          <>
            <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
              <DialogTitle className="text-[#391511] text-lg">
                Cerrar turno de caja
              </DialogTitle>
              <DialogDescription className="text-[#6f3a2a]">
                Contá el efectivo en caja y registralo abajo.
              </DialogDescription>
            </DialogHeader>

            <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <ResumenItem
                  etiqueta="Apertura"
                  valor={formatearMonto(montoApertura)}
                />
                <ResumenItem
                  etiqueta="Cantidad de ventas"
                  valor={isLoading ? '…' : `${resumen?.cantidad_ventas ?? 0}`}
                />
              </div>

              {/* Desglose por medio de pago */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold mb-2">
                  Ventas por medio de pago
                </div>
                <div className="rounded-xl border border-[#e4c9b0]/60 overflow-hidden bg-white">
                  <ul className="divide-y divide-[#e4c9b0]/40">
                    {isLoading ? (
                      <li className="px-3 py-2 text-sm text-[#6f3a2a]">
                        Cargando…
                      </li>
                    ) : desglose.length === 0 ? (
                      <li className="px-3 py-2 text-sm text-[#6f3a2a] italic">
                        Sin ventas en el turno.
                      </li>
                    ) : (
                      desglose.map((m) => (
                        <li
                          key={m.etiqueta}
                          className="flex items-center justify-between px-3 py-2 text-sm"
                        >
                          <span className="text-[#391511] font-medium">
                            {m.etiqueta}
                          </span>
                          <div className="text-right">
                            <span className="font-bold text-[#391511] tabular-nums">
                              {formatearMonto(m.total)}
                            </span>
                            <span className="text-[#c8a58a] text-xs ml-2 tabular-nums">
                              {m.cantidad} {m.cantidad === 1 ? 'pago' : 'pagos'}
                            </span>
                          </div>
                        </li>
                      ))
                    )}
                    <li className="flex items-center justify-between px-3 py-2.5 text-sm bg-[#fdfaf6]">
                      <span className="text-[#391511] font-bold uppercase tracking-wide text-xs">
                        Total ventas
                      </span>
                      <span className="font-extrabold text-[#391511] tabular-nums">
                        {isLoading
                          ? '…'
                          : formatearMonto(resumen?.total_ventas ?? 0)}
                      </span>
                    </li>
                  </ul>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <ResumenItem
                  etiqueta="Gastos de caja del turno"
                  valor={
                    isLoading ? '…' : formatearMonto(resumen?.gastos ?? 0)
                  }
                />
                <ResumenItem
                  etiqueta="Esperado (apertura + efectivo − gastos)"
                  valor={
                    montoEsperado != null
                      ? formatearMonto(montoEsperado)
                      : '…'
                  }
                  destacado
                />
              </div>

              {/* Contador de billetes (opcional) */}
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setMostrarContador((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl border border-[#e4c9b0]/60 bg-white text-sm font-medium text-[#391511] hover:bg-[#f9d2a2]/30 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    🪙 Contar billetes
                    <span className="text-[11px] text-[#c8a58a] font-normal">
                      — calcula el total automáticamente
                    </span>
                  </span>
                  <span className="text-[#6f3a2a] text-xs">
                    {mostrarContador ? '▲ ocultar' : '▼ mostrar'}
                  </span>
                </button>

                {mostrarContador && (
                  <ContadorBilletes
                    cantidades={cantidadesBilletes}
                    onChange={handleCantidadesBilletes}
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="monto-cierre"
                  className="text-[#391511] font-medium"
                >
                  Monto contado en caja
                </Label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6f3a2a] text-xl font-bold">
                    $
                  </span>
                  <Input
                    id="monto-cierre"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={montoCierre}
                    onChange={(e) => setMontoCierre(e.target.value)}
                    placeholder="0,00"
                    autoFocus
                    disabled={cerrar.isPending}
                    className="pl-10 h-14 text-2xl font-semibold tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                  />
                </div>
              </div>

              {diferencia !== null && (
                <div
                  className={cn(
                    'rounded-xl p-3 text-center',
                    Math.abs(diferencia) < 0.01
                      ? 'bg-[#f9b44c]/15 text-[#6f3a2a]'
                      : diferencia > 0
                        ? 'bg-[#ebd5a1]/40 text-[#6f3a2a]'
                        : 'bg-[#c43e2c]/15 text-[#9e2f25]'
                  )}
                >
                  <span className="text-xs font-medium uppercase tracking-wide">
                    Diferencia
                  </span>
                  <div className="text-xl font-bold tabular-nums">
                    {diferencia >= 0 ? '+' : '-'}
                    <MontoARS monto={Math.abs(diferencia)} />
                  </div>
                  {Math.abs(diferencia) >= 0.01 && (
                    <p className="text-xs mt-1">
                      {diferencia > 0
                        ? 'Sobra dinero en caja.'
                        : 'Faltó dinero en caja.'}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <Label
                  htmlFor="novedades"
                  className="text-[#391511] font-medium"
                >
                  Novedades (opcional)
                </Label>
                <Input
                  id="novedades"
                  value={novedades}
                  onChange={(e) => setNovedades(e.target.value)}
                  placeholder="Ej: cliente devolvió producto"
                  disabled={cerrar.isPending}
                  className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
            </div>

            <DialogFooter className="px-6 py-4 border-t border-[#e4c9b0]/60 bg-[#fdfaf6] flex-row gap-2 sm:gap-2">
              <Button
                variant="outline"
                onClick={() => onCambioAbierto(false)}
                disabled={cerrar.isPending}
                className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleCerrar}
                disabled={!cierreValido || cerrar.isPending || isLoading}
                className="flex-1 bg-[#c43e2c] hover:bg-[#9e2f25] text-white font-semibold"
              >
                {cerrar.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Cerrando…
                  </>
                ) : (
                  'Cerrar turno'
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>

      {/* Render off-screen para impresión térmica */}
      {cerrado && comprobante && (
        <div className="imprimir-termico" aria-hidden>
          <ComprobanteCierre datos={comprobante} />
        </div>
      )}
    </Dialog>
  )
}

function ResumenItem({
  etiqueta,
  valor,
  destacado,
}: {
  etiqueta: string
  valor: string
  destacado?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-xl px-3 py-2 border',
        destacado
          ? 'bg-[#f9b44c]/15 border-[#f9b44c]/40'
          : 'bg-white border-[#e4c9b0]/60'
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-[#6f3a2a] font-medium">
        {etiqueta}
      </div>
      <div className="text-[#391511] font-bold tabular-nums">{valor}</div>
    </div>
  )
}
