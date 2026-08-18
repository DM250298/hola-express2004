'use client'

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Centro de Compras — resumen por proveedor                             ║
// ║                                                                        ║
// ║  Cards ordenadas por urgencia (el contenedor ya las ordena): primero   ║
// ║  los proveedores con productos sin stock o debajo del punto de         ║
// ║  reposición. El $ sugerido solo se ve con permiso de costos (el RPC    ║
// ║  devuelve costo 0 para el resto, así que la suma da 0 y se oculta).    ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { ChevronRight, PackageX, ShoppingBag, TrendingDown } from 'lucide-react'
import { formatearMontoEntero, formatearNumero } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import type { GrupoProveedor } from './CentroCompras'

interface Props {
  grupos: GrupoProveedor[]
  onElegir: (proveedorId: number | null) => void
}

export function ResumenProveedores({ grupos, onElegir }: Props) {
  const totalSinStock = grupos.reduce((s, g) => s + g.sinStock, 0)
  const totalRequieren = grupos.reduce((s, g) => s + g.necesitanCompra, 0)
  const totalSugerido = grupos.reduce((s, g) => s + g.totalSugerido, 0)
  const conAccion = grupos.filter((g) => g.necesitanCompra > 0)

  if (grupos.length === 0) {
    return (
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-12 text-center">
        <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
          <ShoppingBag className="h-6 w-6 text-[#6f3a2a]" />
        </div>
        <p className="text-[#391511] font-semibold">Sin datos de cobertura</p>
        <p className="text-[#6f3a2a] text-sm mt-1">
          No hay productos activos para calcular sugerencias.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* KPIs globales */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-4">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
            <PackageX className="h-3.5 w-3.5 text-[#c43e2c]" />
            Sin stock
          </div>
          <p className="text-2xl font-extrabold text-[#c43e2c] tabular-nums mt-1">
            {formatearNumero(totalSinStock)}
          </p>
        </div>
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-4">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
            <TrendingDown className="h-3.5 w-3.5 text-[#e4a42a]" />
            Necesitan compra
          </div>
          <p className="text-2xl font-extrabold text-[#391511] tabular-nums mt-1">
            {formatearNumero(totalRequieren)}
          </p>
        </div>
        {totalSugerido > 0 && (
          <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-4 col-span-2 sm:col-span-1">
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Pedido sugerido total
            </div>
            <p className="text-2xl font-extrabold text-[#391511] tabular-nums mt-1">
              {formatearMontoEntero(totalSugerido)}
            </p>
          </div>
        )}
      </div>

      {conAccion.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-[#2f6f4f] bg-[#2f6f4f]/10 rounded-lg px-3 py-2">
          Ningún proveedor requiere acción: todo el stock está por encima del
          punto de reposición.
        </div>
      )}

      {/* Cards por proveedor */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {grupos.map((g) => {
          const requiereAccion = g.necesitanCompra > 0
          return (
            <button
              key={g.proveedor_id ?? 'sin'}
              type="button"
              onClick={() => onElegir(g.proveedor_id)}
              className={cn(
                'bg-white border rounded-2xl p-4 text-left transition-all hover:shadow-md',
                requiereAccion
                  ? 'border-[#c43e2c]/40 hover:border-[#c43e2c]'
                  : 'border-[#e4c9b0]/60 hover:border-[#f9b44c]'
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-[#391511] truncate">
                    {g.proveedor_nombre}
                  </div>
                  <div className="text-xs text-[#6f3a2a] mt-0.5">
                    {formatearNumero(g.filas.length)} producto(s) asociados
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-[#c8a58a] shrink-0 mt-1" />
              </div>

              <div className="mt-3 space-y-1 text-xs">
                {g.sinStock > 0 && (
                  <div className="text-[#c43e2c] font-semibold">
                    {formatearNumero(g.sinStock)} sin stock
                  </div>
                )}
                {g.necesitanCompra > 0 && (
                  <div className="text-[#a15c2f]">
                    {formatearNumero(g.necesitanCompra)} debajo del punto de
                    reposición
                  </div>
                )}
                {g.cerca > 0 && (
                  <div className="text-[#e4a42a]">
                    {formatearNumero(g.cerca)} cerca del punto
                  </div>
                )}
                {g.sobrestock > 0 && (
                  <div className="text-[#6f3a2a]">
                    {formatearNumero(g.sobrestock)} con sobrestock
                  </div>
                )}
                {g.sinVentas > 0 && (
                  <div className="text-[#c8a58a]">
                    {formatearNumero(g.sinVentas)} sin ventas recientes
                  </div>
                )}
                {g.necesitanCompra === 0 && g.sinStock === 0 && (
                  <div className="text-[#2f6f4f]">Stock en orden</div>
                )}
              </div>

              <div className="mt-3 pt-3 border-t border-[#e4c9b0]/40 flex items-center justify-between gap-2">
                {g.totalSugerido > 0 ? (
                  <span className="text-sm font-bold text-[#391511] tabular-nums">
                    {formatearMontoEntero(g.totalSugerido)}
                  </span>
                ) : (
                  <span className="text-xs text-[#c8a58a]">
                    {requiereAccion ? 'Sugerido sin costo' : 'Sin pedido sugerido'}
                  </span>
                )}
                <span
                  className={cn(
                    'text-xs font-semibold',
                    requiereAccion ? 'text-[#c43e2c]' : 'text-[#6f3a2a]'
                  )}
                >
                  Revisar pedido
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
