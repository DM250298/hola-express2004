'use client'

import { useMemo, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  Keyboard,
  Loader2,
  LockKeyhole,
  Plus,
  Receipt,
  RotateCcw,
  Wallet,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useTurnoActivo } from '@/lib/hooks/useTurno'
import { useCrearVenta } from '@/lib/hooks/useVentas'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { tienePermiso } from '@/lib/permisos'
import { useShortcuts } from '@/lib/hooks/useShortcuts'
import { reducerCarrito, type ItemCarrito } from './carrito'
import { AperturaCaja } from './AperturaCaja'
import { CierreCaja } from './CierreCaja'
import {
  BuscadorProducto,
  type BuscadorProductoRef,
} from './BuscadorProducto'
import { GridProductosFrecuentes } from './GridProductosFrecuentes'
import { CarritoVenta } from './CarritoVenta'
import { ModalCobro } from './ModalCobro'
import { ModalVentasTurno } from './ModalVentasTurno'
import { ModalGastoPOS } from './ModalGastoPOS'
import { ModalSangria } from './ModalSangria'
import { ModalDevolucion } from './ModalDevolucion'
import { TicketResumen } from './TicketResumen'
import { OverlayAtajos } from './OverlayAtajos'
import { IndicadorConexion } from './IndicadorConexion'
import { SelectorCliente, type ClienteSeleccionado } from './SelectorCliente'
import { ModalCobroTerminal } from './ModalCobroTerminal'
import { ModalIngresoPeso } from './ModalIngresoPeso'
import { useTerminales } from '@/lib/hooks/useTerminales'
import { formatearFechaHora, formatearMonto } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import type { ProductoConRelaciones } from '@/lib/queries/productos'
import type { PagoPayload, ProductoFrecuente } from '@/lib/queries/ventas'
import type { VentaCompleta } from '@/lib/queries/ventas'

interface Props {
  usuarioId: string
  nombreUsuario: string
}

interface Orden {
  id: string
  items: ItemCarrito[]
  clienteId: number | null
  clienteNombre: string | null
}

const MAX_ORDENES = 5

function nuevaOrden(): Orden {
  return {
    id: Math.random().toString(36).slice(2, 10),
    items: [],
    clienteId: null,
    clienteNombre: null,
  }
}

export function PantallaPOS({ usuarioId, nombreUsuario }: Props) {
  const {
    data: turno,
    isLoading,
    isError,
  } = useTurnoActivo(usuarioId)
  const crearVenta = useCrearVenta()
  const { data: usuario } = useUsuario()
  const { data: terminales } = useTerminales()
  const puedeGasto = tienePermiso(usuario?.permisos, 'pos_gasto')
  const puedeDevolver = tienePermiso(usuario?.permisos, 'devoluciones')
  const hayTerminalActiva = (terminales ?? []).some(
    (t) => t.activo && !!t.device_id
  )

  // Múltiples órdenes — cada una es un carrito independiente
  const [ordenes, setOrdenes] = useState<Orden[]>(() => [nuevaOrden()])
  const [ordenActivaId, setOrdenActivaId] = useState<string>(
    () => ordenes[0]?.id ?? ''
  )

  const [modalCobroAbierto, setModalCobroAbierto] = useState(false)
  const [modalCierreAbierto, setModalCierreAbierto] = useState(false)
  const [modalVentasTurnoAbierto, setModalVentasTurnoAbierto] = useState(false)
  const [modalGastoAbierto, setModalGastoAbierto] = useState(false)
  const [modalSangriaAbierto, setModalSangriaAbierto] = useState(false)
  const [modalDevolucionAbierto, setModalDevolucionAbierto] = useState(false)
  const [ticketAbierto, setTicketAbierto] = useState(false)
  const [overlayAtajosAbierto, setOverlayAtajosAbierto] = useState(false)
  const [selectorClienteAbierto, setSelectorClienteAbierto] = useState(false)
  const [modalTerminalAbierto, setModalTerminalAbierto] = useState(false)
  /** Producto por peso pendiente de ingreso de gramos. */
  const [productoPeso, setProductoPeso] = useState<{
    producto_id: number
    nombre: string
    codigo_barras: string | null
    precio_venta: number
    stock_actual: number
    pesoActualKg?: number
  } | null>(null)
  /** Cuando el cobro es mixto (maquinita + otros), guardamos los pagos no-
   *  maquinita acá y el monto a cobrar por la terminal. Al aprobarse, se
   *  registra la venta con todos los pagos combinados. */
  const [pagosPrevios, setPagosPrevios] = useState<PagoPayload[]>([])
  const [montoMaquinita, setMontoMaquinita] = useState(0)
  const buscadorRef = useRef<BuscadorProductoRef>(null)
  const [ultimaVenta, setUltimaVenta] = useState<VentaCompleta | null>(null)
  const [ultimoVuelto, setUltimoVuelto] = useState<number | null>(null)

  // Helpers de órdenes
  const ordenActiva =
    ordenes.find((o) => o.id === ordenActivaId) ?? ordenes[0]
  const carrito = ordenActiva?.items ?? []

  function dispatchCarrito(accion: Parameters<typeof reducerCarrito>[1]) {
    setOrdenes((prev) =>
      prev.map((o) =>
        o.id === ordenActivaId
          ? { ...o, items: reducerCarrito(o.items, accion) }
          : o
      )
    )
  }

  function elegirCliente(c: ClienteSeleccionado | null) {
    setOrdenes((prev) =>
      prev.map((o) =>
        o.id === ordenActivaId
          ? {
              ...o,
              clienteId: c?.id ?? null,
              clienteNombre: c?.nombre ?? null,
            }
          : o
      )
    )
  }

  function agregarOrden() {
    if (ordenes.length >= MAX_ORDENES) return
    const nueva = nuevaOrden()
    setOrdenes((prev) => [...prev, nueva])
    setOrdenActivaId(nueva.id)
    setTimeout(() => buscadorRef.current?.focus(), 50)
  }

  function quitarOrden(id: string) {
    const orden = ordenes.find((o) => o.id === id)
    if (!orden) return
    if (orden.items.length > 0 && !confirm('Esta orden tiene productos. ¿Cerrarla igual?')) {
      return
    }
    setOrdenes((prev) => {
      const filtradas = prev.filter((o) => o.id !== id)
      // Si quedó sin órdenes, crear una vacía
      const finales = filtradas.length === 0 ? [nuevaOrden()] : filtradas
      // Si la orden activa era la cerrada, pasar a la primera
      if (id === ordenActivaId) {
        setOrdenActivaId(finales[0].id)
      }
      return finales
    })
  }

  function cambiarAOrden(idx: number) {
    const orden = ordenes[idx]
    if (orden) {
      setOrdenActivaId(orden.id)
      setTimeout(() => buscadorRef.current?.focus(), 50)
    }
  }

  // Shortcuts globales — DEBEN declararse ANTES de los early returns
  const algunModalAbierto =
    modalCobroAbierto ||
    modalCierreAbierto ||
    modalVentasTurnoAbierto ||
    modalGastoAbierto ||
    modalSangriaAbierto ||
    modalDevolucionAbierto ||
    ticketAbierto ||
    overlayAtajosAbierto ||
    selectorClienteAbierto ||
    modalTerminalAbierto ||
    !!productoPeso

  const shortcutsPantalla = useMemo(
    () => [
      {
        tecla: 'F1',
        accion: () => setOverlayAtajosAbierto(true),
        cuandoEscribe: true,
      },
      {
        tecla: 'F2',
        accion: () => buscadorRef.current?.focus(),
        cuandoEscribe: true,
      },
      {
        tecla: 'F3',
        accion: () => setModalVentasTurnoAbierto(true),
        cuandoEscribe: true,
      },
      ...(puedeGasto
        ? [
            {
              tecla: 'F10',
              accion: () => setModalGastoAbierto(true),
              cuandoEscribe: true,
            },
          ]
        : []),
      {
        tecla: 'F4',
        accion: () => {
          if (carrito.length > 0) setModalCobroAbierto(true)
        },
        cuandoEscribe: true,
      },
      {
        tecla: 'F6',
        accion: agregarOrden,
        cuandoEscribe: true,
      },
      {
        tecla: 'F7',
        accion: () => quitarOrden(ordenActivaId),
        cuandoEscribe: true,
      },
      {
        tecla: 'F8',
        accion: () => {
          if (carrito.length > 0 && confirm('¿Vaciar el carrito?')) {
            dispatchCarrito({ tipo: 'VACIAR' })
          }
        },
        cuandoEscribe: true,
      },
      {
        tecla: 'F9',
        accion: () => setModalCierreAbierto(true),
        cuandoEscribe: true,
      },
      // Ctrl+1..5 = cambiar de orden
      ...['1', '2', '3', '4', '5'].map((n, i) => ({
        tecla: n,
        ctrl: true,
        accion: () => cambiarAOrden(i),
        cuandoEscribe: true,
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [carrito.length, ordenes.length, ordenActivaId, puedeGasto]
  )

  useShortcuts(shortcutsPantalla, !!turno && !algunModalAbierto)

  // — Estados de carga —
  if (isLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-4">
        <Skeleton className="h-10 w-64 bg-[#f9d2a2]/30" />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
          <Skeleton className="h-[500px] rounded-2xl bg-[#f9d2a2]/30" />
          <Skeleton className="h-[500px] rounded-2xl bg-[#f9d2a2]/30" />
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-12 text-center text-[#c43e2c]">
        No se pudo cargar el estado del turno. Recargá la página.
      </div>
    )
  }

  if (!turno) {
    return <AperturaCaja usuarioId={usuarioId} nombreUsuario={nombreUsuario} />
  }

  // — Con turno abierto —
  function agregarProducto(p: ProductoConRelaciones | ProductoFrecuente) {
    const datos =
      'id' in p
        ? {
            producto_id: p.id,
            nombre: p.nombre,
            codigo_barras: p.codigo_barras,
            precio_venta: p.precio_venta,
            stock_actual: p.stock_actual,
            venta_por_peso: p.venta_por_peso ?? false,
          }
        : {
            producto_id: p.producto_id,
            nombre: p.nombre,
            codigo_barras: p.codigo_barras,
            precio_venta: p.precio_venta,
            stock_actual: p.stock_actual,
            venta_por_peso: p.venta_por_peso ?? false,
          }

    if (datos.venta_por_peso) {
      // Abrir modal para ingresar el peso
      const pesoActual = carrito.find(
        (it) => it.producto_id === datos.producto_id
      )?.cantidad
      setProductoPeso({ ...datos, pesoActualKg: pesoActual })
      return
    }

    dispatchCarrito({ tipo: 'AGREGAR_PRODUCTO', producto: datos })
  }

  /** Llamado desde el carrito para re-editar el peso de un ítem por kg. */
  function editarPesoCarrito(productoId: number) {
    const it = carrito.find((i) => i.producto_id === productoId)
    if (!it) return
    setProductoPeso({
      producto_id: it.producto_id,
      nombre: it.nombre,
      codigo_barras: it.codigo_barras,
      precio_venta: it.precio_unitario,
      stock_actual: it.stock_disponible,
      pesoActualKg: it.cantidad,
    })
  }

  function confirmarVenta(pagos: PagoPayload[], vueltoEfectivo: number) {
    if (carrito.length === 0 || !turno) return
    const items = carrito.map((it) => ({
      producto_id: it.producto_id,
      cantidad: it.cantidad,
      precio_unitario: it.precio_unitario,
      stock_actual: it.stock_disponible,
      nombre: it.nombre,
    }))

    crearVenta.mutate(
      {
        turno_id: turno.id,
        usuario_id: usuarioId,
        cliente_id: ordenActiva?.clienteId ?? null,
        pagos,
        items,
      },
      {
        onSuccess: (venta) => {
          setUltimaVenta(venta)
          setUltimoVuelto(vueltoEfectivo > 0 ? vueltoEfectivo : null)
          // Vacía la orden activa después de cobrar (ítems y cliente)
          dispatchCarrito({ tipo: 'VACIAR' })
          elegirCliente(null)
          setModalCobroAbierto(false)
          setTicketAbierto(true)
        },
      }
    )
  }

  /** Llamado por ModalCobroTerminal cuando la maquinita aprobó el pago. */
  function confirmarVentaTerminal(
    medioPago: string,
    cobroReal?: { comision: number; iibb: number } | null
  ) {
    if (carrito.length === 0 || !turno) return
    const items = carrito.map((it) => ({
      producto_id: it.producto_id,
      cantidad: it.cantidad,
      precio_unitario: it.precio_unitario,
      stock_actual: it.stock_disponible,
      nombre: it.nombre,
    }))
    // Si hay un cobro parcial pre-cargado (modo "mixto"), combinamos los
    // pagos no-maquinita con la línea de la maquinita aprobada.
    const montoMaq = montoMaquinita > 0 ? montoMaquinita : totalCarrito
    // Comisión + IIBB reales que cobró MP (si los pudo leer); van solo en la
    // línea de la maquinita, no en los pagos previos (efectivo, etc.).
    const lineaMaq: PagoPayload = {
      medio_pago: medioPago,
      monto: pagosPrevios.length > 0 ? montoMaq : totalCarrito,
      comision_monto: cobroReal?.comision ?? null,
      iibb_monto: cobroReal?.iibb ?? null,
    }
    const pagos: PagoPayload[] =
      pagosPrevios.length > 0 ? [...pagosPrevios, lineaMaq] : [lineaMaq]

    crearVenta.mutate(
      {
        turno_id: turno.id,
        usuario_id: usuarioId,
        cliente_id: ordenActiva?.clienteId ?? null,
        pagos,
        items,
      },
      {
        onSuccess: (venta) => {
          setUltimaVenta(venta)
          setUltimoVuelto(null) // no hay vuelto con tarjeta
          dispatchCarrito({ tipo: 'VACIAR' })
          elegirCliente(null)
          setModalTerminalAbierto(false)
          setPagosPrevios([])
          setMontoMaquinita(0)
          setTicketAbierto(true)
        },
      }
    )
  }

  /** Llamado por ModalCobro cuando hay una línea de "Maquinita": guarda
   *  los demás pagos y abre el flujo de la terminal con el monto parcial. */
  function iniciarCobroMixto(
    pagosNoMaq: PagoPayload[],
    montoMaq: number
  ) {
    setPagosPrevios(pagosNoMaq)
    setMontoMaquinita(montoMaq)
    setModalCobroAbierto(false)
    setModalTerminalAbierto(true)
  }

  const totalCarrito = carrito.reduce(
    (acc, it) => acc + it.precio_unitario * it.cantidad,
    0
  )

  return (
    <div className="h-full flex flex-col">
      {/* Barra superior con info del turno */}
      <div className="px-4 sm:px-6 py-3 border-b border-[#e4c9b0]/60 bg-white flex items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h1 className="text-[#391511] font-bold text-base sm:text-lg">
              Punto de venta
            </h1>
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-[#f9b44c]/20 text-[#6f3a2a]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#f9b44c] animate-pulse" />
              Turno #{turno.id}
            </span>
          </div>
          <p className="text-[#6f3a2a] text-xs hidden sm:block">
            Abierto {formatearFechaHora(turno.fecha_apertura)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <IndicadorConexion />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOverlayAtajosAbierto(true)}
            title="Atajos de teclado (F1)"
            className="text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511] gap-1.5"
          >
            <Keyboard className="h-3.5 w-3.5" />
            <kbd className="hidden md:inline px-1 py-0 bg-white border border-[#e4c9b0] rounded text-[10px] font-mono">
              F1
            </kbd>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setModalVentasTurnoAbierto(true)}
            title="Ventas del turno (F3)"
            className="text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511] gap-1.5"
          >
            <Receipt className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Ventas</span>
            <kbd className="hidden md:inline px-1 py-0 bg-white border border-[#e4c9b0] rounded text-[10px] font-mono">
              F3
            </kbd>
          </Button>
          {puedeGasto && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setModalGastoAbierto(true)}
              title="Registrar gasto de caja (F10)"
              className="text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511] gap-1.5"
            >
              <Wallet className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Gasto</span>
              <kbd className="hidden md:inline px-1 py-0 bg-white border border-[#e4c9b0] rounded text-[10px] font-mono">
                F10
              </kbd>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setModalSangriaAbierto(true)}
            title="Sangría / retiro a caja fuerte"
            className="text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511] gap-1.5"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sangría</span>
          </Button>
          {puedeDevolver && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setModalDevolucionAbierto(true)}
              title="Registrar una devolución"
              className="text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511] gap-1.5"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Devolución</span>
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => setModalCierreAbierto(true)}
            className="border-[#c43e2c]/40 text-[#c43e2c] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c] gap-1.5"
          >
            <LockKeyhole className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Cerrar turno</span>
            <kbd className="hidden md:inline px-1 py-0 bg-white border border-[#c43e2c]/30 rounded text-[10px] font-mono">
              F9
            </kbd>
          </Button>
        </div>
      </div>

      {/* Tabs de órdenes */}
      <div className="px-3 sm:px-4 py-2 bg-[#fdfaf6] border-b border-[#e4c9b0]/40 flex items-center gap-1.5 overflow-x-auto shrink-0">
        {ordenes.map((o, idx) => {
          const activa = o.id === ordenActivaId
          const cantidad = o.items.reduce((acc, it) => acc + it.cantidad, 0)
          const total = o.items.reduce(
            (acc, it) => acc + it.precio_unitario * it.cantidad,
            0
          )
          return (
            <div
              key={o.id}
              className={cn(
                'group flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer transition-all shrink-0',
                activa
                  ? 'border-[#f9b44c] bg-white shadow-sm'
                  : 'border-[#e4c9b0]/60 bg-white/60 hover:bg-white'
              )}
              onClick={() => setOrdenActivaId(o.id)}
            >
              <span
                className={cn(
                  'h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-extrabold',
                  activa
                    ? 'bg-[#f9b44c] text-[#391511]'
                    : 'bg-[#e4c9b0]/60 text-[#6f3a2a]'
                )}
              >
                {idx + 1}
              </span>
              <span
                className={cn(
                  'text-xs whitespace-nowrap',
                  activa ? 'text-[#391511] font-semibold' : 'text-[#6f3a2a]'
                )}
              >
                Orden {idx + 1}
                {cantidad > 0 && (
                  <span className="text-[#c8a58a] font-normal">
                    {' · '}
                    {cantidad} {cantidad === 1 ? 'ítem' : 'ítems'}
                    {' · '}
                    {formatearMonto(total)}
                  </span>
                )}
              </span>
              {ordenes.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    quitarOrden(o.id)
                  }}
                  className="ml-1 opacity-40 hover:opacity-100 hover:text-[#c43e2c] transition"
                  aria-label="Cerrar orden"
                  title="Cerrar orden (F7)"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )
        })}

        {ordenes.length < MAX_ORDENES && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={agregarOrden}
            title="Nueva orden (F6)"
            className="shrink-0 text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511] gap-1 h-8 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            Nueva
            <kbd className="hidden md:inline px-1 py-0 bg-white border border-[#e4c9b0] rounded text-[9px] font-mono">
              F6
            </kbd>
          </Button>
        )}
      </div>

      {/* Layout split — buscador/grid + carrito */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-3 p-3 sm:p-4 bg-[#fdfaf6] overflow-hidden">
        <div className="space-y-3 overflow-y-auto min-h-0 pr-1">
          <BuscadorProducto ref={buscadorRef} onSeleccionar={agregarProducto} />
          <GridProductosFrecuentes
            turnoId={turno.id}
            onSeleccionar={agregarProducto}
          />
        </div>

        <div className="min-h-0">
          <CarritoVenta
            items={carrito}
            dispatch={dispatchCarrito}
            onCobrar={() => setModalCobroAbierto(true)}
            clienteNombre={ordenActiva?.clienteNombre ?? null}
            onElegirCliente={() => setSelectorClienteAbierto(true)}
            onQuitarCliente={() => elegirCliente(null)}
            onCobrarTerminal={() => setModalTerminalAbierto(true)}
            hayTerminalActiva={hayTerminalActiva}
            onEditarPeso={editarPesoCarrito}
          />
        </div>
      </div>

      {/* Modales */}
      <ModalCobro
        abierto={modalCobroAbierto}
        onCambioAbierto={setModalCobroAbierto}
        total={totalCarrito}
        procesando={crearVenta.isPending}
        onConfirmar={confirmarVenta}
        onCobrarConMaquinita={iniciarCobroMixto}
        hayTerminalActiva={hayTerminalActiva}
      />

      <TicketResumen
        abierto={ticketAbierto}
        onCambioAbierto={setTicketAbierto}
        venta={ultimaVenta}
        vuelto={ultimoVuelto}
        nombreCajero={nombreUsuario}
      />

      <CierreCaja
        abierto={modalCierreAbierto}
        onCambioAbierto={setModalCierreAbierto}
        turnoId={turno.id}
        montoApertura={turno.monto_apertura}
        fechaApertura={turno.fecha_apertura}
        nombreCajero={nombreUsuario}
        usuarioId={usuarioId}
      />

      <ModalVentasTurno
        abierto={modalVentasTurnoAbierto}
        onCambioAbierto={setModalVentasTurnoAbierto}
        turnoId={turno.id}
        usuarioId={usuarioId}
      />

      <ModalGastoPOS
        abierto={modalGastoAbierto}
        onCambioAbierto={setModalGastoAbierto}
        turnoId={turno.id}
        usuarioId={usuarioId}
      />

      <ModalSangria
        abierto={modalSangriaAbierto}
        onCambioAbierto={setModalSangriaAbierto}
        turnoId={turno.id}
        usuarioId={usuarioId}
      />

      {puedeDevolver && (
        <ModalDevolucion
          abierto={modalDevolucionAbierto}
          onCambioAbierto={setModalDevolucionAbierto}
          turnoId={turno.id}
          usuarioId={usuarioId}
        />
      )}

      <OverlayAtajos
        abierto={overlayAtajosAbierto}
        onCambioAbierto={setOverlayAtajosAbierto}
      />

      <SelectorCliente
        abierto={selectorClienteAbierto}
        onCambioAbierto={setSelectorClienteAbierto}
        onSeleccionar={elegirCliente}
      />

      <ModalCobroTerminal
        abierto={modalTerminalAbierto}
        onCambioAbierto={(v) => {
          setModalTerminalAbierto(v)
          // Si se cierra sin haber registrado la venta, descartamos los
          // pagos previos para no contaminar el próximo cobro.
          if (!v && !crearVenta.isPending) {
            setPagosPrevios([])
            setMontoMaquinita(0)
          }
        }}
        total={montoMaquinita > 0 ? montoMaquinita : totalCarrito}
        totalVenta={totalCarrito}
        onAprobado={confirmarVentaTerminal}
        procesandoVenta={crearVenta.isPending}
      />

      {/* Modal ingreso de peso para productos por kg */}
      {productoPeso && (
        <ModalIngresoPeso
          abierto={!!productoPeso}
          onCambioAbierto={(v) => !v && setProductoPeso(null)}
          nombre={productoPeso.nombre}
          precioPorKg={productoPeso.precio_venta}
          pesoActualKg={productoPeso.pesoActualKg}
          onConfirmar={(kg) => {
            dispatchCarrito({
              tipo: 'AGREGAR_PRODUCTO',
              producto: {
                producto_id: productoPeso.producto_id,
                nombre: productoPeso.nombre,
                codigo_barras: productoPeso.codigo_barras,
                precio_venta: productoPeso.precio_venta,
                stock_actual: productoPeso.stock_actual,
                venta_por_peso: true,
                cantidad_kg: kg,
              },
            })
            setProductoPeso(null)
          }}
        />
      )}

      {/* Overlay global mientras procesa venta — bloquea taps repetidos */}
      {crearVenta.isPending && !modalCobroAbierto && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl px-6 py-4 flex items-center gap-3 shadow-xl">
            <Loader2 className="h-5 w-5 animate-spin text-[#f9b44c]" />
            <span className="text-[#391511] font-medium">
              Registrando venta…
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
