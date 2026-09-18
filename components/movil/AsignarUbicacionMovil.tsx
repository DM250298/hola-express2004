'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Loader2, Minus, PackageSearch, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { getProductoByBarcode } from '@/lib/queries/productos'
import {
  asignarUbicacionPrincipal,
  agregarUbicacionSecundaria,
  getUbicacionesProducto,
  rutaUbicacion,
} from '@/lib/queries/ubicaciones'
import {
  useArbolUbicaciones,
  useConteosParcialesAbiertos,
  useGuardarConteoUbicacion,
  MAPA_KEY,
} from '@/lib/hooks/useMapa'
import type { ItemConteoUbicacion } from '@/lib/queries/ubicaciones'
import type { UbicacionBreve } from '@/types/database'
import {
  cantidadesIguales,
  formatearCantidad,
  redondearCantidad,
} from '@/lib/utils/formato'
import { EscanerCamara } from './EscanerCamara'
import { SelectorUbicacionMovil } from './SelectorUbicacionMovil'
import {
  HojaUbicacionProducto,
  type UbicacionDelProducto,
} from './HojaUbicacionProducto'

/** Cómo terminó el último guardado de un producto. */
type Resultado =
  | { tipo: 'ok' }
  | { tipo: 'ajustado'; diferencia: number }
  | { tipo: 'pendiente'; faltan: UbicacionBreve[] }

interface Asignado {
  id: number
  nombre: string
  como: 'principal' | 'secundaria' | 'ya estaba'
  stock_sistema: number
  precio_costo: number
  venta_por_peso: boolean
  /** false = combo o sin control de stock: no se cuenta. */
  lleva_stock: boolean
  stock_minimo: number
  stock_maximo: number | null
  /** Todas las ubicaciones del producto, no solo esta. */
  ubicaciones: UbicacionDelProducto[]
  /** Lo contado EN ESTA ubicación, todavía sin guardar. */
  contado: string
  resultado?: Resultado
}

interface Props {
  usuarioId: string | null
  /** Permiso 'inventario_ajustes': habilita contar al escanear. */
  puedeAjustar: boolean
}

/** Conteo válido: número ≥ 0, entero salvo los productos por peso. */
function contadoValido(a: Asignado): number | null {
  const t = a.contado.trim()
  if (t === '') return null
  const n = Number(t)
  if (Number.isNaN(n) || n < 0) return null
  if (!a.venta_por_peso && !Number.isInteger(n)) return null
  return n
}

/**
 * Carga del mapa por escaneo en cadena: se elige góndola y estante, y se
 * escanean los productos uno atrás de otro. Ubicar es inmediato: PRINCIPAL si
 * el producto no tenía ninguna ubicación, si no SECUNDARIA.
 *
 * Con permiso de ajustes cada producto se cuenta, pero SOLO lo que se ve en
 * esta ubicación. Antes se pedía el total del local (góndola + depósito), que
 * parado en la góndola es imposible de saber. Ahora el que vive en un solo
 * lugar se ajusta al guardar, y el que está en dos o más queda esperando a que
 * alguien cuente la otra punta: recién ahí se suman y se toca el stock
 * (mig 207).
 */
export function AsignarUbicacionMovil({ usuarioId, puedeAjustar }: Props) {
  const { data: arbol } = useArbolUbicaciones()
  const qc = useQueryClient()
  const guardar = useGuardarConteoUbicacion()
  const { data: parciales } = useConteosParcialesAbiertos(puedeAjustar)
  const [ubicacionId, setUbicacionId] = useState<number | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [asignados, setAsignados] = useState<Asignado[]>([])
  const [hojaDe, setHojaDe] = useState<number | null>(null)
  const [verPendientes, setVerPendientes] = useState(false)
  const inputs = useRef(new Map<number, HTMLInputElement>())

  const pendientes = asignados.filter((a) => {
    if (!a.lleva_stock) return false
    return contadoValido(a) != null
  })

  // No perder conteos al cerrar o recargar la pestaña.
  useEffect(() => {
    if (pendientes.length === 0) return
    const avisar = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    // Los links internos (ej. "Volver") no disparan beforeunload.
    const alClickLink = (e: MouseEvent) => {
      const link = (e.target as HTMLElement | null)?.closest('a[href]')
      if (!link) return
      if (!window.confirm('Tenés conteos sin guardar. ¿Salir igual?')) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', avisar)
    document.addEventListener('click', alClickLink, true)
    return () => {
      window.removeEventListener('beforeunload', avisar)
      document.removeEventListener('click', alClickLink, true)
    }
  }, [pendientes.length])

  if (arbol === null) {
    return (
      <div className="rounded-2xl border-2 border-[#e4a42a]/50 bg-[#f9b44c]/10 p-5 text-sm text-[#6f3a2a]">
        Falta correr la migración 170 (mapa del local) para usar esta pantalla.
      </div>
    )
  }

  async function alEscanear(codigo: string) {
    if (!ubicacionId) {
      toast.error('Primero elegí dónde estás parado.')
      return
    }
    if (ocupado) return
    setOcupado(true)
    try {
      const prod = await getProductoByBarcode(codigo)
      if (!prod) {
        toast.error(`No encontré un producto con el código ${codigo}`)
        return
      }
      const filas = (await getUbicacionesProducto(prod.id)) ?? []
      const yaAca = filas.some((f) => f.ubicacion_id === ubicacionId)
      const tienePrincipal = filas.some((f) => f.es_principal)

      let como: Asignado['como']
      if (yaAca) {
        como = 'ya estaba'
      } else if (!tienePrincipal) {
        await asignarUbicacionPrincipal(prod.id, ubicacionId)
        como = 'principal'
      } else {
        await agregarUbicacionSecundaria(prod.id, ubicacionId)
        como = 'secundaria'
      }

      // La lista de ubicaciones que guardamos ya incluye la de este escaneo,
      // aunque la haya creado recién: es la que decide si el conteo espera.
      const ubicaciones: UbicacionDelProducto[] = yaAca
        ? filas.map((f) => ({ ubicacion_id: f.ubicacion_id, es_principal: f.es_principal }))
        : [
            ...filas.map((f) => ({
              ubicacion_id: f.ubicacion_id,
              es_principal: como === 'principal' ? false : f.es_principal,
            })),
            { ubicacion_id: ubicacionId, es_principal: como === 'principal' },
          ]

      const esCombo = prod.tipo === 'combo' || (prod.componentes?.length ?? 0) > 0
      setAsignados((prev) => {
        const anterior = prev.find((a) => a.id === prod.id)
        const fila: Asignado = {
          id: prod.id,
          nombre: prod.nombre,
          como: anterior && como === 'ya estaba' ? anterior.como : como,
          stock_sistema: Number(prod.stock_actual),
          precio_costo: Number(prod.precio_costo ?? 0),
          venta_por_peso: prod.venta_por_peso,
          lleva_stock: !esCombo && prod.controlar_stock !== false,
          stock_minimo: Number(prod.stock_minimo ?? 0),
          stock_maximo: prod.stock_maximo == null ? null : Number(prod.stock_maximo),
          ubicaciones,
          // Re-escanear conserva lo que ya se había tipeado.
          contado: anterior?.contado ?? '',
          resultado: anterior?.resultado,
        }
        return [fila, ...prev.filter((a) => a.id !== prod.id)]
      })

      if (como === 'ya estaba') toast.info(`${prod.nombre} ya estaba acá`)
      else toast.success(`${prod.nombre} → ${como}`)

      if (puedeAjustar) {
        setTimeout(() => inputs.current.get(prod.id)?.focus(), 50)
      }
      qc.invalidateQueries({ queryKey: [...MAPA_KEY, 'arbol'] })
      qc.invalidateQueries({ queryKey: [...MAPA_KEY, 'producto', prod.id] })
    } catch (e) {
      toast.error(`No se pudo asignar: ${e instanceof Error ? e.message : 'error'}`)
    } finally {
      setOcupado(false)
    }
  }

  function cambiarContado(id: number, valor: string) {
    setAsignados((prev) =>
      prev.map((a) => (a.id === id ? { ...a, contado: valor, resultado: undefined } : a))
    )
  }

  function sumar(id: number, delta: number) {
    setAsignados((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              contado: String(Math.max(0, (Number(a.contado) || 0) + delta)),
              resultado: undefined,
            }
          : a
      )
    )
  }

  /** Aplica al listado lo que devolvió la RPC. */
  function aplicarResultados(
    resultados: Awaited<ReturnType<typeof guardar.mutateAsync>>
  ) {
    const porId = new Map(resultados.map((r) => [r.producto_id, r]))
    // Los contadores salen de la respuesta y no del map de la lista: un cierre
    // desde el panel de pendientes toca productos que pueden no estar en ella.
    const ajustados = resultados.filter((r) => r.ajustado).length
    const caducados = resultados.filter((r) => r.sin_datos).length
    const esperando = resultados.filter((r) => !r.completo && !r.sin_datos).length
    setAsignados((prev) =>
      prev.map((a) => {
        const r = porId.get(a.id)
        if (!r || r.sin_datos) return a
        if (!r.completo) {
          return { ...a, contado: '', resultado: { tipo: 'pendiente', faltan: r.faltan } }
        }
        if (r.ajustado) {
          return {
            ...a,
            contado: '',
            stock_sistema: Number(r.total),
            resultado: {
              tipo: 'ajustado',
              diferencia: redondearCantidad(Number(r.diferencia), a.venta_por_peso),
            },
          }
        }
        return { ...a, contado: '', stock_sistema: Number(r.total), resultado: { tipo: 'ok' } }
      })
    )
    if (caducados > 0) {
      toast.error(
        'Ese conteo ya no está: venció o lo cerró otro. Contá de nuevo.'
      )
    }
    const partes: string[] = []
    if (ajustados > 0) partes.push(`${ajustados} ajustado${ajustados === 1 ? '' : 's'}`)
    if (esperando > 0) {
      partes.push(`${esperando} esperando la otra ubicación`)
    }
    if (partes.length > 0) toast.success(partes.join(' · '))
    else if (caducados === 0) toast.success('Todo coincide con el sistema')
  }

  async function guardarTodo() {
    if (pendientes.length === 0 || !ubicacionId) return
    if (!usuarioId) {
      toast.error('No se pudo identificar tu usuario. Reingresá a la app.')
      return
    }
    const items: ItemConteoUbicacion[] = pendientes.map((a) => ({
      producto_id: a.id,
      cantidad: redondearCantidad(contadoValido(a) as number, a.venta_por_peso),
    }))
    const resultados = await guardar.mutateAsync({
      usuarioId,
      ubicacionId,
      items,
    })
    aplicarResultados(resultados)
  }

  /** "Ya conté todo": cierra un pendiente asumiendo 0 en lo que falte. */
  async function cerrarPendiente(productoId: number) {
    if (!usuarioId) {
      toast.error('No se pudo identificar tu usuario. Reingresá a la app.')
      return
    }
    const resultados = await guardar.mutateAsync({
      usuarioId,
      ubicacionId: null,
      items: [{ producto_id: productoId, cantidad: 0 }],
      cerrar: true,
    })
    aplicarResultados(resultados)
  }

  const abierto = asignados.find((a) => a.id === hojaDe) ?? null
  const listaParciales = parciales ?? []

  return (
    <div className="space-y-4 pb-20">
      {arbol && (
        <SelectorUbicacionMovil arbol={arbol} valor={ubicacionId} onCambio={setUbicacionId} />
      )}

      {/* Lo que quedó a medias, propio o de otro empleado. */}
      {puedeAjustar && listaParciales.length > 0 && (
        <div className="rounded-2xl border border-[#e4a42a]/50 bg-[#f9b44c]/10">
          <button
            type="button"
            onClick={() => setVerPendientes((v) => !v)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-[#6f3a2a]"
          >
            <span className="flex-1">
              Falta contar · {listaParciales.length}{' '}
              {listaParciales.length === 1 ? 'producto' : 'productos'}
            </span>
            <ChevronDown
              className={cn('h-4 w-4 transition-transform', verPendientes && 'rotate-180')}
            />
          </button>
          {verPendientes && (
            <ul className="space-y-2 px-4 pb-4">
              {listaParciales.map((p) => (
                <li key={p.producto_id} className="rounded-xl bg-white px-3 py-2.5">
                  <p className="text-sm font-medium text-[#391511]">{p.producto_nombre}</p>
                  <p className="mt-0.5 text-xs text-[#6f3a2a]">
                    Contado {formatearCantidad(Number(p.contado), p.venta_por_peso)} · falta{' '}
                    {p.faltan.map((u) => u.nombre).join(', ') || 'nada'}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={guardar.isPending}
                    onClick={() => void cerrarPendiente(p.producto_id)}
                    className="mt-2 h-10 w-full border-[#e4c9b0] text-xs text-[#391511]"
                  >
                    Ya conté todo, cerrá con {formatearCantidad(Number(p.contado), p.venta_por_peso)}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {ubicacionId != null && (
        <EscanerCamara
          onDetectado={alEscanear}
          ayuda={
            puedeAjustar
              ? 'Escaneá y cargá solo lo que ves en esta ubicación'
              : 'Escaneá los productos de esta ubicación, uno atrás de otro'
          }
        />
      )}

      {ocupado && (
        <p className="flex items-center justify-center gap-2 text-sm text-[#6f3a2a]">
          <Loader2 className="h-4 w-4 animate-spin" /> Asignando…
        </p>
      )}

      {asignados.length > 0 ? (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#c8a58a]">
            Escaneados ({asignados.length})
            {puedeAjustar && ' · contá solo lo que hay acá; lo de otras ubicaciones se suma después'}
          </p>
          <ul className="space-y-2">
            {asignados.map((a) => {
              const n = contadoValido(a)
              const otras = a.ubicaciones.filter((u) => u.ubicacion_id !== ubicacionId)
              return (
                <li
                  key={a.id}
                  className="rounded-xl border border-[#e4c9b0]/60 bg-white px-3 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#391511]">
                      {a.nombre}
                    </span>
                    {a.resultado && (
                      <span
                        className={cn(
                          'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                          a.resultado.tipo === 'ok'
                            ? 'bg-[#2f7d4f]/10 text-[#2f7d4f]'
                            : a.resultado.tipo === 'pendiente'
                              ? 'bg-[#f9b44c]/25 text-[#9e6b15]'
                              : 'bg-[#c43e2c]/10 text-[#9e2f25]'
                        )}
                      >
                        {a.resultado.tipo === 'ok'
                          ? 'stock ok'
                          : a.resultado.tipo === 'pendiente'
                            ? `falta ${a.resultado.faltan.map((u) => u.nombre).join(', ')}`
                            : `ajustado ${a.resultado.diferencia > 0 ? '+' : ''}${formatearCantidad(a.resultado.diferencia, a.venta_por_peso)}`}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setHojaDe(a.id)}
                      className={cn(
                        'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                        a.como === 'principal'
                          ? 'bg-[#f9b44c]/25 text-[#9e6b15]'
                          : a.como === 'secundaria'
                            ? 'bg-[#1e5fb0]/10 text-[#1e5fb0]'
                            : 'bg-[#e4c9b0]/40 text-[#6f3a2a]'
                      )}
                    >
                      {a.como}
                    </button>
                  </div>

                  {puedeAjustar &&
                    (a.lleva_stock ? (
                      <>
                        <div className="mt-2 flex items-center gap-2">
                          <span className="w-20 shrink-0 text-xs text-[#6f3a2a]">
                            sistema{' '}
                            <strong className="tabular-nums text-[#391511]">
                              {formatearCantidad(a.stock_sistema, a.venta_por_peso)}
                            </strong>
                          </span>
                          {!a.venta_por_peso && (
                            <button
                              type="button"
                              onClick={() => sumar(a.id, -1)}
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#e4c9b0] text-[#391511] active:scale-95"
                              aria-label="Restar 1"
                            >
                              <Minus className="h-4 w-4" />
                            </button>
                          )}
                          <Input
                            ref={(el) => {
                              if (el) inputs.current.set(a.id, el)
                              else inputs.current.delete(a.id)
                            }}
                            type="number"
                            min="0"
                            step={a.venta_por_peso ? '0.001' : '1'}
                            inputMode={a.venta_por_peso ? 'decimal' : 'numeric'}
                            value={a.contado}
                            onChange={(e) => cambiarContado(a.id, e.target.value)}
                            placeholder={a.venta_por_peso ? 'kg acá' : 'hay acá'}
                            className="h-10 min-w-0 flex-1 border-[#e4c9b0] text-center tabular-nums"
                          />
                          {!a.venta_por_peso && (
                            <button
                              type="button"
                              onClick={() => sumar(a.id, 1)}
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#e4c9b0] text-[#391511] active:scale-95"
                              aria-label="Sumar 1"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          )}
                          {/* La diferencia contra el sistema solo tiene sentido
                              cuando este número ya es el total del local. */}
                          <span
                            className={cn(
                              'w-14 shrink-0 text-right text-sm font-bold tabular-nums',
                              n == null || otras.length > 0
                                ? 'text-transparent'
                                : cantidadesIguales(n, a.stock_sistema)
                                  ? 'text-[#2f7d4f]'
                                  : n > a.stock_sistema
                                    ? 'text-[#2f7d4f]'
                                    : 'text-[#c43e2c]'
                            )}
                          >
                            {n == null || otras.length > 0
                              ? '·'
                              : cantidadesIguales(n, a.stock_sistema)
                                ? '='
                                : `${n > a.stock_sistema ? '+' : ''}${formatearCantidad(redondearCantidad(n - a.stock_sistema, a.venta_por_peso), a.venta_por_peso)}`}
                          </span>
                        </div>
                        {otras.length > 0 && arbol && (
                          <p className="mt-1 text-xs text-[#9e6b15]">
                            También está en{' '}
                            {otras
                              .map((u) => rutaUbicacion(u.ubicacion_id, arbol.planas))
                              .join(' · ')}
                            : el stock se ajusta cuando se cuente allá.
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="mt-1 text-xs text-[#c8a58a]">
                        No lleva stock (combo o sin control)
                      </p>
                    ))}
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        ubicacionId != null &&
        !ocupado && (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[#e4c9b0] bg-white/60 p-6 text-center text-sm text-[#6f3a2a]">
            <PackageSearch className="h-6 w-6 text-[#c8a58a]" />
            Escaneá el primer producto de esta ubicación.
          </div>
        )
      )}

      {arbol && (
        <HojaUbicacionProducto
          abierto={abierto != null}
          producto={
            abierto
              ? {
                  id: abierto.id,
                  nombre: abierto.nombre,
                  venta_por_peso: abierto.venta_por_peso,
                  stock_minimo: abierto.stock_minimo,
                  stock_maximo: abierto.stock_maximo,
                }
              : null
          }
          ubicaciones={abierto?.ubicaciones ?? []}
          ubicacionActual={ubicacionId}
          arbol={arbol}
          onCerrar={() => setHojaDe(null)}
          onCambio={(ubicaciones) => {
            if (!abierto) return
            const sigueAca = ubicaciones.some((u) => u.ubicacion_id === ubicacionId)
            setAsignados((prev) =>
              prev
                // Si lo sacaron de acá ya no pinta en esta lista.
                .filter((a) => a.id !== abierto.id || sigueAca)
                .map((a) =>
                  a.id === abierto.id
                    ? {
                        ...a,
                        ubicaciones,
                        como: ubicaciones.some(
                          (u) => u.ubicacion_id === ubicacionId && u.es_principal
                        )
                          ? 'principal'
                          : 'secundaria',
                      }
                    : a
                )
            )
            if (!sigueAca) setHojaDe(null)
          }}
          onMinMax={(minimo, maximo) => {
            if (!abierto) return
            setAsignados((prev) =>
              prev.map((a) =>
                a.id === abierto.id
                  ? { ...a, stock_minimo: minimo, stock_maximo: maximo }
                  : a
              )
            )
          }}
        />
      )}

      {puedeAjustar && pendientes.length > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-20 mx-auto max-w-md px-4">
          <Button
            type="button"
            onClick={() => void guardarTodo()}
            disabled={guardar.isPending}
            className="h-14 w-full rounded-2xl bg-[#f9b44c] text-base font-bold text-[#391511] shadow-lg hover:bg-[#e4a42a]"
          >
            {guardar.isPending ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Guardando…
              </>
            ) : (
              `Guardar ${pendientes.length} ${pendientes.length === 1 ? 'conteo' : 'conteos'}`
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
