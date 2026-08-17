'use client'

import { useState } from 'react'
import { Loader2, Minus, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getProductoByBarcode } from '@/lib/queries/productos'
import { useCrearAjusteStock } from '@/lib/hooks/useAjustesStock'
import type { ItemAjustePayload } from '@/lib/queries/ajustesStock'
import {
  cantidadesIguales,
  formatearCantidad,
  redondearCantidad,
} from '@/lib/utils/formato'
import { EscanerCamara } from './EscanerCamara'

interface ItemConteo {
  producto_id: number
  nombre: string
  codigo: string | null
  stock_sistema: number
  precio_costo: number
  /** Lo que la encargada cuenta en góndola (input controlado). */
  contado: string
  /** true = se cuenta en kg: la cantidad admite hasta 3 decimales. */
  venta_por_peso: boolean
}

interface Props {
  usuarioId: string | null
}

/**
 * Conteo rápido: escaneá un producto, cargá cuántas unidades hay realmente y
 * al confirmar se ajusta el stock de todos de una sola vez (razón "recuento")
 * usando la RPC atómica `fn_crear_ajuste_stock`. Solo se ajustan los productos
 * cuyo conteo difiere del stock del sistema.
 */
export function ConteoRapidoMovil({ usuarioId }: Props) {
  const [items, setItems] = useState<ItemConteo[]>([])
  const [buscando, setBuscando] = useState(false)
  const crear = useCrearAjusteStock()

  /**
   * Re-escanear un producto que ya está en la lista suma +1 al contado y lo
   * sube arriba (ej: contó una góndola y encontró más unidades en otra).
   */
  function sumarEscaneado(item: ItemConteo) {
    // Los pesables no se cuentan de a 1: se pesa la mercadería y se carga el
    // total en kg, así que re-escanear solo lo sube arriba de la lista.
    if (item.venta_por_peso) {
      setItems((prev) => [
        item,
        ...prev.filter((it) => it.producto_id !== item.producto_id),
      ])
      toast.info(`${item.nombre} se cuenta por peso: cargá los kg a mano.`)
      return
    }
    const nuevoValor = (Number(item.contado) || 0) + 1
    setItems((prev) => [
      { ...item, contado: String(nuevoValor) },
      ...prev.filter((it) => it.producto_id !== item.producto_id),
    ])
    toast.success(`${item.nombre} · vas ${nuevoValor}`)
  }

  async function alEscanear(codigo: string) {
    const existente = items.find((it) => it.codigo === codigo)
    if (existente) {
      sumarEscaneado(existente)
      return
    }
    setBuscando(true)
    try {
      const prod = await getProductoByBarcode(codigo)
      if (!prod) {
        toast.error(`No encontré un producto con el código ${codigo}`)
        return
      }
      // Doble chequeo por id (puede entrar por código secundario).
      const porId = items.find((it) => it.producto_id === prod.id)
      if (porId) {
        sumarEscaneado(porId)
        return
      }
      setItems((prev) => [
        {
          producto_id: prod.id,
          nombre: prod.nombre,
          codigo: prod.codigo_barras,
          stock_sistema: Number(prod.stock_actual),
          precio_costo: Number(prod.precio_costo ?? 0),
          contado: '',
          venta_por_peso: prod.venta_por_peso,
        },
        ...prev,
      ])
      toast.success(prod.nombre)
    } catch {
      toast.error('No se pudo buscar el producto. Probá de nuevo.')
    } finally {
      setBuscando(false)
    }
  }

  function actualizarContado(producto_id: number, valor: string) {
    setItems((prev) =>
      prev.map((it) =>
        it.producto_id === producto_id ? { ...it, contado: valor } : it
      )
    )
  }

  /** Suma o resta 1 al contado con los botones − / + (mínimo 0). */
  function ajustarContado(producto_id: number, delta: number) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.producto_id !== producto_id) return it
        const nuevo = Math.max(0, (Number(it.contado) || 0) + delta)
        return { ...it, contado: String(nuevo) }
      })
    )
  }

  function quitar(producto_id: number) {
    setItems((prev) => prev.filter((it) => it.producto_id !== producto_id))
  }

  // Items con un conteo válido que difiere del sistema (los que se ajustan).
  // La diferencia se mide con tolerancia de 1 g y no con `!==`: restar kilos
  // arrastra ruido de float y un pesable contado EXACTO se colaría como ajuste.
  const itemsConDiferencia = items.filter(
    (it) =>
      it.contado.trim() !== '' &&
      !Number.isNaN(Number(it.contado)) &&
      Number(it.contado) >= 0 &&
      (it.venta_por_peso || Number.isInteger(Number(it.contado))) &&
      !cantidadesIguales(Number(it.contado), it.stock_sistema)
  )

  function confirmar() {
    if (!usuarioId) {
      toast.error('No se pudo identificar tu usuario. Reingresá a la app.')
      return
    }
    if (itemsConDiferencia.length === 0) {
      toast.info('No hay diferencias para ajustar.')
      return
    }
    const payload: ItemAjustePayload[] = itemsConDiferencia.map((it) => ({
      producto_id: it.producto_id,
      nombre: it.nombre,
      tipo: 'ajuste',
      cantidad: redondearCantidad(Number(it.contado), it.venta_por_peso),
      stock_actual: it.stock_sistema,
      precio_costo: it.precio_costo,
    }))
    crear.mutate(
      {
        usuario_id: usuarioId,
        razon: 'recuento',
        razon_detalle: 'Conteo rápido desde el modo móvil',
        items: payload,
      },
      {
        onSuccess: () => setItems([]),
      }
    )
  }

  return (
    <div className="space-y-4">
      <EscanerCamara
        onDetectado={alEscanear}
        ayuda="Apuntá al código de barras del producto"
      />

      {buscando && (
        <p className="flex items-center justify-center gap-2 text-sm text-[#6f3a2a]">
          <Loader2 className="h-4 w-4 animate-spin" /> Buscando producto…
        </p>
      )}

      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#e4c9b0] bg-white/60 p-6 text-center text-sm text-[#6f3a2a]">
          Todavía no escaneaste nada. El primer escaneo agrega el producto y ahí
          cargás cuánto contaste. Si lo volvés a escanear (por ejemplo porque
          encontraste más en otra góndola), suma +1 — salvo los productos por
          peso, donde los kg se cargan a mano.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => {
            const cont = it.contado.trim() === '' ? null : Number(it.contado)
            const dif =
              cont != null && !Number.isNaN(cont)
                ? redondearCantidad(cont - it.stock_sistema, it.venta_por_peso)
                : null
            return (
              <li
                key={it.producto_id}
                className="rounded-2xl border border-[#e4c9b0]/70 bg-white p-3 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-[#391511]">
                      {it.nombre}
                      {it.venta_por_peso && (
                        <span className="ml-1.5 rounded-full bg-[#f9b44c]/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#9e6b15]">
                          Por kg
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-[#6f3a2a]">
                      Sistema:{' '}
                      <span className="font-semibold tabular-nums">
                        {formatearCantidad(it.stock_sistema, it.venta_por_peso)}
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => quitar(it.producto_id)}
                    className="rounded-lg p-1.5 text-[#c43e2c] hover:bg-[#c43e2c]/10"
                    aria-label="Quitar"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <div className="flex-1">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[#6f3a2a]">
                      Conté en góndola
                      {it.venta_por_peso && (
                        <span className="text-[#9e6b15]"> (kg)</span>
                      )}
                    </label>
                    <div className="flex items-center gap-2">
                      {/* Los pesables se pesan y se carga el total: ±1 no aplica. */}
                      {!it.venta_por_peso && (
                        <button
                          type="button"
                          onClick={() => ajustarContado(it.producto_id, -1)}
                          disabled={cont == null || cont <= 0}
                          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#e4c9b0] bg-white text-[#391511] transition active:scale-95 disabled:opacity-40"
                          aria-label="Restar 1"
                        >
                          <Minus className="h-5 w-5" />
                        </button>
                      )}
                      <Input
                        type="number"
                        min="0"
                        step={it.venta_por_peso ? '0.001' : '1'}
                        inputMode={it.venta_por_peso ? 'decimal' : 'numeric'}
                        value={it.contado}
                        onChange={(e) =>
                          actualizarContado(it.producto_id, e.target.value)
                        }
                        placeholder={it.venta_por_peso ? '0,000' : '0'}
                        className="h-12 border-[#e4c9b0] text-center text-lg tabular-nums focus-visible:ring-[#f9b44c]"
                      />
                      {it.venta_por_peso ? (
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#e4c9b0] bg-[#fdfaf6] text-sm font-bold text-[#9e6b15]">
                          kg
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => ajustarContado(it.producto_id, 1)}
                          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#e4c9b0] bg-white text-[#391511] transition active:scale-95"
                          aria-label="Sumar 1"
                        >
                          <Plus className="h-5 w-5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {dif != null && !cantidadesIguales(dif, 0) && (
                    <span
                      className={
                        dif > 0
                          ? 'mt-4 rounded-lg bg-[#2f7d4f]/12 px-2 py-1 text-sm font-bold tabular-nums text-[#2f7d4f]'
                          : 'mt-4 rounded-lg bg-[#c43e2c]/12 px-2 py-1 text-sm font-bold tabular-nums text-[#c43e2c]'
                      }
                    >
                      {dif > 0 ? '+' : ''}
                      {formatearCantidad(dif, it.venta_por_peso)}
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {items.length > 0 && (
        <div className="sticky bottom-4 z-10">
          <Button
            type="button"
            onClick={confirmar}
            disabled={crear.isPending || itemsConDiferencia.length === 0}
            className="h-14 w-full rounded-2xl bg-[#f9b44c] text-base font-bold text-[#391511] shadow-lg hover:bg-[#e4a42a]"
          >
            {crear.isPending ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Ajustando stock…
              </>
            ) : itemsConDiferencia.length > 0 ? (
              `Confirmar conteo · ${itemsConDiferencia.length} con diferencia`
            ) : (
              'Cargá las cantidades contadas'
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
