'use client'

import { useMemo, useState } from 'react'
import {
  CheckCircle2,
  FileText,
  FilePlus2,
  Inbox,
  Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { formatearFechaCorta } from '@/lib/utils/formato'
import { toast } from 'sonner'
import {
  useBuscarCuentaAPagar,
  useCuentasAPagar,
} from '@/lib/hooks/useFinanzas'
import { useComprobantesCargados } from '@/lib/hooks/useFacturasCompra'
import { useProveedores } from '@/lib/hooks/useProveedores'
import { ModalEditarFactura } from './ModalEditarFactura'
import type { CuentaAPagarConProveedor } from '@/lib/queries/finanzas'

function nroComprobante(
  tipo: string | null,
  pto: string | null,
  nro: string | null
): string | null {
  if (!tipo && !pto && !nro) return null
  const ptoFmt = pto ? pto.padStart(4, '0') : '----'
  const nroFmt = nro ? nro.padStart(8, '0') : '--------'
  return `${tipo ?? '?'} ${ptoFmt}-${nroFmt}`
}

/** ¿La fecha (date o timestamp) cae dentro del rango [desde, hasta]? */
function enRango(fecha: string, desde: string, hasta: string): boolean {
  const ts = new Date(`${fecha.slice(0, 10)}T12:00:00`).getTime()
  return ts >= new Date(desde).getTime() && ts <= new Date(hasta).getTime()
}

interface Props {
  desde: string
  hasta: string
}

export function TabComprobantes({ desde, hasta }: Props) {
  const { data: cuentas, isLoading: cargandoCuentas } = useCuentasAPagar(null)
  const { data: comprobantes, isLoading: cargandoComp } =
    useComprobantesCargados()
  const { data: proveedores } = useProveedores()
  const buscarCuenta = useBuscarCuentaAPagar()
  const [cuentaEditar, setCuentaEditar] =
    useState<CuentaAPagarConProveedor | null>(null)
  const [busqueda, setBusqueda] = useState('')

  // Mapa cuenta_id → cuenta (para abrir el modal desde un comprobante)
  const cuentasPorId = useMemo(() => {
    const m = new Map<number, CuentaAPagarConProveedor>()
    for (const c of cuentas ?? []) m.set(c.id, c)
    return m
  }, [cuentas])

  // Abre el modal de la factura. El listado solo trae las últimas 500
  // cuentas pagadas: si la cuenta de un comprobante viejo no está en el
  // mapa, se busca puntual por id en vez de dejar el botón muerto.
  async function abrirComprobante(cuentaId: number) {
    const enMapa = cuentasPorId.get(cuentaId)
    if (enMapa) {
      setCuentaEditar(enMapa)
      return
    }
    try {
      const cuenta = await buscarCuenta(cuentaId)
      if (cuenta) setCuentaEditar(cuenta)
      else toast.error('No se encontró la cuenta asociada al comprobante.')
    } catch {
      toast.error('No se pudo cargar la cuenta del comprobante.')
    }
  }

  // Mapa proveedor_id → nombre (respaldo cuando no hay cuenta asociada)
  const proveedoresPorId = useMemo(() => {
    const m = new Map<number, string>()
    for (const p of proveedores ?? []) m.set(p.id, p.nombre)
    return m
  }, [proveedores])

  // Resuelve el nombre del proveedor de un comprobante: primero por la
  // cuenta a pagar asociada, luego por proveedor_id contra el catálogo.
  function nombreProveedor(c: {
    cuenta_id: number | null
    proveedor_id: number | null
  }): string | null {
    const porCuenta =
      c.cuenta_id != null ? cuentasPorId.get(c.cuenta_id)?.proveedor_nombre : null
    if (porCuenta) return porCuenta
    if (c.proveedor_id != null) return proveedoresPorId.get(c.proveedor_id) ?? null
    return null
  }

  // Cuentas que YA tienen comprobante cargado
  const cuentasConFactura = useMemo(() => {
    const s = new Set<number>()
    for (const c of comprobantes ?? []) {
      if (c.cuenta_id != null) s.add(c.cuenta_id)
    }
    return s
  }, [comprobantes])

  // Por cargar: cuentas no pagadas sin comprobante
  const porCargar = useMemo(
    () =>
      (cuentas ?? []).filter(
        (c) => c.estado !== 'pagada' && !cuentasConFactura.has(c.id)
      ),
    [cuentas, cuentasConFactura]
  )

  const q = busqueda.trim().toLowerCase()
  const comprobantesFiltrados = (comprobantes ?? []).filter((c) => {
    // El período filtra las facturas YA cargadas (por fecha de emisión).
    if (!enRango(c.fecha, desde, hasta)) return false
    if (!q) return true
    const nro = nroComprobante(
      c.tipo_comprobante,
      c.punto_venta,
      c.numero_comprobante
    )
    return (
      (nombreProveedor(c) ?? '').toLowerCase().includes(q) ||
      (nro ?? '').toLowerCase().includes(q)
    )
  })

  const cargando = cargandoCuentas || cargandoComp

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[#391511] font-bold">Comprobantes de compra</h2>
        <p className="text-[#6f3a2a] text-sm">
          Cargá las facturas de proveedores: costos, IVA crédito y precios de
          venta en un solo lugar.
        </p>
      </div>

      {/* Por cargar */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-[#c43e2c]" />
          <h3 className="text-[#391511] font-semibold text-sm">
            Pendientes de factura
          </h3>
          {porCargar.length > 0 && (
            <span className="text-[10px] font-bold text-[#c43e2c] bg-[#c43e2c]/10 rounded-full px-2 py-0.5">
              {porCargar.length}
            </span>
          )}
        </div>

        {cargando ? (
          <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-6">
            <SkeletonTabla filas={3} columnas={4} />
          </div>
        ) : porCargar.length === 0 ? (
          <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-6 text-center">
            <div className="inline-flex p-2.5 rounded-full bg-[#2f8f4e]/10 mb-2">
              <CheckCircle2 className="h-5 w-5 text-[#2f8f4e]" />
            </div>
            <p className="text-[#391511] font-semibold text-sm">
              No hay facturas pendientes de cargar
            </p>
            <p className="text-[#6f3a2a] text-xs mt-0.5">
              Cuando recibís un pedido, la cuenta a pagar aparece acá hasta que
              cargás la factura.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {porCargar.map((c) => (
              <div
                key={c.id}
                className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-4 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-[#391511] truncate">
                      {c.proveedor_nombre ?? 'Sin proveedor'}
                    </div>
                    <div className="text-xs text-[#6f3a2a] font-mono">
                      Pedido #{c.pedido_id}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] uppercase tracking-wider text-[#c8a58a] font-semibold">
                      Estimado
                    </div>
                    <div className="font-bold text-[#391511] tabular-nums">
                      <MontoARS monto={c.monto} />
                    </div>
                  </div>
                </div>
                <Button
                  onClick={() => setCuentaEditar(c)}
                  className="w-full bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold"
                >
                  <FilePlus2 className="mr-2 h-4 w-4" />
                  Cargar factura
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Cargados */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-[#6f3a2a]" />
            <h3 className="text-[#391511] font-semibold text-sm">
              Facturas cargadas
            </h3>
            <span className="text-[10px] text-[#c8a58a] font-medium">
              del período elegido
            </span>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#c8a58a]" />
            <Input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Proveedor o número…"
              className="pl-8 h-9 border-[#e4c9b0] focus-visible:ring-[#f9b44c] bg-white text-sm"
            />
          </div>
        </div>

        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
          {cargando ? (
            <div className="p-6">
              <SkeletonTabla filas={5} columnas={6} />
            </div>
          ) : comprobantesFiltrados.length === 0 ? (
            <div className="p-10 text-center text-[#6f3a2a] text-sm">
              {q
                ? 'No hay comprobantes que coincidan con la búsqueda.'
                : 'No se cargaron facturas en el período elegido.'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                  <TableHead className="text-[#391511] font-semibold">
                    Proveedor
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Comprobante
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Emisión
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Neto
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    IVA
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Total
                  </TableHead>
                  <TableHead className="text-right w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {comprobantesFiltrados.map((c, i) => {
                  const nro = nroComprobante(
                    c.tipo_comprobante,
                    c.punto_venta,
                    c.numero_comprobante
                  )
                  return (
                    <TableRow
                      key={`${c.cuenta_id}-${i}`}
                      className="border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6]"
                    >
                      <TableCell className="font-medium text-[#391511]">
                        {nombreProveedor(c) ?? (
                          <span className="text-[#c8a58a] italic">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {nro ? (
                          <span className="font-mono text-xs text-[#391511]">
                            {nro}
                          </span>
                        ) : (
                          <span className="text-[10px] text-[#c43e2c] bg-[#c43e2c]/10 rounded-full px-2 py-0.5">
                            sin datos formales
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-[#6f3a2a] tabular-nums">
                        {formatearFechaCorta(c.fecha)}
                      </TableCell>
                      <TableCell className="text-right text-[#6f3a2a] tabular-nums">
                        <MontoARS monto={c.neto} />
                      </TableCell>
                      <TableCell className="text-right text-[#6f3a2a] tabular-nums">
                        <MontoARS monto={c.iva_total} />
                      </TableCell>
                      <TableCell className="text-right font-bold text-[#391511] tabular-nums">
                        <MontoARS monto={c.total} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={c.cuenta_id == null}
                          onClick={() =>
                            c.cuenta_id != null && abrirComprobante(c.cuenta_id)
                          }
                          className="h-8 text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511] text-xs"
                        >
                          Ver
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      <ModalEditarFactura
        abierto={cuentaEditar !== null}
        onCambioAbierto={(v) => !v && setCuentaEditar(null)}
        cuenta={cuentaEditar}
      />
    </div>
  )
}
