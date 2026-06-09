'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  CheckCircle2,
  ExternalLink,
  Lightbulb,
  PackagePlus,
} from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { DrawerProducto } from '@/components/configuracion/productos/DrawerProducto'
import { formatearFechaHora } from '@/lib/utils/formato'
import { useSugerencias, useActualizarSugerencia } from '@/lib/hooks/useSugerencias'
import { useProveedores } from '@/lib/hooks/useProveedores'
import { cn } from '@/lib/utils'
import type { EstadoSugerencia } from '@/types/database'
import type { SugerenciaConRelaciones } from '@/lib/queries/sugerencias'

const SIN_PROVEEDOR = '__sin__'

const ESTADO_INFO: Record<EstadoSugerencia, { label: string; cls: string }> = {
  pendiente: { label: 'Pendiente', cls: 'bg-[#f9b44c]/20 text-[#9e6b15]' },
  en_proceso: { label: 'En proceso', cls: 'bg-[#6f3a2a]/12 text-[#6f3a2a]' },
  resuelta: { label: 'Resuelta', cls: 'bg-[#2f7d4f]/15 text-[#2f7d4f]' },
  descartada: { label: 'Descartada', cls: 'bg-[#c8a58a]/25 text-[#6f3a2a]' },
}

const ESTADOS_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  en_proceso: 'En proceso',
  resuelta: 'Resuelta',
  descartada: 'Descartada',
}

const PRIORIDAD: Record<EstadoSugerencia, number> = {
  pendiente: 0,
  en_proceso: 1,
  resuelta: 2,
  descartada: 3,
}

/** Badge con la cantidad de sugerencias pendientes, para el trigger del tab. */
export function BadgeSugerenciasPendientes() {
  const { data } = useSugerencias()
  const n = (data ?? []).filter((s) => s.estado === 'pendiente').length
  if (n === 0) return null
  return (
    <span className="ml-1 text-[10px] font-bold bg-[#f9b44c]/30 text-[#391511] rounded-full px-1.5 py-0.5 tabular-nums">
      {n}
    </span>
  )
}

export function TabSugerencias() {
  const { data: sugerencias, isLoading, isError } = useSugerencias()
  const { data: proveedores } = useProveedores()
  const actualizar = useActualizarSugerencia()
  const [mostrarCerradas, setMostrarCerradas] = useState(false)
  const [sugParaProducto, setSugParaProducto] =
    useState<SugerenciaConRelaciones | null>(null)

  const itemsProveedores = useMemo(() => {
    const r: Record<string, string> = { [SIN_PROVEEDOR]: 'Sin asignar' }
    for (const p of proveedores ?? []) r[String(p.id)] = p.nombre
    return r
  }, [proveedores])

  const visibles = useMemo(() => {
    const lista = (sugerencias ?? []).filter((s) =>
      mostrarCerradas
        ? true
        : s.estado === 'pendiente' || s.estado === 'en_proceso'
    )
    return [...lista].sort(
      (a, b) =>
        PRIORIDAD[a.estado] - PRIORIDAD[b.estado] ||
        b.created_at.localeCompare(a.created_at)
    )
  }, [sugerencias, mostrarCerradas])

  const pendientes = (sugerencias ?? []).filter(
    (s) => s.estado === 'pendiente'
  ).length

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[#6f3a2a] text-sm max-w-2xl">
          Productos que los clientes piden en el mostrador y todavía no tenemos.
          Asignales un proveedor, movelos de estado y, cuando decidas sumarlo,
          dalo de alta como producto del catálogo.
        </p>
        <label className="flex items-center gap-2 text-xs text-[#6f3a2a] cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={mostrarCerradas}
            onChange={(e) => setMostrarCerradas(e.target.checked)}
            className="accent-[#f9b44c] h-3.5 w-3.5"
          />
          Mostrar resueltas y descartadas
        </label>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl bg-[#f9d2a2]/30" />
          ))}
        </div>
      ) : isError ? (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-10 text-center text-[#c43e2c] text-sm">
          No se pudieron cargar las sugerencias.
        </div>
      ) : visibles.length === 0 ? (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-12 text-center">
          <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
            <Lightbulb className="h-6 w-6 text-[#6f3a2a]" />
          </div>
          <p className="text-[#391511] font-semibold">
            {pendientes === 0 && !mostrarCerradas
              ? 'No hay sugerencias pendientes'
              : 'Sin sugerencias para mostrar'}
          </p>
          <p className="text-[#6f3a2a] text-sm mt-1">
            Cuando un cajero anote un pedido de cliente desde el POS, va a
            aparecer acá.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visibles.map((s) => {
            const info = ESTADO_INFO[s.estado]
            return (
              <li
                key={s.id}
                className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-4 shadow-sm space-y-3"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-[#391511] leading-tight">
                        {s.texto}
                      </h3>
                      <span
                        className={cn(
                          'text-[10px] uppercase tracking-wider font-semibold rounded-full px-2 py-0.5',
                          info.cls
                        )}
                      >
                        {info.label}
                      </span>
                    </div>
                    {s.nota && (
                      <p className="text-sm text-[#6f3a2a] mt-1">{s.nota}</p>
                    )}
                    <p className="text-[11px] text-[#c8a58a] mt-1">
                      {s.usuario_nombre ? `${s.usuario_nombre} · ` : ''}
                      {formatearFechaHora(s.created_at)}
                    </p>
                  </div>
                </div>

                <div className="flex items-end gap-2 flex-wrap pt-2 border-t border-[#e4c9b0]/40">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold block">
                      Proveedor
                    </label>
                    <Select
                      items={itemsProveedores}
                      value={s.proveedor_id != null ? String(s.proveedor_id) : SIN_PROVEEDOR}
                      onValueChange={(v) =>
                        actualizar.mutate({
                          id: s.id,
                          cambios: {
                            proveedor_id:
                              !v || v === SIN_PROVEEDOR ? null : Number(v),
                          },
                        })
                      }
                    >
                      <SelectTrigger className="w-[200px] h-9 border-[#e4c9b0] bg-white text-sm">
                        <SelectValue placeholder="Sin asignar" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SIN_PROVEEDOR}>Sin asignar</SelectItem>
                        {proveedores?.map((p) => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            {p.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold block">
                      Estado
                    </label>
                    <Select
                      items={ESTADOS_LABEL}
                      value={s.estado}
                      onValueChange={(v) =>
                        v &&
                        actualizar.mutate({
                          id: s.id,
                          cambios: { estado: v as EstadoSugerencia },
                        })
                      }
                    >
                      <SelectTrigger className="w-[150px] h-9 border-[#e4c9b0] bg-white text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pendiente">Pendiente</SelectItem>
                        <SelectItem value="en_proceso">En proceso</SelectItem>
                        <SelectItem value="resuelta">Resuelta</SelectItem>
                        <SelectItem value="descartada">Descartada</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="ml-auto">
                    {s.producto ? (
                      <Link
                        href={`/inventario/${s.producto.id}`}
                        className={cn(
                          buttonVariants({ variant: 'outline', size: 'sm' }),
                          'border-[#2f7d4f]/40 text-[#2f7d4f] hover:bg-[#2f7d4f]/10 gap-1.5'
                        )}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Producto creado
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => setSugParaProducto(s)}
                        className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
                      >
                        <PackagePlus className="h-3.5 w-3.5" />
                        Dar de alta producto
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* Alta de producto desde la sugerencia: prellena nombre + proveedor y
          al crearse vincula el producto y marca la sugerencia como resuelta. */}
      <DrawerProducto
        abierto={sugParaProducto !== null}
        onCambioAbierto={(v) => !v && setSugParaProducto(null)}
        producto={null}
        nombreInicial={sugParaProducto?.texto}
        proveedorIdInicial={sugParaProducto?.proveedor_id ?? null}
        onCreado={(prod) => {
          if (sugParaProducto) {
            actualizar.mutate({
              id: sugParaProducto.id,
              cambios: { producto_id: prod.id, estado: 'resuelta' },
            })
          }
          setSugParaProducto(null)
        }}
      />
    </div>
  )
}
