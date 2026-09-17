'use client'

import { Loader2, Minus, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCrearAjusteStock } from '@/lib/hooks/useAjustesStock'
import {
  cantidadesIguales,
  formatearCantidad,
  redondearCantidad,
} from '@/lib/utils/formato'

export interface ProductoEnConteo {
  producto_id: number
  nombre: string
  stock_sistema: number
  precio_costo: number
  venta_por_peso: boolean
  /** false = combo o sin control de stock: no se cuenta. */
  lleva_stock: boolean
  /** Lo que se contó (input controlado; vive en el padre para avisar si se pierde). */
  contado: string
}

interface Props {
  producto: ProductoEnConteo
  usuarioId: string | null
  /** Ruta de la ubicación, para dejarla en el detalle del ajuste. */
  ruta: string
  onContado: (valor: string) => void
  /** 'ok' = coincidía con el sistema; número = diferencia ajustada. */
  onListo: (resultado: 'ok' | number) => void
  onSaltear: () => void
}

/**
 * Conteo de UN producto recién escaneado en "Ubicar productos". Se cuenta
 * TODO lo que hay en el local (góndola + depósito): el sistema guarda un solo
 * stock por producto y lo contado lo reemplaza (razón "recuento").
 */
export function ContarProductoMovil({
  producto: p,
  usuarioId,
  ruta,
  onContado,
  onListo,
  onSaltear,
}: Props) {
  const crear = useCrearAjusteStock()

  if (!p.lleva_stock) {
    return (
      <div className="rounded-2xl border border-[#e4c9b0]/70 bg-white p-4 shadow-sm">
        <p className="font-semibold text-[#391511]">{p.nombre}</p>
        <p className="mt-1 text-sm text-[#6f3a2a]">
          Este producto no lleva stock (es un combo o no controla stock).
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={onSaltear}
          className="mt-3 h-11 w-full rounded-xl"
        >
          Seguir
        </Button>
      </div>
    )
  }

  const texto = p.contado.trim()
  const numero = texto === '' ? null : Number(texto)
  const valido =
    numero != null &&
    !Number.isNaN(numero) &&
    numero >= 0 &&
    (p.venta_por_peso || Number.isInteger(numero))
  const dif =
    valido && numero != null
      ? redondearCantidad(numero - p.stock_sistema, p.venta_por_peso)
      : null

  function sumar(delta: number) {
    const nuevo = Math.max(0, (Number(p.contado) || 0) + delta)
    onContado(String(nuevo))
  }

  function guardar() {
    if (!valido || numero == null) {
      toast.error(
        p.venta_por_peso
          ? 'Cargá los kg contados.'
          : 'Cargá una cantidad entera (0 o más).'
      )
      return
    }
    if (cantidadesIguales(numero, p.stock_sistema)) {
      toast.success(`${p.nombre}: el stock coincide`)
      onListo('ok')
      return
    }
    if (!usuarioId) {
      toast.error('No se pudo identificar tu usuario. Reingresá a la app.')
      return
    }
    const cantidad = redondearCantidad(numero, p.venta_por_peso)
    crear.mutate(
      {
        usuario_id: usuarioId,
        razon: 'recuento',
        razon_detalle: `Ubicar productos · ${ruta}`,
        items: [
          {
            producto_id: p.producto_id,
            nombre: p.nombre,
            tipo: 'ajuste',
            cantidad,
            stock_actual: p.stock_sistema,
            precio_costo: p.precio_costo,
          },
        ],
      },
      {
        onSuccess: () =>
          onListo(redondearCantidad(cantidad - p.stock_sistema, p.venta_por_peso)),
      }
    )
  }

  return (
    <div className="rounded-2xl border-2 border-[#f9b44c]/60 bg-white p-4 shadow-sm">
      <p className="font-semibold text-[#391511]">{p.nombre}</p>
      <p className="text-xs text-[#6f3a2a]">
        Stock en el sistema:{' '}
        <span className="font-semibold tabular-nums">
          {formatearCantidad(p.stock_sistema, p.venta_por_peso)}
        </span>
      </p>

      <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wider text-[#6f3a2a]">
        Contado · todo el local (góndola + depósito)
        {p.venta_por_peso && <span className="text-[#9e6b15]"> (kg)</span>}
      </label>
      <div className="mt-1 flex items-center gap-2">
        {!p.venta_por_peso && (
          <button
            type="button"
            onClick={() => sumar(-1)}
            disabled={numero == null || numero <= 0}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#e4c9b0] bg-white text-[#391511] transition active:scale-95 disabled:opacity-40"
            aria-label="Restar 1"
          >
            <Minus className="h-5 w-5" />
          </button>
        )}
        <Input
          type="number"
          min="0"
          step={p.venta_por_peso ? '0.001' : '1'}
          inputMode={p.venta_por_peso ? 'decimal' : 'numeric'}
          value={p.contado}
          onChange={(e) => onContado(e.target.value)}
          placeholder={p.venta_por_peso ? '0,000' : '0'}
          className="h-12 border-[#e4c9b0] text-center text-lg tabular-nums focus-visible:ring-[#f9b44c]"
        />
        {p.venta_por_peso ? (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#e4c9b0] bg-[#fdfaf6] text-sm font-bold text-[#9e6b15]">
            kg
          </span>
        ) : (
          <button
            type="button"
            onClick={() => sumar(1)}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#e4c9b0] bg-white text-[#391511] transition active:scale-95"
            aria-label="Sumar 1"
          >
            <Plus className="h-5 w-5" />
          </button>
        )}
      </div>
      {dif != null && (
        <p
          className={
            cantidadesIguales(dif, 0)
              ? 'mt-1.5 text-sm font-semibold text-[#2f7d4f]'
              : dif > 0
                ? 'mt-1.5 text-sm font-bold tabular-nums text-[#2f7d4f]'
                : 'mt-1.5 text-sm font-bold tabular-nums text-[#c43e2c]'
          }
        >
          {cantidadesIguales(dif, 0)
            ? 'Coincide con el sistema'
            : `${dif > 0 ? '+' : ''}${formatearCantidad(dif, p.venta_por_peso)} contra el sistema`}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onSaltear}
          disabled={crear.isPending}
          className="h-12 flex-1 rounded-xl"
        >
          Saltear
        </Button>
        <Button
          type="button"
          onClick={guardar}
          disabled={crear.isPending || !valido}
          className="h-12 flex-[2] rounded-xl bg-[#f9b44c] font-bold text-[#391511] hover:bg-[#e4a42a]"
        >
          {crear.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando…
            </>
          ) : (
            'Guardar conteo'
          )}
        </Button>
      </div>
    </div>
  )
}
