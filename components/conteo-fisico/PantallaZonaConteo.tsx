'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Loader2,
  Lock,
  Minus,
  Plus,
  RotateCcw,
  Search,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmacionAccion } from '@/components/shared/ConfirmacionAccion'
import { EstadoError } from '@/components/shared/EstadoError'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { EscanerCamara } from '@/components/movil/EscanerCamara'
import {
  buscarProductosParaConteo,
  getProductoConteoPorCodigo,
  type ProductoConteo,
} from '@/lib/queries/conteoFisico'
import {
  useCerrarZona,
  useConteosZona,
  useIniciarZona,
  useRegistrarConteo,
  useZonaConteo,
} from '@/lib/hooks/useConteoFisico'

const OBSERVACIONES_RAPIDAS = ['vencido', 'roto'] as const

interface Props {
  zonaId: number
}

/**
 * Pantalla de carga del empleado, pensada para usar con una mano parado
 * frente a la góndola. CIEGA a propósito: acá no existe el stock teórico.
 * Escaneás o buscás → cargás cuántos contaste → guardar → seguís.
 */
export function PantallaZonaConteo({ zonaId }: Props) {
  const { data, isLoading, isError, refetch } = useZonaConteo(zonaId)
  const { data: detalle, isLoading: cargandoDetalle } = useConteosZona(zonaId)

  const iniciar = useIniciarZona()
  const cerrar = useCerrarZona()
  const registrar = useRegistrarConteo()

  // Producto seleccionado para cargar cantidad.
  const [seleccionado, setSeleccionado] = useState<ProductoConteo | null>(null)
  const [cantidad, setCantidad] = useState('')
  const [observacion, setObservacion] = useState('')
  const [modoReconteo, setModoReconteo] = useState(false)

  // Búsqueda por nombre (el lector de barras escribe + Enter en este input).
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<ProductoConteo[]>([])
  const [buscando, setBuscando] = useState(false)
  const inputBusquedaRef = useRef<HTMLInputElement | null>(null)
  const inputCantidadRef = useRef<HTMLInputElement | null>(null)

  const [listaAbierta, setListaAbierta] = useState(false)
  const [confirmarCierre, setConfirmarCierre] = useState(false)

  const zona = data?.zona ?? null
  const sesion = data?.sesion ?? null

  const originales = useMemo(
    () => (detalle ?? []).filter((d) => !d.es_reconteo),
    [detalle]
  )
  const reconteos = useMemo(
    () => (detalle ?? []).filter((d) => d.es_reconteo),
    [detalle]
  )
  const pendientesReconteo = useMemo(
    () =>
      originales.filter(
        (o) =>
          o.reconteo_pedido &&
          !reconteos.some((r) => r.producto_id === o.producto_id)
      ),
    [originales, reconteos]
  )

  // Búsqueda por nombre con debounce cortito.
  useEffect(() => {
    const q = busqueda.trim()
    if (q.length < 2) {
      setResultados([])
      return
    }
    let cancelado = false
    setBuscando(true)
    const timer = setTimeout(async () => {
      try {
        const encontrados = await buscarProductosParaConteo(q)
        if (!cancelado) setResultados(encontrados)
      } catch {
        if (!cancelado) setResultados([])
      } finally {
        if (!cancelado) setBuscando(false)
      }
    }, 250)
    return () => {
      cancelado = true
      clearTimeout(timer)
    }
  }, [busqueda])

  function elegirProducto(prod: ProductoConteo, esReconteo: boolean) {
    setSeleccionado(prod)
    setModoReconteo(esReconteo)
    setObservacion('')
    if (esReconteo) {
      // Reconteo ciego: no se precarga nada, se cuenta de cero.
      setCantidad('')
    } else {
      const previo = originales.find((o) => o.producto_id === prod.id)
      setCantidad(previo ? String(previo.cantidad_contada) : '')
      setObservacion(previo?.observacion ?? '')
    }
    setBusqueda('')
    setResultados([])
    setTimeout(() => inputCantidadRef.current?.focus(), 50)
  }

  async function alEscanear(codigo: string) {
    try {
      const prod = await getProductoConteoPorCodigo(codigo)
      if (!prod) {
        toast.error(`No encontré un producto con el código ${codigo}`)
        return
      }
      const esPendiente = pendientesReconteo.some((p) => p.producto_id === prod.id)
      elegirProducto(prod, zona?.estado === 'cerrada' && esPendiente)
    } catch {
      toast.error('No se pudo buscar el producto. Probá de nuevo.')
    }
  }

  function enviarBusquedaConEnter() {
    const q = busqueda.trim()
    if (!q) return
    // Un lector USB/Bluetooth "tipea" el código y manda Enter.
    if (/^\d{6,}$/.test(q)) {
      void alEscanear(q)
      setBusqueda('')
      return
    }
    if (resultados.length === 1) elegirProducto(resultados[0], false)
  }

  function guardar() {
    if (!zona || !seleccionado) return
    const valor = Number(cantidad)
    if (cantidad.trim() === '' || Number.isNaN(valor) || valor < 0) {
      toast.error('Cargá la cantidad contada (0 o más).')
      return
    }
    registrar.mutate(
      {
        zona_id: zona.id,
        producto_id: seleccionado.id,
        cantidad: valor,
        observacion: observacion.trim() === '' ? null : observacion.trim(),
        es_reconteo: modoReconteo,
        nombre_producto: seleccionado.nombre,
      },
      {
        onSuccess: () => {
          setSeleccionado(null)
          setCantidad('')
          setObservacion('')
          setModoReconteo(false)
          setTimeout(() => inputBusquedaRef.current?.focus(), 50)
        },
      }
    )
  }

  function ajustarCantidad(delta: number) {
    const actual = Number(cantidad) || 0
    setCantidad(String(Math.max(0, actual + delta)))
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 py-6">
        <SkeletonTabla filas={5} columnas={2} />
      </div>
    )
  }
  if (isError || !zona) {
    return (
      <div className="mx-auto max-w-lg px-4 py-6">
        <EstadoError
          mensaje={
            isError
              ? undefined
              : 'No encontramos esta zona (o no tenés acceso a ella).'
          }
          onReintentar={() => refetch()}
        />
      </div>
    )
  }

  const sesionViva = sesion !== null && sesion.estado !== 'cerrada'
  const puedeContar = sesionViva && zona.estado === 'en_curso'
  const hayReconteosPendientes = pendientesReconteo.length > 0

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-4 pb-28">
      {/* Encabezado */}
      <div className="flex items-center gap-3">
        <Link
          href="/inventario/conteo"
          className="rounded-xl border border-[#e4c9b0] bg-white p-2 text-[#391511]"
          aria-label="Volver al conteo"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold text-[#391511]">
            {zona.nombre}
          </h1>
          <p className="truncate text-xs text-[#6f3a2a]">
            {sesion?.nombre ?? 'Sesión finalizada'} ·{' '}
            {zona.estado === 'pendiente' && 'sin iniciar'}
            {zona.estado === 'en_curso' && 'contando'}
            {zona.estado === 'cerrada' && 'zona cerrada'}
          </p>
        </div>
      </div>

      {/* Zona pendiente → iniciar */}
      {sesionViva && zona.estado === 'pendiente' && (
        <div className="space-y-3 rounded-2xl border border-[#e4c9b0]/70 bg-white p-5 text-center shadow-sm">
          <p className="text-sm text-[#6f3a2a]">
            Antes de arrancar: no repongan esta zona mientras se cuenta. Vas a
            escanear o buscar cada producto y cargar cuántas unidades hay.
          </p>
          <Button
            onClick={() => iniciar.mutate(zona.id)}
            disabled={iniciar.isPending}
            className="h-14 w-full rounded-2xl bg-[#f9b44c] text-base font-bold text-[#391511] hover:bg-[#e4a42a]"
          >
            {iniciar.isPending ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : null}
            {zona.responsable_user_id
              ? 'Iniciar conteo de la zona'
              : 'Tomar esta zona e iniciar'}
          </Button>
        </div>
      )}

      {/* Carga de conteo (zona en curso) */}
      {puedeContar && !seleccionado && (
        <>
          <EscanerCamara
            onDetectado={alEscanear}
            ayuda="Apuntá al código de barras del producto"
          />
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6f3a2a]" />
            <Input
              ref={inputBusquedaRef}
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && enviarBusquedaConEnter()}
              placeholder="Buscar por nombre o código…"
              className="h-12 border-[#e4c9b0] bg-white pl-9 text-base"
            />
          </div>
          {buscando && (
            <p className="flex items-center justify-center gap-2 text-sm text-[#6f3a2a]">
              <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
            </p>
          )}
          {resultados.length > 0 && (
            <ul className="space-y-1.5">
              {resultados.map((prod) => {
                const yaContado = originales.find(
                  (o) => o.producto_id === prod.id
                )
                return (
                  <li key={prod.id}>
                    <button
                      type="button"
                      onClick={() => elegirProducto(prod, false)}
                      className="flex w-full items-center justify-between gap-2 rounded-xl border border-[#e4c9b0]/70 bg-white px-3 py-2.5 text-left transition hover:border-[#f9b44c]"
                    >
                      <span className="min-w-0 truncate text-sm font-medium text-[#391511]">
                        {prod.nombre}
                      </span>
                      {yaContado && (
                        <span className="shrink-0 rounded-lg bg-[#2f7d4f]/12 px-2 py-0.5 text-xs font-semibold text-[#2f7d4f]">
                          ya: {yaContado.cantidad_contada}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      {/* Panel de cantidad */}
      {seleccionado && (
        <div className="space-y-4 rounded-2xl border border-[#e4c9b0]/70 bg-white p-4 shadow-sm">
          {modoReconteo && (
            <p className="rounded-xl bg-[#f9b44c]/15 px-3 py-2 text-xs font-semibold text-[#a3641c]">
              Reconteo: contá de nuevo desde cero, sin mirar lo anterior.
            </p>
          )}
          <p className="text-lg font-bold leading-snug text-[#391511]">
            {seleccionado.nombre}
          </p>
          <div>
            <label className="text-[10px] font-semibold uppercase text-[#6f3a2a]">
              ¿Cuántas unidades contaste en esta zona?
            </label>
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={() => ajustarCantidad(-1)}
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-[#e4c9b0] bg-white text-[#391511]"
                aria-label="Restar uno"
              >
                <Minus className="h-5 w-5" />
              </button>
              <Input
                ref={inputCantidadRef}
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && guardar()}
                placeholder="0"
                className="h-14 border-[#e4c9b0] text-center text-2xl font-bold tabular-nums"
              />
              <button
                type="button"
                onClick={() => ajustarCantidad(1)}
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-[#e4c9b0] bg-white text-[#391511]"
                aria-label="Sumar uno"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase text-[#6f3a2a]">
              Observación (opcional)
            </label>
            <div className="mt-1 flex items-center gap-2">
              {OBSERVACIONES_RAPIDAS.map((obs) => (
                <button
                  key={obs}
                  type="button"
                  onClick={() =>
                    setObservacion((prev) => (prev === obs ? '' : obs))
                  }
                  className={
                    observacion === obs
                      ? 'rounded-xl bg-[#c43e2c] px-3 py-2 text-sm font-semibold text-white'
                      : 'rounded-xl border border-[#e4c9b0] bg-white px-3 py-2 text-sm text-[#6f3a2a]'
                  }
                >
                  {obs === 'vencido' ? 'Vencido' : 'Roto'}
                </button>
              ))}
              <Input
                value={
                  observacion === 'vencido' || observacion === 'roto'
                    ? ''
                    : observacion
                }
                onChange={(e) => setObservacion(e.target.value)}
                placeholder="Otra…"
                className="h-10 flex-1 border-[#e4c9b0] text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSeleccionado(null)
                setCantidad('')
                setObservacion('')
                setModoReconteo(false)
              }}
              disabled={registrar.isPending}
              className="h-12 border-[#e4c9b0] text-[#6f3a2a]"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={guardar}
              disabled={registrar.isPending}
              className="h-12 flex-1 rounded-xl bg-[#f9b44c] text-base font-bold text-[#391511] hover:bg-[#e4a42a]"
            >
              {registrar.isPending ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <Check className="mr-2 h-5 w-5" />
              )}
              Guardar
            </Button>
          </div>
        </div>
      )}

      {/* Reconteos pendientes (zona cerrada, sesión en revisión) */}
      {sesionViva && zona.estado === 'cerrada' && hayReconteosPendientes && !seleccionado && (
        <div className="space-y-2 rounded-2xl border border-[#f9b44c] bg-[#f9b44c]/10 p-4">
          <p className="flex items-center gap-1.5 text-sm font-bold text-[#a3641c]">
            <RotateCcw className="h-4 w-4" />
            Reconteo pedido para {pendientesReconteo.length} producto/s
          </p>
          <p className="text-xs text-[#6f3a2a]">
            Lo tiene que contar una persona distinta a la que contó la primera
            vez. Tocá el producto y cargá lo que cuentes ahora.
          </p>
          <ul className="space-y-1.5">
            {pendientesReconteo.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() =>
                    elegirProducto(
                      {
                        id: p.producto_id,
                        nombre: p.productos?.nombre ?? `Producto #${p.producto_id}`,
                        codigo_barras: null,
                      },
                      true
                    )
                  }
                  className="w-full rounded-xl border border-[#e4c9b0]/70 bg-white px-3 py-2.5 text-left text-sm font-medium text-[#391511] transition hover:border-[#f9b44c]"
                >
                  {p.productos?.nombre ?? `Producto #${p.producto_id}`}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Zona cerrada sin nada pendiente */}
      {zona.estado === 'cerrada' && !hayReconteosPendientes && !seleccionado && (
        <div className="rounded-2xl border border-[#e4c9b0]/70 bg-white p-6 text-center shadow-sm">
          <Lock className="mx-auto h-8 w-8 text-[#2f7d4f]" />
          <p className="mt-2 font-semibold text-[#391511]">Zona cerrada</p>
          <p className="text-sm text-[#6f3a2a]">
            Se cargaron {originales.length} producto/s. ¡Gracias!
          </p>
        </div>
      )}

      {/* Ya contados (colapsable, sin teórico) */}
      {zona.estado === 'en_curso' && (
        <div className="rounded-2xl border border-[#e4c9b0]/70 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setListaAbierta((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-[#391511]"
          >
            <span>Ya contados en esta zona ({originales.length})</span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${listaAbierta ? 'rotate-180' : ''}`}
            />
          </button>
          {listaAbierta && (
            <ul className="space-y-1 border-t border-[#e4c9b0]/50 p-3">
              {cargandoDetalle && (
                <li className="text-center text-sm text-[#6f3a2a]">Cargando…</li>
              )}
              {originales.length === 0 && !cargandoDetalle && (
                <li className="text-center text-sm text-[#6f3a2a]">
                  Todavía no cargaste ningún producto.
                </li>
              )}
              {originales.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() =>
                      elegirProducto(
                        {
                          id: o.producto_id,
                          nombre: o.productos?.nombre ?? `Producto #${o.producto_id}`,
                          codigo_barras: null,
                        },
                        false
                      )
                    }
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[#fdfaf6]"
                  >
                    <span className="min-w-0 truncate text-[#391511]">
                      {o.productos?.nombre ?? `Producto #${o.producto_id}`}
                      {o.observacion && (
                        <span className="ml-1.5 text-xs text-[#c43e2c]">
                          ({o.observacion})
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 font-bold tabular-nums text-[#391511]">
                      {o.cantidad_contada}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Cerrar zona */}
      {puedeContar && !seleccionado && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-[#e4c9b0]/60 bg-[#fdfaf6]/95 p-3 backdrop-blur">
          <div className="mx-auto max-w-lg">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmarCierre(true)}
              className="h-12 w-full rounded-2xl border-[#391511]/30 font-semibold text-[#391511]"
            >
              <Lock className="mr-2 h-4 w-4" />
              Cerrar zona ({originales.length} producto/s)
            </Button>
          </div>
        </div>
      )}

      <ConfirmacionAccion
        abierto={confirmarCierre}
        onCambioAbierto={setConfirmarCierre}
        titulo={`¿Cerrar la zona "${zona.nombre}"?`}
        descripcion="Después de cerrarla no vas a poder seguir cargando productos acá (un encargado puede reabrirla si hace falta)."
        textoConfirmar="Cerrar zona"
        procesando={cerrar.isPending}
        onConfirmar={() =>
          cerrar.mutate(zona.id, { onSuccess: () => setConfirmarCierre(false) })
        }
      >
        <p>
          Cargaste <strong>{originales.length}</strong> producto/s en esta zona.
        </p>
      </ConfirmacionAccion>
    </div>
  )
}
