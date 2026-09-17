'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Minus, PackageSearch, Plus } from 'lucide-react'
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
} from '@/lib/queries/ubicaciones'
import { useArbolUbicaciones, MAPA_KEY } from '@/lib/hooks/useMapa'
import { useCrearAjusteStock } from '@/lib/hooks/useAjustesStock'
import type { ItemAjustePayload } from '@/lib/queries/ajustesStock'
import {
  cantidadesIguales,
  formatearCantidad,
  redondearCantidad,
} from '@/lib/utils/formato'
import { EscanerCamara } from './EscanerCamara'
import { SelectorUbicacionMovil } from './SelectorUbicacionMovil'

interface Asignado {
  id: number
  nombre: string
  como: 'principal' | 'secundaria' | 'ya estaba'
  stock_sistema: number
  precio_costo: number
  venta_por_peso: boolean
  /** false = combo o sin control de stock: no se cuenta. */
  lleva_stock: boolean
  /** Lo contado, todavía sin guardar. */
  contado: string
  /** Resultado del último guardado: 'ok' = coincidía; número = diferencia. */
  conteo?: 'ok' | number
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
 * Con permiso de ajustes, cada producto de la lista se puede contar (TODO lo
 * que hay en el local) y un solo botón guarda todos los conteos juntos.
 */
export function AsignarUbicacionMovil({ usuarioId, puedeAjustar }: Props) {
  const { data: arbol } = useArbolUbicaciones()
  const qc = useQueryClient()
  const crear = useCrearAjusteStock()
  const [ubicacionId, setUbicacionId] = useState<number | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [asignados, setAsignados] = useState<Asignado[]>([])
  const inputs = useRef(new Map<number, HTMLInputElement>())

  const pendientes = asignados.filter((a) => {
    if (!a.lleva_stock) return false
    const n = contadoValido(a)
    return n != null && !(a.conteo !== undefined && a.contado === '')
  })
  const conDiferencia = pendientes.filter(
    (a) => !cantidadesIguales(contadoValido(a) as number, a.stock_sistema)
  )

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
          // Re-escanear conserva lo que ya se había tipeado.
          contado: anterior?.contado ?? '',
          conteo: anterior?.conteo,
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
      prev.map((a) => (a.id === id ? { ...a, contado: valor, conteo: undefined } : a))
    )
  }

  function sumar(id: number, delta: number) {
    setAsignados((prev) =>
      prev.map((a) =>
        a.id === id
          ? { ...a, contado: String(Math.max(0, (Number(a.contado) || 0) + delta)), conteo: undefined }
          : a
      )
    )
  }

  function guardarTodo() {
    if (pendientes.length === 0) return
    const marcarOk = (ids: Set<number>) =>
      setAsignados((prev) =>
        prev.map((a) => (ids.has(a.id) ? { ...a, contado: '', conteo: 'ok' as const } : a))
      )
    const iguales = new Set(
      pendientes.filter((a) => !conDiferencia.includes(a)).map((a) => a.id)
    )

    if (conDiferencia.length === 0) {
      marcarOk(iguales)
      toast.success('Todo coincide con el sistema: no hizo falta ajustar.')
      return
    }
    if (!usuarioId) {
      toast.error('No se pudo identificar tu usuario. Reingresá a la app.')
      return
    }
    const items: ItemAjustePayload[] = conDiferencia.map((a) => ({
      producto_id: a.id,
      nombre: a.nombre,
      tipo: 'ajuste',
      cantidad: redondearCantidad(contadoValido(a) as number, a.venta_por_peso),
      stock_actual: a.stock_sistema,
      precio_costo: a.precio_costo,
    }))
    crear.mutate(
      {
        usuario_id: usuarioId,
        razon: 'recuento',
        razon_detalle: 'Ubicar productos (modo móvil)',
        items,
      },
      {
        onSuccess: () => {
          const ajustados = new Map(items.map((it) => [it.producto_id, it]))
          setAsignados((prev) =>
            prev.map((a) => {
              const it = ajustados.get(a.id)
              if (it) {
                return {
                  ...a,
                  conteo: redondearCantidad(it.cantidad - a.stock_sistema, a.venta_por_peso),
                  stock_sistema: it.cantidad,
                  contado: '',
                }
              }
              if (iguales.has(a.id)) return { ...a, contado: '', conteo: 'ok' as const }
              return a
            })
          )
        },
      }
    )
  }

  return (
    <div className="space-y-4 pb-20">
      {arbol && (
        <SelectorUbicacionMovil arbol={arbol} valor={ubicacionId} onCambio={setUbicacionId} />
      )}

      {ubicacionId != null && (
        <EscanerCamara
          onDetectado={alEscanear}
          ayuda={
            puedeAjustar
              ? 'Escaneá y cargá abajo cuánto hay en todo el local'
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
            {puedeAjustar && ' · contá todo lo que hay en el local (góndola + depósito)'}
          </p>
          <ul className="space-y-2">
            {asignados.map((a) => {
              const n = contadoValido(a)
              const dif =
                n != null ? redondearCantidad(n - a.stock_sistema, a.venta_por_peso) : null
              return (
                <li
                  key={a.id}
                  className="rounded-xl border border-[#e4c9b0]/60 bg-white px-3 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#391511]">
                      {a.nombre}
                    </span>
                    {a.conteo !== undefined && (
                      <span
                        className={cn(
                          'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                          a.conteo === 'ok'
                            ? 'bg-[#2f7d4f]/10 text-[#2f7d4f]'
                            : 'bg-[#c43e2c]/10 text-[#9e2f25]'
                        )}
                      >
                        {a.conteo === 'ok'
                          ? 'stock ok'
                          : `ajustado ${a.conteo > 0 ? '+' : ''}${formatearCantidad(a.conteo, a.venta_por_peso)}`}
                      </span>
                    )}
                    <span
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
                    </span>
                  </div>

                  {puedeAjustar &&
                    (a.lleva_stock ? (
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
                          placeholder={a.venta_por_peso ? 'kg' : 'contado'}
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
                        <span
                          className={cn(
                            'w-14 shrink-0 text-right text-sm font-bold tabular-nums',
                            dif == null
                              ? 'text-transparent'
                              : cantidadesIguales(dif, 0)
                                ? 'text-[#2f7d4f]'
                                : dif > 0
                                  ? 'text-[#2f7d4f]'
                                  : 'text-[#c43e2c]'
                          )}
                        >
                          {dif == null
                            ? '·'
                            : cantidadesIguales(dif, 0)
                              ? '='
                              : `${dif > 0 ? '+' : ''}${formatearCantidad(dif, a.venta_por_peso)}`}
                        </span>
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-[#c8a58a]">No lleva stock (combo o sin control)</p>
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

      {puedeAjustar && pendientes.length > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-20 mx-auto max-w-md px-4">
          <Button
            type="button"
            onClick={guardarTodo}
            disabled={crear.isPending}
            className="h-14 w-full rounded-2xl bg-[#f9b44c] text-base font-bold text-[#391511] shadow-lg hover:bg-[#e4a42a]"
          >
            {crear.isPending ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Guardando…
              </>
            ) : (
              `Guardar ${pendientes.length} ${pendientes.length === 1 ? 'conteo' : 'conteos'}` +
              (conDiferencia.length > 0 ? ` · ${conDiferencia.length} con diferencia` : '')
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
