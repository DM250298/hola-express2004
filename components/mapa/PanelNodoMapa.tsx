'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, PackagePlus, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EstadoError } from '@/components/shared/EstadoError'
import { cn } from '@/lib/utils'
import {
  formatearCantidad,
  formatearMontoEntero,
  formatearNumero,
} from '@/lib/utils/formato'
import { useQuitarProductoDeUbicacion, useSkusNodo } from '@/lib/hooks/useMapa'
import { ETIQUETA_TIPO } from '@/lib/queries/ubicaciones'
import type { NodoMapa } from '@/lib/queries/mapa'

const VISIBLES = 25

const formatoUnDecimal = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })

/**
 * Panel derecho del mapa: el nodo elegido, sus números, las acciones
 * (asignar productos, agregar estante, editar) y qué productos viven acá.
 */
export function PanelNodoMapa({
  nodo,
  ruta,
  desde,
  hasta,
  puedeVerCostos,
  onCerrar,
  puedeEditar = false,
  onAsignar,
  onAgregarHijo,
  etiquetaHijo,
  onEditar,
  onEliminar,
  info,
}: {
  nodo: NodoMapa
  ruta: string
  desde: string
  hasta: string
  puedeVerCostos: boolean
  onCerrar?: () => void
  puedeEditar?: boolean
  onAsignar?: () => void
  onAgregarHijo?: () => void
  /** "estante", "góndola"… para el botón de agregar. */
  etiquetaHijo?: string
  onEditar?: () => void
  /** Solo si se puede borrar (sin hijos ni productos). */
  onEliminar?: () => void
  /** Mueble y valores heredados de categoría, marca y responsable. */
  info?: {
    mueble: string | null
    categoria: string | null
    marca: string | null
    responsable: string | null
  }
}) {
  const quitar = useQuitarProductoDeUbicacion()
  const [confirmando, setConfirmando] = useState(false)
  const [verTodos, setVerTodos] = useState(false)
  const { data, isLoading, isError, refetch } = useSkusNodo(nodo.id, desde, hasta)
  const skus = data ?? []
  const visibles = verTodos ? skus : skus.slice(0, VISIBLES)

  return (
    <section className="rounded-2xl border-2 border-[#e4a42a]/50 bg-white shadow-sm">
      <header className="flex flex-wrap items-start gap-3 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] px-4 py-3">
        <div className="min-w-0 flex-1">
          <span className="mb-1 inline-block rounded-md bg-[#391511]/5 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#6f3a2a]">
            {ETIQUETA_TIPO[nodo.tipo]}
          </span>
          <h2 className="font-bold text-[#391511]">{nodo.nombre}</h2>
          {info && (info.mueble || info.categoria || info.marca || info.responsable) && (
            <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-[#6f3a2a]">
              {info.mueble && <span>{info.mueble}</span>}
              {info.categoria && <span>· va: {info.categoria}</span>}
              {info.marca && <span>· marca: {info.marca}</span>}
              {info.responsable && <span>· responsable: {info.responsable}</span>}
            </p>
          )}
          <p className="text-xs text-[#6f3a2a]">
            {ruta || 'Todo el local'} · {formatearNumero(nodo.skus)}{' '}
            {nodo.skus === 1 ? 'producto' : 'productos'}
          </p>
        </div>
        {puedeEditar && onEditar && (
          <button
            type="button"
            onClick={onEditar}
            className="shrink-0 rounded-md p-1 text-[#6f3a2a] hover:bg-[#f9b44c]/30"
            aria-label="Editar ubicación"
            title="Editar ubicación"
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
        {puedeEditar &&
          onEliminar &&
          (confirmando ? (
            <button
              type="button"
              onClick={() => {
                setConfirmando(false)
                onEliminar()
              }}
              onBlur={() => setConfirmando(false)}
              className="shrink-0 rounded-md bg-[#c43e2c] px-2 py-0.5 text-xs font-semibold text-white"
            >
              ¿Eliminar?
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmando(true)}
              className="shrink-0 rounded-md p-1 text-[#9e2f25] hover:bg-[#c43e2c]/10"
              aria-label="Eliminar ubicación"
              title="Eliminar ubicación"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ))}
        {onCerrar && (
          <button
            type="button"
            onClick={onCerrar}
            className="shrink-0 rounded-md p-1 text-[#6f3a2a] hover:bg-[#f9b44c]/30"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </header>

      <div className="grid grid-cols-2 gap-px border-b border-[#e4c9b0]/60 bg-[#e4c9b0]/40">
        <Dato etiqueta="Ventas" valor={formatearMontoEntero(nodo.ingresos)} />
        <Dato
          etiqueta="Margen"
          valor={
            puedeVerCostos && nodo.margen != null
              ? `${formatearMontoEntero(nodo.margen)}${
                  nodo.margen_pct != null
                    ? ` · ${formatoUnDecimal.format(nodo.margen_pct)}%`
                    : ''
                }`
              : '—'
          }
        />
        <Dato
          etiqueta="Stock a costo"
          valor={
            puedeVerCostos && nodo.stock_valorizado != null
              ? formatearMontoEntero(nodo.stock_valorizado)
              : '—'
          }
          detalle={
            nodo.dias_inventario != null
              ? `${formatearNumero(nodo.dias_inventario)} días de inventario`
              : undefined
          }
        />
        <Dato
          etiqueta="Para revisar"
          valor={`${formatearNumero(nodo.sin_stock)} sin stock`}
          detalle={`${formatearNumero(nodo.sin_movimiento)} sin vender · ${formatearNumero(nodo.quiebres)} quiebres`}
        />
      </div>

      {(onAsignar || (puedeEditar && onAgregarHijo)) && (
        <div className="space-y-2 border-b border-[#e4c9b0]/60 p-4">
          {onAsignar && (
            <Button
              type="button"
              onClick={onAsignar}
              className="h-10 w-full rounded-xl bg-[#f9b44c] font-bold text-[#391511] hover:bg-[#e4a42a]"
            >
              <PackagePlus className="mr-1.5 h-4 w-4" /> Asignar productos
            </Button>
          )}
          {puedeEditar && onAgregarHijo && (
            <Button
              type="button"
              variant="outline"
              onClick={onAgregarHijo}
              className="h-10 w-full rounded-xl"
            >
              <Plus className="mr-1.5 h-4 w-4" /> Agregar {etiquetaHijo ?? 'ubicación'}
            </Button>
          )}
        </div>
      )}

      <div className="p-4">
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 rounded-lg bg-[#f9d2a2]/30" />
            ))}
          </div>
        ) : isError ? (
          <EstadoError
            mensaje="No pudimos cargar los productos de esta ubicación."
            onReintentar={refetch}
          />
        ) : data === null ? (
          <p className="text-sm text-[#6f3a2a]">
            Falta correr la migración 194 para ver los productos de cada ubicación.
          </p>
        ) : skus.length === 0 ? (
          <div className="text-center">
            <p className="font-semibold text-[#391511]">Dale un lugar a tus productos</p>
            <p className="mt-1 text-sm text-[#6f3a2a]">
              Asignalos acá, desde la ficha del producto o escaneando desde el celular.
            </p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-[#e4c9b0]/40">
              {visibles.map((s) => (
                <li key={s.producto_id} className="flex items-start gap-3 py-2">
                  <span
                    className={cn(
                      'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                      s.alertas_criticas > 0
                        ? 'bg-[#c43e2c]'
                        : s.alertas_atencion > 0
                          ? 'bg-[#e4a42a]'
                          : 'bg-[#e4c9b0]'
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/inventario/${s.producto_id}`}
                      className="text-sm font-medium text-[#391511] hover:underline"
                    >
                      {s.nombre}
                    </Link>
                    <p className="text-xs text-[#6f3a2a]">
                      {s.ubicacion_nombre !== nodo.nombre && <>{s.ubicacion_nombre} · </>}
                      stock {formatearCantidad(s.stock_actual, s.venta_por_peso)}
                      {s.clase_abc && <> · clase {s.clase_abc}</>}
                      {s.dias_sin_venta != null && s.dias_sin_venta > 30 && (
                        <> · sin vender hace {formatearNumero(s.dias_sin_venta)} días</>
                      )}
                      {s.quiebres_periodo > 0 && (
                        <span className="text-[#9e2f25]">
                          {' '}
                          · {formatearNumero(s.quiebres_periodo)} quiebres
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold tabular-nums text-[#391511]">
                      {formatearMontoEntero(s.ingresos)}
                    </div>
                    {puedeVerCostos && s.margen_pct != null && (
                      <div className="text-[11px] text-[#6f3a2a]">
                        {formatoUnDecimal.format(s.margen_pct)}% margen
                      </div>
                    )}
                    {onAsignar && (
                      <button
                        type="button"
                        onClick={() =>
                          quitar.mutate({ productoId: s.producto_id, ubicacionId: s.ubicacion_id })
                        }
                        disabled={quitar.isPending}
                        className="mt-0.5 text-[11px] font-semibold text-[#9e2f25] hover:underline disabled:opacity-50"
                      >
                        Quitar de acá
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {skus.length > VISIBLES && (
              <button
                type="button"
                onClick={() => setVerTodos((v) => !v)}
                className="mt-2 text-xs font-semibold text-[#9e6b15] hover:underline"
              >
                {verTodos ? 'Ver menos' : `Ver los ${formatearNumero(skus.length)}`}
              </button>
            )}
            {(nodo.alertas_criticas > 0 || nodo.alertas_atencion > 0) && (
              <Link
                href="/alertas"
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#9e6b15] hover:underline"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                {formatearNumero(nodo.alertas_criticas + nodo.alertas_atencion)} alertas activas
                acá — ver y decidir
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function Dato({
  etiqueta,
  valor,
  detalle,
}: {
  etiqueta: string
  valor: string
  detalle?: string
}) {
  return (
    <div className="bg-white px-4 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6f3a2a]">
        {etiqueta}
      </div>
      <div className="font-bold tabular-nums text-[#391511]">{valor}</div>
      {detalle && <div className="text-[11px] text-[#c8a58a]">{detalle}</div>}
    </div>
  )
}
