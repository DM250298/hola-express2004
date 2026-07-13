'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Calendar,
  Check,
  ChevronLeft,
  Loader2,
  PackageCheck,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ModalClaveSupervisor } from '@/components/compras/ModalClaveSupervisor'
import { EscanerCamara } from './EscanerCamara'
import {
  useActualizarEstadoPedido,
  usePedidoDetalle,
  useRecibirPedido,
} from '@/lib/hooks/usePedidos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { useCategorias } from '@/lib/hooks/useCategorias'
import { agregarItemPedido, parsearDiasCondicionPago } from '@/lib/queries/pedidos'
import {
  createProducto,
  getProductoByBarcode,
  getProductos,
  toggleProductoActivo,
} from '@/lib/queries/productos'
import { formatearFechaCorta } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'

interface ItemEstado {
  item_id: number
  producto_id: number
  nombre: string
  codigo_barras: string | null
  cantidad_pedida: number
  /** Lo ya recibido en entregas anteriores (acumulado en la DB). */
  ya_recibido: number
  /** Costo de la línea (no se muestra en pantalla, pero viaja en la recepción). */
  precio_costo: number
  /** Lo que se recibe en ESTA entrega (input controlado). */
  cantidad_recibida: string
  fecha_vencimiento: string
  dias_vencimiento_minimo: number | null
  /** Factura de esta entrega a la que se imputa el renglón (ref local). */
  factura_ref: string
}

/** Una factura de la entrega (varias por pedido). `ref` es un id local estable. */
interface FacturaEntrega {
  ref: string
  numero: string
}

/** Datos mínimos de un producto para sumarlo a la recepción (buscado o creado). */
interface ProdParaAgregar {
  id: number
  nombre: string
  codigo_barras: string | null
  activo: boolean
  dias_vencimiento_minimo: number | null
}

/** Reduce un producto del catálogo (Row/ConRelaciones) a lo que necesita la recepción. */
function aProdParaAgregar(p: {
  id: number
  nombre: string
  codigo_barras: string | null
  activo: boolean
  dias_vencimiento_minimo: number | null
}): ProdParaAgregar {
  return {
    id: p.id,
    nombre: p.nombre,
    codigo_barras: p.codigo_barras,
    activo: p.activo,
    dias_vencimiento_minimo: p.dias_vencimiento_minimo,
  }
}

interface Props {
  pedidoId: number
}

/**
 * Recepción de un pedido desde el teléfono: escaneo con cámara (cada lectura
 * suma 1 al producto, editable), fecha de vencimiento opcional por ítem, clave
 * de supervisor si se recibe de más, y registro atómico vía `fn_recibir_pedido`.
 * No muestra precios/costos. Permite agregar un producto que no estaba en la
 * orden (creándolo si hace falta).
 */
export function RecepcionMovil({ pedidoId }: Props) {
  const router = useRouter()
  const { data: usuario } = useUsuario()
  const { data: pedido, isLoading } = usePedidoDetalle(pedidoId)
  const { data: categorias } = useCategorias()
  const recibir = useRecibirPedido()
  const cambiarEstado = useActualizarEstadoPedido()

  const [itemsEstado, setItemsEstado] = useState<ItemEstado[]>([])
  // Facturas de esta entrega (una deuda por factura). Empieza con una.
  const [facturas, setFacturas] = useState<FacturaEntrega[]>([
    { ref: 'f1', numero: '' },
  ])
  const [facturaActivaRef, setFacturaActivaRef] = useState('f1')
  const contadorFacturaRef = useRef(1)
  const [aceptaPorDebajoMin, setAceptaPorDebajoMin] = useState(false)
  const [excesoAutorizado, setExcesoAutorizado] = useState(false)
  const [autorizadoPor, setAutorizadoPor] = useState<string | null>(null)
  const [modalSupervisorAbierto, setModalSupervisorAbierto] = useState(false)
  const cerrarTrasRecepcion = useRef(false)

  // Producto activo (último escaneado): se resalta y se enfoca su campo para
  // cargar la cantidad total. El escaneo deja de ser un "+1" como protagonista.
  const [activoId, setActivoId] = useState<number | null>(null)
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({})

  // Alta / búsqueda de producto que no está en el pedido
  const [ultimoNoEncontrado, setUltimoNoEncontrado] = useState('')
  const [modalNuevoAbierto, setModalNuevoAbierto] = useState(false)
  const [nuevoCodigo, setNuevoCodigo] = useState('')
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoPrecio, setNuevoPrecio] = useState('')
  const [nuevoCategoria, setNuevoCategoria] = useState('')
  const [nuevoCantidad, setNuevoCantidad] = useState('')
  const [nuevoVenc, setNuevoVenc] = useState('')
  const [guardandoNuevo, setGuardandoNuevo] = useState(false)
  // Búsqueda en el catálogo para sumar un producto existente (aunque no sea de
  // este proveedor ni esté en el pedido).
  const [busquedaProd, setBusquedaProd] = useState('')
  const [busquedaDebounced, setBusquedaDebounced] = useState('')
  const [productoSeleccionado, setProductoSeleccionado] =
    useState<ProdParaAgregar | null>(null)

  useEffect(() => {
    if (!pedido) return
    setItemsEstado(
      pedido.items.map((it) => ({
        item_id: it.id,
        producto_id: it.producto_id,
        nombre: it.producto?.nombre ?? 'Producto eliminado',
        codigo_barras: it.producto?.codigo_barras ?? null,
        cantidad_pedida: it.cantidad_pedida,
        ya_recibido: it.cantidad_recibida ?? 0,
        precio_costo: it.precio_costo,
        cantidad_recibida: '',
        fecha_vencimiento: '',
        dias_vencimiento_minimo: it.producto?.dias_vencimiento_minimo ?? null,
        factura_ref: 'f1',
      }))
    )
    // Arranca cada pedido con una sola factura.
    setFacturas([{ ref: 'f1', numero: '' }])
    setFacturaActivaRef('f1')
    contadorFacturaRef.current = 1
    setAceptaPorDebajoMin(false)
    setExcesoAutorizado(false)
    setAutorizadoPor(null)
  }, [pedido])

  // ── Facturas de la entrega ──────────────────────────────────────────
  function agregarFactura() {
    contadorFacturaRef.current += 1
    const ref = `f${contadorFacturaRef.current}`
    setFacturas((prev) => [...prev, { ref, numero: '' }])
    setFacturaActivaRef(ref)
  }

  function quitarFactura(ref: string) {
    if (facturas.length <= 1) return
    const restantes = facturas.filter((f) => f.ref !== ref)
    const destino = restantes[0].ref
    // Los renglones de la factura borrada pasan a la primera que quede.
    setItemsEstado((prev) =>
      prev.map((it) =>
        it.factura_ref === ref ? { ...it, factura_ref: destino } : it
      )
    )
    setFacturas(restantes)
    if (facturaActivaRef === ref) setFacturaActivaRef(destino)
  }

  function cambiarNumeroFactura(ref: string, numero: string) {
    setFacturas((prev) =>
      prev.map((f) => (f.ref === ref ? { ...f, numero } : f))
    )
  }

  function moverItemAFactura(item_id: number, ref: string) {
    setItemsEstado((prev) =>
      prev.map((it) => (it.item_id === item_id ? { ...it, factura_ref: ref } : it))
    )
  }

  function actualizarItem(
    item_id: number,
    cambios: Partial<Pick<ItemEstado, 'cantidad_recibida' | 'fecha_vencimiento'>>
  ) {
    setItemsEstado((prev) =>
      prev.map((it) => (it.item_id === item_id ? { ...it, ...cambios } : it))
    )
  }

  /** Botón secundario: suma 1 unidad al producto (para los que prefieren tallar). */
  function sumarUno(item_id: number) {
    setItemsEstado((prev) =>
      prev.map((it) =>
        it.item_id === item_id
          ? {
              ...it,
              cantidad_recibida: String((Number(it.cantidad_recibida) || 0) + 1),
            }
          : it
      )
    )
  }

  // Al marcar un producto como activo (recién escaneado), enfocamos su campo
  // para que cargue la cantidad total directamente.
  useEffect(() => {
    if (activoId == null) return
    const el = inputRefs.current[activoId]
    if (el) {
      el.focus()
      try {
        el.select()
      } catch {
        // algunos navegadores no permiten select() en input number — se ignora
      }
    }
  }, [activoId])

  // Debounce del texto de búsqueda del modal "Agregar producto".
  useEffect(() => {
    const t = setTimeout(() => setBusquedaDebounced(busquedaProd.trim()), 250)
    return () => clearTimeout(t)
  }, [busquedaProd])

  // Búsqueda en el catálogo (por nombre o código). Solo corre con el modal
  // abierto y al menos 2 caracteres, para no bajar todo el catálogo de gusto.
  // Incluye inactivos a propósito: si el producto ya existe (aunque esté dado de
  // baja) queremos reusarlo en vez de crear un duplicado; al sumarlo se reactiva.
  const { data: resultadosBusqueda, isFetching: buscandoProd } = useQuery({
    queryKey: ['recepcion-buscar-producto', busquedaDebounced],
    queryFn: () => getProductos({ busqueda: busquedaDebounced }),
    enabled: modalNuevoAbierto && busquedaDebounced.length >= 2,
    staleTime: 30 * 1000,
  })

  /**
   * Escaneo: trae el producto al tope de la lista, lo resalta y enfoca su campo
   * para cargar la cantidad TOTAL (no suma de a 1). El "+1" queda como botón.
   */
  function alEscanear(codigo: string) {
    // Con el buscador abierto ignoramos lecturas (evita re-disparos de la cámara).
    if (modalNuevoAbierto) return
    const item = itemsEstado.find((it) => it.codigo_barras === codigo)
    if (!item) {
      // No está en el pedido: abrimos el buscador con el código cargado. Si el
      // producto existe en el catálogo (aunque no sea de este proveedor) aparece
      // como resultado para sumarlo; si no existe, se puede crear.
      abrirBuscadorConCodigo(codigo)
      toast.error('No está en el pedido. Buscalo o cargalo para sumarlo.')
      return
    }
    // Si ya es el activo, ignorar (evita que la cámara lo re-dispare al tipear).
    if (activoId === item.item_id) return
    setActivoId(item.item_id)
    // Al escanear, el renglón se imputa a la factura activa (así separás por
    // factura escaneando bajo cada una).
    setItemsEstado((prev) => {
      const sel = prev.find((it) => it.item_id === item.item_id)
      if (!sel) return prev
      const actualizado = { ...sel, factura_ref: facturaActivaRef }
      return [actualizado, ...prev.filter((it) => it.item_id !== item.item_id)]
    })
    toast.success(`${item.nombre} — cargá la cantidad`)
  }

  /** Total de unidades de esta entrega (habilita el botón; no usa plata). */
  const totalUnidades = useMemo(
    () =>
      itemsEstado.reduce(
        (acc, it) => acc + (Number(it.cantidad_recibida) || 0),
        0
      ),
    [itemsEstado]
  )

  const condicionDias = parsearDiasCondicionPago(
    pedido?.proveedor_completo?.condicion_pago
  )
  const fechaVencimientoCuenta = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + condicionDias)
    return d.toISOString().slice(0, 10)
  }, [condicionDias])

  const hayErrores = itemsEstado.some(
    (it) =>
      it.cantidad_recibida !== '' &&
      (Number.isNaN(Number(it.cantidad_recibida)) ||
        Number(it.cantidad_recibida) < 0)
  )

  const itemsConExceso = useMemo(
    () =>
      itemsEstado.filter(
        (it) =>
          it.ya_recibido + (Number(it.cantidad_recibida) || 0) >
          it.cantidad_pedida
      ),
    [itemsEstado]
  )
  const requiereSupervisor = itemsConExceso.length > 0 && !excesoAutorizado

  const esParcial = useMemo(() => {
    const pedidoTotal = itemsEstado.reduce(
      (acc, it) => acc + it.cantidad_pedida,
      0
    )
    const recibidoTotal = itemsEstado.reduce(
      (acc, it) => acc + it.ya_recibido + (Number(it.cantidad_recibida) || 0),
      0
    )
    return recibidoTotal < pedidoTotal
  }, [itemsEstado])

  const itemsPorDebajoMinimo = useMemo(() => {
    return itemsEstado.flatMap((it) => {
      const min = it.dias_vencimiento_minimo
      if (min == null || !it.fecha_vencimiento) return []
      const cant = Number(it.cantidad_recibida) || 0
      if (cant <= 0) return []
      const hoy = new Date()
      hoy.setHours(0, 0, 0, 0)
      const venc = new Date(`${it.fecha_vencimiento}T00:00:00`)
      const dias = Math.floor(
        (venc.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24)
      )
      if (dias >= min) return []
      return [{ ...it, diasReales: dias, diasMinimo: min }]
    })
  }, [itemsEstado])

  const requiereAceptacion =
    itemsPorDebajoMinimo.length > 0 && !aceptaPorDebajoMin

  // Con 2+ facturas, cada una con mercadería tiene que tener número: si dos
  // quedaran sin número, el sistema no podría separarlas en deudas distintas.
  const facturasSinNumero = useMemo(() => {
    if (facturas.length <= 1) return []
    return facturas.filter((f) => {
      if (f.numero.trim()) return false
      const uds = itemsEstado
        .filter((it) => it.factura_ref === f.ref)
        .reduce((a, it) => a + (Number(it.cantidad_recibida) || 0), 0)
      return uds > 0
    })
  }, [facturas, itemsEstado])

  const procesando = recibir.isPending || cambiarEstado.isPending
  const accionDeshabilitada =
    procesando ||
    hayErrores ||
    totalUnidades <= 0 ||
    requiereAceptacion ||
    facturasSinNumero.length > 0

  function confirmar(cerrarPedido: boolean) {
    if (!usuario || hayErrores || !pedido?.proveedor) return
    cerrarTrasRecepcion.current = cerrarPedido
    if (requiereSupervisor) {
      setModalSupervisorAbierto(true)
      return
    }
    ejecutarRecepcion(cerrarPedido)
  }

  function ejecutarRecepcion(cerrarPedido: boolean) {
    if (!usuario || !pedido?.proveedor) return
    recibir.mutate(
      {
        pedido_id: pedido.id,
        proveedor_id: pedido.proveedor.id,
        usuario_id: usuario.id,
        condicion_pago_dias: condicionDias,
        items: itemsEstado.map((it) => ({
          item_id: it.item_id,
          producto_id: it.producto_id,
          cantidad_recibida: Math.max(0, Number(it.cantidad_recibida) || 0),
          precio_costo: it.precio_costo,
          fecha_vencimiento: it.fecha_vencimiento || null,
          factura_ref: it.factura_ref,
          numero_factura:
            facturas.find((f) => f.ref === it.factura_ref)?.numero.trim() || null,
        })),
      },
      {
        onSuccess: (resultado) => {
          if (cerrarPedido && resultado.es_parcial) {
            cambiarEstado.mutate({ id: pedido.id, estado: 'recibido' })
          }
          router.push('/movil/recepcion')
        },
      }
    )
  }

  /** Suma un producto (ya existente en el catálogo) a esta recepción. */
  async function agregarProductoALista(
    prod: ProdParaAgregar,
    cant: number,
    venc: string
  ) {
    const yaEnLista = itemsEstado.find((it) => it.producto_id === prod.id)
    if (yaEnLista) {
      // Ya estaba en la lista: en vez de descartar la cantidad tipeada, la
      // aplicamos al ítem existente y lo resaltamos.
      setItemsEstado((prev) =>
        prev.map((it) =>
          it.producto_id === prod.id
            ? {
                ...it,
                cantidad_recibida: String(cant),
                fecha_vencimiento: venc || it.fecha_vencimiento,
              }
            : it
        )
      )
      setActivoId(yaEnLista.item_id)
      toast.info(`${prod.nombre} ya estaba en la lista — actualicé la cantidad.`)
      return
    }
    // Si estaba dado de baja, lo reactivamos: si no, el stock recibido quedaría
    // en un producto oculto del POS/inventario.
    if (!prod.activo) {
      try {
        await toggleProductoActivo(prod.id, true)
      } catch {
        // Si falla la reactivación no bloqueamos la recepción; se corrige a mano.
      }
    }
    const nuevoItem = await agregarItemPedido({
      pedido_id: pedidoId,
      producto_id: prod.id,
      cantidad: cant,
      precio_costo: 0,
    })
    setItemsEstado((prev) => [
      ...prev,
      {
        item_id: nuevoItem.id,
        producto_id: prod.id,
        nombre: prod.nombre,
        codigo_barras: prod.codigo_barras,
        cantidad_pedida: cant,
        ya_recibido: 0,
        precio_costo: 0,
        cantidad_recibida: String(cant),
        fecha_vencimiento: venc,
        dias_vencimiento_minimo: prod.dias_vencimiento_minimo,
        factura_ref: facturaActivaRef,
      },
    ])
    setActivoId(nuevoItem.id)
    toast.success(`${prod.nombre} agregado al pedido`)
  }

  /**
   * Confirma el modal: si hay un producto seleccionado del buscador lo suma;
   * si no, intenta encontrarlo por código exacto y, si tampoco existe, crea uno
   * nuevo con los datos cargados. En todos los casos queda como recibido.
   */
  async function agregarAlPedido() {
    const cant = Number(nuevoCantidad)
    if (!Number.isFinite(cant) || cant <= 0) {
      toast.error('Poné cuántas unidades llegaron.')
      return
    }
    setGuardandoNuevo(true)
    try {
      let prod: ProdParaAgregar | null = productoSeleccionado
      if (!prod) {
        const cod = nuevoCodigo.trim()
        // Red de seguridad: si el código ya existe, se reutiliza ese producto.
        if (cod) {
          const encontrado = await getProductoByBarcode(cod)
          if (encontrado) prod = aProdParaAgregar(encontrado)
        }
      }
      if (!prod) {
        if (!nuevoNombre.trim()) {
          toast.error('Buscá el producto, o poné el nombre para crearlo.')
          setGuardandoNuevo(false)
          return
        }
        const precio = Number(nuevoPrecio)
        if (!Number.isFinite(precio) || precio <= 0) {
          toast.error('Poné el precio de venta para crear el producto.')
          setGuardandoNuevo(false)
          return
        }
        const creado = await createProducto({
          nombre: nuevoNombre.trim(),
          precio_venta: precio,
          codigo_barras: nuevoCodigo.trim() || null,
          categoria_id: nuevoCategoria ? Number(nuevoCategoria) : null,
        })
        prod = aProdParaAgregar(creado)
      }

      await agregarProductoALista(prod, cant, nuevoVenc)
      cerrarModalNuevo()
    } catch (e) {
      toast.error(`No se pudo agregar: ${(e as Error).message}`)
    } finally {
      setGuardandoNuevo(false)
    }
  }

  /** Elige un producto de los resultados de búsqueda. */
  function seleccionarProducto(p: ProdParaAgregar) {
    setProductoSeleccionado(aProdParaAgregar(p))
    setBusquedaProd('')
    setBusquedaDebounced('')
  }

  /** Limpia y cierra el modal de agregar/buscar producto. */
  function cerrarModalNuevo() {
    setModalNuevoAbierto(false)
    setBusquedaProd('')
    setBusquedaDebounced('')
    setProductoSeleccionado(null)
    setNuevoCodigo('')
    setNuevoNombre('')
    setNuevoPrecio('')
    setNuevoCategoria('')
    setNuevoCantidad('')
    setNuevoVenc('')
    setUltimoNoEncontrado('')
  }

  /** Abre el buscador con un código precargado (desde un escaneo no reconocido). */
  function abrirBuscadorConCodigo(codigo: string) {
    setUltimoNoEncontrado(codigo)
    setProductoSeleccionado(null)
    setBusquedaProd(codigo)
    setNuevoCodigo(codigo)
    setNuevoNombre('')
    setNuevoPrecio('')
    setNuevoCategoria('')
    setNuevoCantidad('')
    setNuevoVenc('')
    setModalNuevoAbierto(true)
  }

  /** Abre el buscador vacío (botón manual). */
  function abrirNuevoProducto() {
    setProductoSeleccionado(null)
    setBusquedaProd(ultimoNoEncontrado)
    setNuevoCodigo(ultimoNoEncontrado)
    setNuevoNombre('')
    setNuevoPrecio('')
    setNuevoCategoria('')
    setNuevoCantidad('')
    setNuevoVenc('')
    setModalNuevoAbierto(true)
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-md px-4 py-10 text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-[#9e6b15]" />
        <p className="mt-2 text-sm text-[#6f3a2a]">Cargando el pedido…</p>
      </div>
    )
  }

  if (!pedido) {
    return (
      <div className="mx-auto max-w-md px-4 py-10 text-center">
        <p className="font-semibold text-[#391511]">No se encontró el pedido.</p>
        <Link
          href="/movil/recepcion"
          className="mt-2 inline-block text-sm font-medium text-[#9e6b15]"
        >
          Volver a la lista
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md px-4 py-4 pb-40">
      <header className="mb-3">
        <Link
          href="/movil/recepcion"
          className="flex items-center gap-1 text-sm font-medium text-[#6f3a2a]"
        >
          <ChevronLeft className="h-4 w-4" /> Volver
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-xl font-extrabold text-[#391511]">
          <PackageCheck className="h-5 w-5 text-[#f9b44c]" />
          Pedido #{pedido.id}
        </h1>
        <p className="text-sm text-[#6f3a2a]">
          {pedido.proveedor?.nombre ?? 'Proveedor'} · cuenta vence el{' '}
          {formatearFechaCorta(fechaVencimientoCuenta)}
        </p>
      </header>

      <div className="mb-4">
        <EscanerCamara
          onDetectado={alEscanear}
          ayuda="Escaneá un producto y cargá cuántas llegaron"
        />
      </div>

      {/* Facturas de esta entrega — una deuda por factura */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6f3a2a]">
            Facturas de esta entrega
          </p>
          <button
            type="button"
            onClick={agregarFactura}
            className="flex items-center gap-1 text-xs font-semibold text-[#9e6b15] active:scale-95"
          >
            <Plus className="h-3.5 w-3.5" /> Agregar factura
          </button>
        </div>

        <div className="space-y-1.5">
          {facturas.map((f, idx) => {
            const activa = f.ref === facturaActivaRef
            const items = itemsEstado.filter((it) => it.factura_ref === f.ref)
            const uds = items.reduce(
              (a, it) => a + (Number(it.cantidad_recibida) || 0),
              0
            )
            return (
              <div
                key={f.ref}
                onClick={() => setFacturaActivaRef(f.ref)}
                className={cn(
                  'rounded-xl border p-2.5 transition',
                  activa
                    ? 'border-[#f9b44c] bg-[#f9b44c]/10 ring-1 ring-[#f9b44c]/40'
                    : 'border-[#e4c9b0]/70 bg-white'
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                      activa
                        ? 'bg-[#f9b44c] text-[#391511]'
                        : 'bg-[#e4c9b0]/60 text-[#6f3a2a]'
                    )}
                  >
                    {idx + 1}
                  </span>
                  <Input
                    value={f.numero}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => cambiarNumeroFactura(f.ref, e.target.value)}
                    placeholder={`N° de la factura ${idx + 1}`}
                    className="h-9 flex-1 border-[#e4c9b0] text-sm focus-visible:ring-[#f9b44c]"
                  />
                  {facturas.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        quitarFactura(f.ref)
                      }}
                      className="shrink-0 text-[#c8a58a] active:text-[#c43e2c]"
                      aria-label="Quitar factura"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <p className="mt-1 pl-8 text-[10px] text-[#6f3a2a]">
                  {activa && (
                    <span className="font-semibold text-[#9e6b15]">Activa · </span>
                  )}
                  {items.length} {items.length === 1 ? 'producto' : 'productos'} ·{' '}
                  {uds} u.
                </p>
              </div>
            )
          })}
        </div>

        {facturas.length > 1 && facturasSinNumero.length > 0 && (
          <p className="mt-1.5 flex items-start gap-1 text-[10px] leading-snug text-[#c43e2c]">
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
            Poné el número de cada factura con productos para poder separarlas en
            deudas distintas.
          </p>
        )}
        {facturas.length > 1 && facturasSinNumero.length === 0 && (
          <p className="mt-1.5 text-[10px] leading-snug text-[#6f3a2a]">
            Lo que escaneés/cargues se imputa a la factura{' '}
            <strong>activa</strong>. Tocá una factura para activarla, o cambiá la
            factura de un producto con el selector de su fila.
          </p>
        )}
      </div>

      {excesoAutorizado && autorizadoPor && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-[#2f7d4f]/30 bg-[#2f7d4f]/10 px-3 py-2 text-xs text-[#2f7d4f]">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          Exceso autorizado por <span className="font-semibold">{autorizadoPor}</span>.
        </div>
      )}

      <ul className="space-y-2">
        {itemsEstado.map((it) => {
          const cantNum = Number(it.cantidad_recibida) || 0
          const diferencia = it.ya_recibido + cantNum - it.cantidad_pedida
          const activo = it.item_id === activoId
          return (
            <li
              key={it.item_id}
              className={cn(
                'rounded-2xl border bg-white p-3 shadow-sm transition',
                activo
                  ? 'border-[#f9b44c] ring-2 ring-[#f9b44c]/40'
                  : 'border-[#e4c9b0]/70'
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-[#391511]">{it.nombre}</p>
                  <p className="text-xs text-[#6f3a2a]">
                    Pedido:{' '}
                    <span className="font-semibold tabular-nums">
                      {it.cantidad_pedida}
                    </span>
                    {it.ya_recibido > 0 && (
                      <>
                        {' '}
                        · ya recibido{' '}
                        <span className="font-semibold tabular-nums">
                          {it.ya_recibido}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                {facturas.length > 1 && (
                  <select
                    value={it.factura_ref}
                    onChange={(e) => moverItemAFactura(it.item_id, e.target.value)}
                    aria-label="Factura del producto"
                    className="h-8 shrink-0 rounded-md border border-[#e4c9b0] bg-white px-1.5 text-[11px] font-medium text-[#391511] focus:outline-none focus:ring-2 focus:ring-[#f9b44c]"
                  >
                    {facturas.map((f, idx) => (
                      <option key={f.ref} value={f.ref}>
                        F{idx + 1}
                        {f.numero ? ` · ${f.numero}` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a]">
                    Recibido
                  </Label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      ref={(el) => {
                        inputRefs.current[it.item_id] = el
                      }}
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      value={it.cantidad_recibida}
                      onChange={(e) =>
                        actualizarItem(it.item_id, {
                          cantidad_recibida: e.target.value,
                        })
                      }
                      placeholder="0"
                      className="h-12 flex-1 border-[#e4c9b0] text-lg tabular-nums focus-visible:ring-[#f9b44c]"
                    />
                    <button
                      type="button"
                      onClick={() => sumarUno(it.item_id)}
                      className="h-12 w-11 shrink-0 rounded-md border border-[#e4c9b0] bg-[#fdfaf6] text-sm font-bold text-[#9e6b15] active:scale-95"
                      aria-label="Sumar 1"
                    >
                      +1
                    </button>
                  </div>
                  {diferencia !== 0 && !Number.isNaN(diferencia) && cantNum > 0 && (
                    <p
                      className={
                        diferencia > 0
                          ? 'mt-0.5 text-[10px] text-[#9e6b15]'
                          : 'mt-0.5 text-[10px] text-[#c43e2c]'
                      }
                    >
                      {diferencia > 0 ? '+' : ''}
                      {diferencia} vs. pedido
                    </p>
                  )}
                </div>
                <div>
                  <Label className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-[#6f3a2a]">
                    <Calendar className="h-3 w-3" />
                    Vence (opc.)
                  </Label>
                  <Input
                    type="date"
                    value={it.fecha_vencimiento}
                    onChange={(e) =>
                      actualizarItem(it.item_id, {
                        fecha_vencimiento: e.target.value,
                      })
                    }
                    className="h-12 border-[#e4c9b0] tabular-nums focus-visible:ring-[#f9b44c]"
                  />
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {/* Agregar producto que no estaba en el pedido */}
      <button
        type="button"
        onClick={abrirNuevoProducto}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#e4c9b0] bg-white/60 px-3 py-3 text-sm font-semibold text-[#9e6b15] transition active:scale-[0.99]"
      >
        <Plus className="h-4 w-4" />
        Buscar o agregar un producto
      </button>

      {itemsPorDebajoMinimo.length > 0 && (
        <div className="mt-3 space-y-2 rounded-2xl border-2 border-[#c43e2c]/40 bg-[#c43e2c]/10 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#c43e2c]" />
            <p className="text-xs text-[#391511]">
              {itemsPorDebajoMinimo.length} producto
              {itemsPorDebajoMinimo.length === 1 ? '' : 's'} con vencimiento por
              debajo del mínimo configurado.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-[#391511]">
            <input
              type="checkbox"
              checked={aceptaPorDebajoMin}
              onChange={(e) => setAceptaPorDebajoMin(e.target.checked)}
              className="h-4 w-4 accent-[#c43e2c]"
            />
            Acepto recibir igual
          </label>
        </div>
      )}

      {/* Barra de acción fija abajo */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[#e4c9b0]/60 bg-[#fdfaf6]/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a]">
              {itemsEstado.some((it) => it.ya_recibido > 0)
                ? 'Esta entrega'
                : 'A recibir'}
            </div>
            <div className="text-xl font-extrabold tabular-nums text-[#391511]">
              {totalUnidades} u.
            </div>
          </div>
          {esParcial && totalUnidades > 0 ? (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => confirmar(false)}
                disabled={accionDeshabilitada}
                className="h-12 border-[#e4a42a]/60 text-[#9e6b15]"
              >
                Parcial
              </Button>
              <Button
                type="button"
                onClick={() => confirmar(true)}
                disabled={accionDeshabilitada}
                className="h-12 bg-[#f9b44c] font-semibold text-[#391511] hover:bg-[#e4a42a]"
              >
                Cerrar
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              onClick={() => confirmar(false)}
              disabled={accionDeshabilitada}
              className="h-12 bg-[#f9b44c] px-6 font-semibold text-[#391511] hover:bg-[#e4a42a]"
            >
              {procesando ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  …
                </>
              ) : (
                'Confirmar'
              )}
            </Button>
          )}
        </div>
      </div>

      <ModalClaveSupervisor
        abierto={modalSupervisorAbierto}
        onCambioAbierto={setModalSupervisorAbierto}
        motivo={`Se está recibiendo más cantidad de la pedida en ${itemsConExceso.length} producto(s). Un encargado debe autorizarlo.`}
        onAutorizado={(nombre) => {
          setExcesoAutorizado(true)
          setAutorizadoPor(nombre)
          ejecutarRecepcion(cerrarTrasRecepcion.current)
        }}
      />

      {/* Modal: buscar / agregar producto que no está en el pedido */}
      <Dialog
        open={modalNuevoAbierto}
        onOpenChange={(v) => (v ? setModalNuevoAbierto(true) : cerrarModalNuevo())}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#391511]">
              <Plus className="h-5 w-5 text-[#f9b44c]" />
              Agregar producto
            </DialogTitle>
            <DialogDescription className="text-[#6f3a2a]">
              Buscá el producto en el catálogo para sumarlo como recibido, aunque
              no sea de este proveedor ni esté en el pedido. Si no existe, cargalo
              nuevo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {/* Buscador de catálogo */}
            <div>
              <Label className="text-xs text-[#6f3a2a]">
                Buscar producto (nombre o código)
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#c8a58a]" />
                <Input
                  value={busquedaProd}
                  onChange={(e) => {
                    setBusquedaProd(e.target.value)
                    if (productoSeleccionado) setProductoSeleccionado(null)
                  }}
                  placeholder="Ej: gaseosa cola, 779…"
                  className="h-11 border-[#e4c9b0] pl-9 focus-visible:ring-[#f9b44c]"
                />
              </div>

              {!productoSeleccionado && busquedaDebounced.length >= 2 && (
                <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-[#e4c9b0]/70 bg-white">
                  {buscandoProd ? (
                    <div className="p-3 text-center">
                      <Loader2 className="mx-auto h-4 w-4 animate-spin text-[#9e6b15]" />
                    </div>
                  ) : (resultadosBusqueda ?? []).length === 0 ? (
                    <p className="p-3 text-center text-xs text-[#6f3a2a]">
                      No hay coincidencias. Podés cargarlo como nuevo abajo.
                    </p>
                  ) : (
                    <ul className="divide-y divide-[#e4c9b0]/40">
                      {(resultadosBusqueda ?? []).slice(0, 8).map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => seleccionarProducto(p)}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left active:bg-[#f9d2a2]/30"
                          >
                            <span className="min-w-0">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-sm font-medium text-[#391511]">
                                  {p.nombre}
                                </span>
                                {!p.activo && (
                                  <span className="shrink-0 rounded bg-[#c8a58a]/30 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#6f3a2a]">
                                    Inactivo
                                  </span>
                                )}
                              </span>
                              {p.codigo_barras && (
                                <span className="block font-mono text-[10px] text-[#c8a58a]">
                                  {p.codigo_barras}
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 text-[10px] text-[#6f3a2a]">
                              Stock: {p.stock_actual}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {productoSeleccionado ? (
              /* Producto existente elegido */
              <div className="flex items-center justify-between gap-2 rounded-lg border border-[#2f7d4f]/30 bg-[#2f7d4f]/10 px-3 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-[#2f7d4f]" />
                  <span className="truncate text-sm font-medium text-[#391511]">
                    {productoSeleccionado.nombre}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setProductoSeleccionado(null)}
                  className="shrink-0 text-xs font-semibold text-[#9e6b15]"
                >
                  Cambiar
                </button>
              </div>
            ) : (
              /* Alta de producto nuevo (si no está en el catálogo) */
              <div className="space-y-3 rounded-lg border border-dashed border-[#e4c9b0] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6f3a2a]">
                  ¿No lo encontrás? Cargalo nuevo
                </p>
                <div>
                  <Label className="text-xs text-[#6f3a2a]">
                    Nombre del producto
                  </Label>
                  <Input
                    value={nuevoNombre}
                    onChange={(e) => setNuevoNombre(e.target.value)}
                    placeholder="Ej: Gaseosa Cola 1.5L"
                    className="h-11 border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs text-[#6f3a2a]">
                      Código (opc.)
                    </Label>
                    <Input
                      inputMode="numeric"
                      value={nuevoCodigo}
                      onChange={(e) => setNuevoCodigo(e.target.value)}
                      placeholder="Código de barras"
                      className="h-11 border-[#e4c9b0] font-mono focus-visible:ring-[#f9b44c]"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-[#6f3a2a]">
                      Precio de venta
                    </Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={nuevoPrecio}
                      onChange={(e) => setNuevoPrecio(e.target.value)}
                      placeholder="0"
                      className="h-11 border-[#e4c9b0] tabular-nums focus-visible:ring-[#f9b44c]"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-[#6f3a2a]">Categoría (opc.)</Label>
                  <select
                    value={nuevoCategoria}
                    onChange={(e) => setNuevoCategoria(e.target.value)}
                    className="h-11 w-full rounded-md border border-[#e4c9b0] bg-white px-2 text-sm text-[#391511] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c]"
                  >
                    <option value="">Sin categoría</option>
                    {(categorias ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-[#6f3a2a]">Unidades que llegaron</Label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={nuevoCantidad}
                  onChange={(e) => setNuevoCantidad(e.target.value)}
                  placeholder="0"
                  className="h-11 border-[#e4c9b0] tabular-nums focus-visible:ring-[#f9b44c]"
                />
              </div>
              <div>
                <Label className="text-xs text-[#6f3a2a]">Vence (opc.)</Label>
                <Input
                  type="date"
                  value={nuevoVenc}
                  onChange={(e) => setNuevoVenc(e.target.value)}
                  className="h-11 border-[#e4c9b0] tabular-nums focus-visible:ring-[#f9b44c]"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={cerrarModalNuevo}
                disabled={guardandoNuevo}
                className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={agregarAlPedido}
                disabled={guardandoNuevo}
                className="flex-1 bg-[#f9b44c] font-semibold text-[#391511] hover:bg-[#e4a42a]"
              >
                {guardandoNuevo ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Agregando…
                  </>
                ) : productoSeleccionado ? (
                  'Agregar al pedido'
                ) : (
                  'Crear y agregar'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
