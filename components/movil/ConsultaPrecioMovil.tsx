'use client'

import { useState } from 'react'
import { AlertTriangle, Ban, Loader2, PackageSearch } from 'lucide-react'
import { toast } from 'sonner'
import { MontoARS } from '@/components/shared/MontoARS'
import {
  getProductoByBarcode,
  type ProductoConRelaciones,
} from '@/lib/queries/productos'
import { formatearNumero } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import { EscanerCamara } from './EscanerCamara'

/**
 * Vista de sólo lectura de un producto para el mostrador/piso: precio de venta
 * y stock al instante escaneando con la cámara. NO muestra el precio de costo
 * (queda gateado por RLS en la query, igual que en el resto del sistema).
 */
interface Resultado {
  id: number
  nombre: string
  categoria: string | null
  codigo: string | null
  precio_venta: number
  stock_actual: number
  stock_minimo: number
  unidad: string
  venta_por_peso: boolean
  no_ofrecer_ventas: boolean
  pendiente_precio: boolean
}

function aResultado(p: ProductoConRelaciones): Resultado {
  return {
    id: p.id,
    nombre: p.nombre,
    categoria: p.categorias?.nombre ?? null,
    codigo: p.codigo_barras,
    precio_venta: Number(p.precio_venta ?? 0),
    stock_actual: Number(p.stock_actual ?? 0),
    stock_minimo: Number(p.stock_minimo ?? 0),
    unidad: p.unidad ?? 'unidad',
    venta_por_peso: !!p.venta_por_peso,
    no_ofrecer_ventas: !!p.no_ofrecer_ventas,
    pendiente_precio: !!p.pendiente_precio,
  }
}

export function ConsultaPrecioMovil() {
  const [actual, setActual] = useState<Resultado | null>(null)
  const [recientes, setRecientes] = useState<Resultado[]>([])
  const [buscando, setBuscando] = useState(false)

  async function alEscanear(codigo: string) {
    setBuscando(true)
    try {
      const prod = await getProductoByBarcode(codigo)
      if (!prod) {
        setActual(null)
        toast.error(`No encontré un producto con el código ${codigo}`)
        return
      }
      const res = aResultado(prod)
      setActual(res)
      setRecientes((prev) =>
        [res, ...prev.filter((r) => r.id !== res.id)].slice(0, 8)
      )
    } catch {
      toast.error('No se pudo buscar el producto. Probá de nuevo.')
    } finally {
      setBuscando(false)
    }
  }

  return (
    <div className="space-y-4">
      <EscanerCamara
        onDetectado={alEscanear}
        ayuda="Apuntá al código de barras para ver precio y stock"
      />

      {buscando && (
        <p className="flex items-center justify-center gap-2 text-sm text-[#6f3a2a]">
          <Loader2 className="h-4 w-4 animate-spin" /> Buscando producto…
        </p>
      )}

      {actual ? (
        <FichaProducto res={actual} />
      ) : (
        !buscando && (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[#e4c9b0] bg-white/60 p-6 text-center text-sm text-[#6f3a2a]">
            <PackageSearch className="h-6 w-6 text-[#c8a58a]" />
            Escaneá un producto para ver su precio y cuánto stock hay.
          </div>
        )
      )}

      {recientes.length > 1 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#c8a58a]">
            Escaneados recién
          </p>
          <ul className="space-y-2">
            {recientes.slice(1).map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-[#e4c9b0]/60 bg-white px-3 py-2.5"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#391511]">
                  {r.nombre}
                </span>
                <span className="shrink-0 text-sm font-bold tabular-nums text-[#391511]">
                  {r.pendiente_precio ? (
                    <span className="text-[#c43e2c]">Sin precio</span>
                  ) : (
                    <MontoARS monto={r.precio_venta} />
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function FichaProducto({ res }: { res: Resultado }) {
  const sinStock = res.stock_actual <= 0
  const stockBajo = !sinStock && res.stock_actual <= res.stock_minimo

  return (
    <div className="rounded-2xl border border-[#e4c9b0]/70 bg-white p-4 shadow-sm">
      <p className="text-lg font-bold leading-tight text-[#391511]">
        {res.nombre}
      </p>
      {(res.categoria || res.codigo) && (
        <p className="mt-0.5 truncate text-xs text-[#c8a58a]">
          {[res.categoria, res.codigo].filter(Boolean).join(' · ')}
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-[#e4c9b0]/50 bg-[#fdfaf6] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#c8a58a]">
            Precio
          </p>
          {res.pendiente_precio ? (
            <p className="mt-0.5 text-lg font-bold text-[#c43e2c]">Sin precio</p>
          ) : (
            <p className="mt-0.5 text-2xl font-extrabold tabular-nums text-[#391511]">
              <MontoARS monto={res.precio_venta} />
              {res.venta_por_peso && (
                <span className="text-xs font-medium text-[#6f3a2a]"> /kg</span>
              )}
            </p>
          )}
        </div>
        <div className="rounded-xl border border-[#e4c9b0]/50 bg-[#fdfaf6] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#c8a58a]">
            Stock
          </p>
          <p
            className={cn(
              'mt-0.5 text-2xl font-extrabold tabular-nums',
              sinStock
                ? 'text-[#c43e2c]'
                : stockBajo
                  ? 'text-[#a06b00]'
                  : 'text-[#2f7d4f]'
            )}
          >
            {formatearNumero(res.stock_actual)}
            <span className="text-xs font-medium text-[#6f3a2a]">
              {' '}
              {res.unidad}
            </span>
          </p>
        </div>
      </div>

      {(sinStock || stockBajo || res.no_ofrecer_ventas) && (
        <div className="mt-3 space-y-1.5">
          {sinStock ? (
            <Aviso icono={AlertTriangle} tono="rojo" texto="Sin stock" />
          ) : (
            stockBajo && (
              <Aviso
                icono={AlertTriangle}
                tono="ambar"
                texto={`Stock bajo · mínimo ${formatearNumero(res.stock_minimo)}`}
              />
            )
          )}
          {res.no_ofrecer_ventas && (
            <Aviso
              icono={Ban}
              tono="rojo"
              texto="Marcado para no ofrecer a la venta"
            />
          )}
        </div>
      )}
    </div>
  )
}

function Aviso({
  icono: Icono,
  tono,
  texto,
}: {
  icono: React.ElementType
  tono: 'rojo' | 'ambar'
  texto: string
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium',
        tono === 'rojo'
          ? 'bg-[#c43e2c]/10 text-[#c43e2c]'
          : 'bg-[#f9b44c]/15 text-[#a06b00]'
      )}
    >
      <Icono className="h-4 w-4 shrink-0" />
      {texto}
    </div>
  )
}
