'use client'

import { useEffect, useMemo, useState } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import { usePedidoDetalle } from '@/lib/hooks/usePedidos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import {
  useFacturaCompra,
  useGuardarFacturaCompra,
} from '@/lib/hooks/useFacturasCompra'
import { calcularLinea } from '@/lib/queries/facturasCompra'
import type { CuentaAPagarConProveedor } from '@/lib/queries/finanzas'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  cuenta: CuentaAPagarConProveedor | null
}

interface LineaState {
  costo: string
  descuento: string
  iva_compra: string
  margen: string
  iva_venta: string
}

const LINEA_DEFAULT: LineaState = {
  costo: '0',
  descuento: '0',
  iva_compra: '21',
  margen: '30',
  iva_venta: '21',
}

export function ModalEditarFactura({ abierto, onCambioAbierto, cuenta }: Props) {
  const { data: usuario } = useUsuario()
  const { data: pedido, isLoading: cargandoPedido } = usePedidoDetalle(
    cuenta?.pedido_id
  )
  const { data: facturaGuardada, isLoading: cargandoFactura } =
    useFacturaCompra(cuenta?.id ?? null)
  const guardar = useGuardarFacturaCompra()

  const [afectaVenta, setAfectaVenta] = useState(true)
  const [lineas, setLineas] = useState<Record<number, LineaState>>({})

  const items = useMemo(() => pedido?.items ?? [], [pedido])
  const cargando = cargandoPedido || cargandoFactura

  function cantidadDe(it: (typeof items)[number]): number {
    return it.cantidad_recibida ?? it.cantidad_pedida
  }

  // Inicializar las líneas: factura guardada si existe, sino defaults.
  useEffect(() => {
    if (!abierto || cargando || items.length === 0) return
    const guardadaPorProducto = new Map(
      (facturaGuardada?.items ?? []).map((i) => [i.producto_id, i])
    )
    const inicial: Record<number, LineaState> = {}
    for (const it of items) {
      const g = guardadaPorProducto.get(it.producto_id)
      if (g) {
        inicial[it.id] = {
          costo: String(g.costo_sin_iva),
          descuento: String(g.descuento_porcentaje),
          iva_compra: String(g.iva_compra_porcentaje),
          margen: String(g.margen_porcentaje),
          iva_venta: String(g.iva_venta_porcentaje),
        }
      } else {
        inicial[it.id] = {
          ...LINEA_DEFAULT,
          costo: String(it.precio_costo || 0),
        }
      }
    }
    setLineas(inicial)
    if (facturaGuardada) setAfectaVenta(facturaGuardada.factura.afecta_precio_venta)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, cargando, items.length, facturaGuardada])

  function setCampo(itemId: number, campo: keyof LineaState, valor: string) {
    setLineas((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? LINEA_DEFAULT), [campo]: valor },
    }))
  }

  // Cálculo por línea
  const calculadas = items.map((it) => {
    const e = lineas[it.id] ?? LINEA_DEFAULT
    const calc = calcularLinea({
      costo_sin_iva: Number(e.costo) || 0,
      descuento_porcentaje: Number(e.descuento) || 0,
      iva_compra_porcentaje: Number(e.iva_compra) || 0,
      margen_porcentaje: Number(e.margen) || 0,
      iva_venta_porcentaje: Number(e.iva_venta) || 0,
    })
    return { it, e, calc, cantidad: cantidadDe(it) }
  })

  const totales = calculadas.reduce(
    (acc, { calc, cantidad }) => {
      acc.neto += calc.costoNeto * cantidad
      acc.iva += (calc.costoConIva - calc.costoNeto) * cantidad
      return acc
    },
    { neto: 0, iva: 0 }
  )
  const totalConIva = totales.neto + totales.iva

  function handleGuardar() {
    if (!pedido || !cuenta || !usuario || guardar.isPending) return
    guardar.mutate(
      {
        cuenta_id: cuenta.id,
        pedido_id: pedido.id,
        proveedor_id: cuenta.proveedor_id,
        fecha: new Date().toISOString().slice(0, 10),
        afecta_precio_venta: afectaVenta,
        usuario_id: usuario.id,
        lineas: calculadas.map(({ it, e, cantidad }) => ({
          item_pedido_id: it.id,
          producto_id: it.producto_id,
          cantidad,
          costo_sin_iva: Number(e.costo) || 0,
          descuento_porcentaje: Number(e.descuento) || 0,
          iva_compra_porcentaje: Number(e.iva_compra) || 0,
          margen_porcentaje: Number(e.margen) || 0,
          iva_venta_porcentaje: Number(e.iva_venta) || 0,
        })),
      },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  const inputCls =
    'h-8 w-full text-right tabular-nums border-[#e4c9b0] text-xs px-1.5'

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !guardar.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-6xl p-0 gap-0 overflow-hidden max-h-[92vh] flex flex-col">
        <DialogHeader className="px-6 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <FileText className="h-5 w-5 text-[#f9b44c]" />
            Cargar factura{cuenta ? ` · Pedido #${cuenta.pedido_id}` : ''}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Cargá los costos con IVA y el margen. El costo guardado es el neto
            (sin IVA).
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto px-6 py-5 space-y-4">
          {/* Cabecera */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-[#6f3a2a]">
              Proveedor:{' '}
              <span className="font-semibold text-[#391511]">
                {cuenta?.proveedor_nombre ?? 'Sin asignar'}
              </span>
            </div>
            <label className="flex items-center gap-2 text-sm text-[#391511]">
              <Switch checked={afectaVenta} onCheckedChange={setAfectaVenta} />
              Afectar precio de venta
            </label>
          </div>

          {cargando || !pedido ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 rounded-lg bg-[#f9d2a2]/30" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-[#6f3a2a] py-6 text-center">
              Este pedido no tiene items.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#e4c9b0]/60">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[#391511] text-[#f9d2a2]">
                    <th className="p-2 text-left" rowSpan={2}>
                      Producto
                    </th>
                    <th className="p-2" rowSpan={2}>
                      Cant.
                    </th>
                    <th className="p-2 text-center bg-[#6f3a2a]" colSpan={5}>
                      COMPRA
                    </th>
                    <th className="p-2 text-center bg-[#c43e2c]" colSpan={4}>
                      VENTA
                    </th>
                  </tr>
                  <tr className="bg-[#391511] text-[#f9d2a2]">
                    <th className="p-1.5 font-medium">Costo s/IVA</th>
                    <th className="p-1.5 font-medium">Desc. %</th>
                    <th className="p-1.5 font-medium">Subtotal</th>
                    <th className="p-1.5 font-medium">IVA %</th>
                    <th className="p-1.5 font-medium">Costo c/IVA</th>
                    <th className="p-1.5 font-medium">Margen %</th>
                    <th className="p-1.5 font-medium">Precio s/IVA</th>
                    <th className="p-1.5 font-medium">IVA %</th>
                    <th className="p-1.5 font-medium">Precio c/IVA</th>
                  </tr>
                </thead>
                <tbody>
                  {calculadas.map(({ it, e, calc, cantidad }) => (
                    <tr
                      key={it.id}
                      className="border-b border-[#e4c9b0]/40 bg-white"
                    >
                      <td className="p-2 text-[#391511] font-medium min-w-[180px]">
                        {it.producto?.nombre ?? 'Producto eliminado'}
                        {it.producto?.codigo_barras && (
                          <span className="block text-[#c8a58a] font-mono text-[10px]">
                            {it.producto.codigo_barras}
                          </span>
                        )}
                      </td>
                      <td className="p-2 text-center tabular-nums text-[#6f3a2a]">
                        {cantidad}
                      </td>
                      <td className="p-1 w-24">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={e.costo}
                          onChange={(ev) =>
                            setCampo(it.id, 'costo', ev.target.value)
                          }
                          className={inputCls}
                        />
                      </td>
                      <td className="p-1 w-16">
                        <Input
                          type="number"
                          min="0"
                          value={e.descuento}
                          onChange={(ev) =>
                            setCampo(it.id, 'descuento', ev.target.value)
                          }
                          className={inputCls}
                        />
                      </td>
                      <td className="p-2 text-right tabular-nums text-[#6f3a2a]">
                        <MontoARS monto={calc.costoNeto * cantidad} />
                      </td>
                      <td className="p-1 w-16">
                        <Input
                          type="number"
                          min="0"
                          value={e.iva_compra}
                          onChange={(ev) =>
                            setCampo(it.id, 'iva_compra', ev.target.value)
                          }
                          className={inputCls}
                        />
                      </td>
                      <td className="p-2 text-right tabular-nums font-semibold text-[#391511]">
                        <MontoARS monto={calc.costoConIva} />
                      </td>
                      <td className="p-1 w-16">
                        <Input
                          type="number"
                          value={e.margen}
                          onChange={(ev) =>
                            setCampo(it.id, 'margen', ev.target.value)
                          }
                          className={inputCls}
                        />
                      </td>
                      <td className="p-2 text-right tabular-nums text-[#6f3a2a]">
                        <MontoARS monto={calc.precioSinIva} />
                      </td>
                      <td className="p-1 w-16">
                        <Input
                          type="number"
                          min="0"
                          value={e.iva_venta}
                          onChange={(ev) =>
                            setCampo(it.id, 'iva_venta', ev.target.value)
                          }
                          className={inputCls}
                        />
                      </td>
                      <td className="p-2 text-right tabular-nums font-bold text-[#391511]">
                        <MontoARS monto={calc.precioConIva} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 shrink-0">
          <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 mb-3 text-sm">
            <span className="text-[#6f3a2a]">
              Importe neto:{' '}
              <span className="font-semibold text-[#391511] tabular-nums">
                <MontoARS monto={totales.neto} />
              </span>
            </span>
            <span className="text-[#6f3a2a]">
              IVA:{' '}
              <span className="font-semibold text-[#391511] tabular-nums">
                <MontoARS monto={totales.iva} />
              </span>
            </span>
            <span className="text-[#391511] font-bold">
              Total a pagar:{' '}
              <span className="text-xl font-extrabold tabular-nums">
                <MontoARS monto={totalConIva} />
              </span>
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onCambioAbierto(false)}
              disabled={guardar.isPending}
              className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleGuardar}
              disabled={guardar.isPending || items.length === 0}
              className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
            >
              {guardar.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando…
                </>
              ) : (
                'Guardar factura'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
