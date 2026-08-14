'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Barcode,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Loader2,
  PackageCheck,
  Plus,
  Search,
  ShieldCheck,
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
import { ModalCodigoBarras } from './ModalCodigoBarras'
import { usePedidoDetalle, useRecibirPedido } from '@/lib/hooks/usePedidos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { useCategorias } from '@/lib/hooks/useCategorias'
import { agregarItemPedido, parsearDiasCondicionPago } from '@/lib/queries/pedidos'
import {
  createProducto,
  getProductoByBarcode,
  getProductos,
  toggleProductoActivo,
} from '@/lib/queries/productos'
import {
  formatearCantidad,
  formatearFechaCorta,
  formatearNumero,
  pareceGramosEnKg,
} from '@/lib/utils/formato'
import { esCodigoAutogenerado } from '@/lib/utils/codigoBarras'
import { tienePermiso } from '@/lib/permisos'
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
  /** true = se recibe por peso (kg): la cantidad es un peso decimal, no unidades. */
  venta_por_peso: boolean
  fecha_vencimiento: string
  dias_vencimiento_minimo: number | null
}

/** Carga de un renglón dentro de UNA factura (borrador editable). */
interface CargaRenglon {
  cantidad: string
  fecha_vencimiento: string
}

/**
 * Una factura de la entrega. TODAS son borradores editables hasta el Confirmar
 * final: nada viaja a la base antes (la orden se recibe completa o no se
 * recibe, política de la empresa, sin recepción parcial).
 */
interface FacturaEntrega {
  /** Key estable de la pestaña ('t1','t2',…) — NO es el factura_ref final. */
  id: string
  /** N° del papel. Puede quedar vacío hasta el Confirmar. */
  numero: string
  /** Cargas por item_id. Autoritativo SOLO para las pestañas NO activas: la
   *  activa vive en los inputs de `itemsEstado` y se snapshotea al salir. */
  cargas: Record<number, CargaRenglon>
}

/** Total de unidades cargadas en una factura (desde sus cargas). */
function unidadesDeCargas(cargas: Record<number, CargaRenglon>): number {
  return Object.values(cargas).reduce(
    (acc, c) => acc + (Number(c.cantidad) || 0),
    0
  )
}

/** Datos mínimos de un producto para sumarlo a la recepción (buscado o creado). */
interface ProdParaAgregar {
  id: number
  nombre: string
  codigo_barras: string | null
  activo: boolean
  dias_vencimiento_minimo: number | null
  venta_por_peso: boolean
}

/** Reduce un producto del catálogo (Row/ConRelaciones) a lo que necesita la recepción. */
function aProdParaAgregar(p: {
  id: number
  nombre: string
  codigo_barras: string | null
  activo: boolean
  dias_vencimiento_minimo: number | null
  venta_por_peso?: boolean
}): ProdParaAgregar {
  return {
    id: p.id,
    nombre: p.nombre,
    codigo_barras: p.codigo_barras,
    activo: p.activo,
    dias_vencimiento_minimo: p.dias_vencimiento_minimo,
    venta_por_peso: p.venta_por_peso ?? false,
  }
}

/** `true` si el renglón ya tiene cantidad cargada en la factura en curso. */
function estaCargado(it: ItemEstado): boolean {
  return (Number(it.cantidad_recibida) || 0) > 0
}

/**
 * Acomoda un renglón justo detrás del último que ya tiene cantidad, para que la
 * lista se arme de arriba hacia abajo en el orden en que se descarga (= el
 * orden del papel). Un renglón que ya tiene cantidad no se toca: su lugar en la
 * factura ya está definido.
 */
function moverAlFinalDeCargados(
  items: ItemEstado[],
  item_id: number
): ItemEstado[] {
  const i = items.findIndex((it) => it.item_id === item_id)
  if (i < 0 || estaCargado(items[i])) return items
  const resto = items.filter((_, idx) => idx !== i)
  let destino = 0
  resto.forEach((it, idx) => {
    if (estaCargado(it)) destino = idx + 1
  })
  return [...resto.slice(0, destino), items[i], ...resto.slice(destino)]
}

interface Props {
  pedidoId: number
}

/**
 * Recepción de un pedido desde el teléfono: escaneo con cámara, fecha de
 * vencimiento opcional por ítem, clave de supervisor si se recibe de más, y
 * registro atómico vía `fn_recibir_pedido`. No muestra precios/costos.
 * Permite agregar un producto que no estaba en la orden (creándolo si hace
 * falta).
 *
 * Multi-factura: PESTAÑAS NAVEGABLES. Cada factura de la entrega es una tab;
 * "+" abre la siguiente y se puede VOLVER a cualquiera para controlarla o
 * corregirla (cantidades, fechas, N°) — todas son borradores en el teléfono.
 * Los inputs muestran siempre la factura ACTIVA; al cambiar de tab se hace un
 * snapshot de la actual en `facturas[].cargas` y se hidratan los inputs de la
 * destino. Nada se graba hasta el Confirmar final: ahí viajan todas juntas en
 * una sola llamada a `fn_recibir_pedido` (una cuenta a pagar por factura, vía
 * `factura_ref` por renglón — el RPC acumula filas repetidas del mismo item).
 * El N° es obligatorio recién al Confirmar (para navegar no hace falta).
 *
 * POLÍTICA DE LA EMPRESA (2026-08-04): la orden se recibe COMPLETA o no se
 * recibe. Si al confirmar hay renglones por debajo de lo pedido, el diálogo
 * de faltantes ofrece confirmarlos como "no vino": la orden se ajusta en la
 * misma transacción (0 recibido → el renglón se elimina; incompleto → la
 * pedida baja a lo recibido) y se recibe completa. Queda en auditoría.
 *
 * ORDEN DEL PAPEL: el orden de las tarjetas ES el orden de la factura. Lo que
 * se escanea se acomoda al final de los renglones ya cargados (la lista se arma
 * de arriba hacia abajo, como se descarga), y las flechas ↑↓ corrigen a mano.
 * Al enviar, cada renglón con cantidad recibe su posición como `orden`
 * (`orden_recepcion`, mig 137), así administración carga los precios en el
 * mismo orden en que están en el papel.
 */
export function RecepcionMovil({ pedidoId }: Props) {
  const router = useRouter()
  const { data: usuario } = useUsuario()
  const { data: pedido, isLoading } = usePedidoDetalle(pedidoId)
  const { data: categorias } = useCategorias()
  const recibir = useRecibirPedido()

  const [itemsEstado, setItemsEstado] = useState<ItemEstado[]>([])
  // Facturas de la entrega (pestañas). Los inputs de itemsEstado son la ACTIVA;
  // las demás guardan sus cargas en `cargas` y se rehidratan al volver.
  const [facturas, setFacturas] = useState<FacturaEntrega[]>([
    { id: 't1', numero: '', cargas: {} },
  ])
  const [activaIdx, setActivaIdx] = useState(0)
  const proximaTabRef = useRef(2)
  const numeroFacturaInputRef = useRef<HTMLInputElement | null>(null)
  const [aceptaPorDebajoMin, setAceptaPorDebajoMin] = useState(false)
  const [excesoAutorizado, setExcesoAutorizado] = useState(false)
  const [autorizadoPor, setAutorizadoPor] = useState<string | null>(null)
  const [modalSupervisorAbierto, setModalSupervisorAbierto] = useState(false)
  const [dialogFaltanteAbierto, setDialogFaltanteAbierto] = useState(false)
  // Faltantes confirmados como "no vino" a la espera de la clave de
  // supervisor (solo cuando además hay exceso).
  const [noVinoPendiente, setNoVinoPendiente] = useState<number[]>([])
  // Producto cuyo código de barras se está editando (solo con permiso compras).
  const [productoCodigo, setProductoCodigo] = useState<{
    id: number
    nombre: string
    codigo_barras: string | null
  } | null>(null)
  const puedeEditarCodigo = tienePermiso(usuario?.permisos, 'compras')

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

  // Una inicialización por pedido: un refetch de TanStack (reconexión,
  // remount) NO debe pisar los borradores de facturas ni el orden armado.
  const inicializadoRef = useRef<number | null>(null)
  useEffect(() => {
    if (!pedido) return
    if (inicializadoRef.current === pedido.id) return
    inicializadoRef.current = pedido.id
    setFacturas([{ id: 't1', numero: '', cargas: {} }])
    setActivaIdx(0)
    proximaTabRef.current = 2
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
        venta_por_peso: it.producto?.venta_por_peso ?? false,
        fecha_vencimiento: '',
        dias_vencimiento_minimo: it.producto?.dias_vencimiento_minimo ?? null,
      }))
    )
    setAceptaPorDebajoMin(false)
    setExcesoAutorizado(false)
    setAutorizadoPor(null)
    setNoVinoPendiente([])
  }, [pedido])

  function actualizarItem(
    item_id: number,
    cambios: Partial<Pick<ItemEstado, 'cantidad_recibida' | 'fecha_vencimiento'>>
  ) {
    // Nunca reordena la lista: mover en el DOM un input con foco le cierra el
    // teclado al usuario. El orden lo mueven el escaneo y las flechas.
    setItemsEstado((prev) =>
      prev.map((it) => (it.item_id === item_id ? { ...it, ...cambios } : it))
    )
  }

  /**
   * Mueve un renglón un lugar arriba o abajo en el papel de la factura: lo
   * intercambia con el renglón CARGADO más cercano en esa dirección (los que
   * todavía no se cargaron no ocupan lugar en la factura). El orden que ve el
   * usuario es el que después viaja al RPC.
   */
  function moverItem(item_id: number, direccion: -1 | 1) {
    setItemsEstado((prev) => {
      const i = prev.findIndex((it) => it.item_id === item_id)
      if (i < 0) return prev
      let j = i + direccion
      while (j >= 0 && j < prev.length && !estaCargado(prev[j])) j += direccion
      if (j < 0 || j >= prev.length) return prev
      const copia = [...prev]
      ;[copia[i], copia[j]] = [copia[j], copia[i]]
      return copia
    })
  }

  /** Botón secundario: suma 1 unidad al producto (para los que prefieren tallar). */
  function sumarUno(item_id: number) {
    const it = itemsEstado.find((i) => i.item_id === item_id)
    if (!it) return
    actualizarItem(item_id, {
      cantidad_recibida: String((Number(it.cantidad_recibida) || 0) + 1),
    })
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
   * Escaneo: acomoda el producto detrás del último renglón ya cargado (la lista
   * se arma en el orden en que se descarga = el orden del papel), lo resalta y
   * enfoca su campo para cargar la cantidad TOTAL (no suma de a 1). El "+1"
   * queda como botón.
   */
  function alEscanear(codigo: string) {
    // Con un modal abierto ignoramos lecturas (evita re-disparos de la cámara).
    if (modalNuevoAbierto || productoCodigo) return
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
    setItemsEstado((prev) => moverAlFinalDeCargados(prev, item.item_id))
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

  /**
   * Renglones ya numerados en las pestañas ANTERIORES a la activa: la
   * numeración del papel arranca donde terminó la factura anterior.
   */
  const ordenBase = useMemo(
    () =>
      facturas
        .slice(0, activaIdx)
        .reduce(
          (acc, f) =>
            acc +
            Object.values(f.cargas).filter((c) => (Number(c.cantidad) || 0) > 0)
              .length,
          0
        ),
    [facturas, activaIdx]
  )

  /**
   * N° de renglón en el papel de cada producto ya cargado: su posición en la
   * lista, continuando la numeración de las facturas anteriores.
   */
  const numeroRenglon = useMemo(() => {
    const m = new Map<number, number>()
    let n = ordenBase
    itemsEstado.forEach((it) => {
      if (estaCargado(it)) m.set(it.item_id, ++n)
    })
    return m
  }, [itemsEstado, ordenBase])

  /** Acumulado por item de las OTRAS facturas de la entrega (no la activa). */
  const recibidoOtras = useMemo(() => {
    const m = new Map<number, number>()
    facturas.forEach((f, i) => {
      if (i === activaIdx) return
      for (const [id, c] of Object.entries(f.cargas)) {
        const cant = Number(c.cantidad) || 0
        if (cant > 0) m.set(Number(id), (m.get(Number(id)) ?? 0) + cant)
      }
    })
    return m
  }, [facturas, activaIdx])

  // Solo cuenta como exceso lo que ESTA entrega agrega por encima del pedido:
  // un exceso ya autorizado en una recepción anterior no vuelve a pedir clave
  // si ahora no se le suma nada.
  const itemsConExceso = useMemo(
    () =>
      itemsEstado.filter((it) => {
        const nuevo =
          (recibidoOtras.get(it.item_id) ?? 0) +
          (Number(it.cantidad_recibida) || 0)
        return nuevo > 0 && it.ya_recibido + nuevo > it.cantidad_pedida
      }),
    [itemsEstado, recibidoOtras]
  )
  const requiereSupervisor = itemsConExceso.length > 0 && !excesoAutorizado

  /**
   * Renglones que todavía no llegan a lo pedido (contando lo de la base, las
   * facturas locales y lo tipeado ahora). Con faltantes NO se puede confirmar:
   * la orden se recibe completa o no se recibe.
   */
  const itemsFaltantes = useMemo(
    () =>
      itemsEstado.flatMap((it) => {
        const total =
          it.ya_recibido +
          (recibidoOtras.get(it.item_id) ?? 0) +
          (Number(it.cantidad_recibida) || 0)
        const falta = it.cantidad_pedida - total
        return falta > 0 ? [{ ...it, falta }] : []
      }),
    [itemsEstado, recibidoOtras]
  )
  const unidadesFaltantes = itemsFaltantes.reduce((a, it) => a + it.falta, 0)

  // Mira la factura activa (inputs) Y las cargas de las otras pestañas: una
  // fecha corta no se vuelve invisible por cambiar de factura.
  const itemsPorDebajoMinimo = useMemo(() => {
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)
    const diasDesdeHoy = (fecha: string) =>
      Math.floor(
        (new Date(`${fecha}T00:00:00`).getTime() - hoy.getTime()) /
          (1000 * 60 * 60 * 24)
      )
    return itemsEstado.flatMap((it) => {
      const min = it.dias_vencimiento_minimo
      if (min == null) return []
      const cargasItem: CargaRenglon[] = [
        {
          cantidad: it.cantidad_recibida,
          fecha_vencimiento: it.fecha_vencimiento,
        },
        ...facturas
          .filter((_, i) => i !== activaIdx)
          .map((f) => f.cargas[it.item_id])
          .filter((c): c is CargaRenglon => c != null),
      ]
      const cortos = cargasItem
        .filter((c) => (Number(c.cantidad) || 0) > 0 && c.fecha_vencimiento)
        .map((c) => diasDesdeHoy(c.fecha_vencimiento))
        .filter((d) => d < min)
      if (cortos.length === 0) return []
      return [{ ...it, diasReales: Math.min(...cortos), diasMinimo: min }]
    })
  }, [itemsEstado, facturas, activaIdx])

  const requiereAceptacion =
    itemsPorDebajoMinimo.length > 0 && !aceptaPorDebajoMin

  /** Total de la entrega: la activa (inputs) + las otras pestañas. */
  const totalEntrega = useMemo(
    () =>
      totalUnidades +
      facturas.reduce(
        (acc, f, i) =>
          i === activaIdx ? acc : acc + unidadesDeCargas(f.cargas),
        0
      ),
    [totalUnidades, facturas, activaIdx]
  )

  const procesando = recibir.isPending
  const terminarDeshabilitado =
    procesando || hayErrores || requiereAceptacion || totalEntrega <= 0

  /** Cargas actuales de los inputs (= la factura activa), para snapshot. */
  function cargasDesdeInputs(): Record<number, CargaRenglon> {
    const cargas: Record<number, CargaRenglon> = {}
    for (const it of itemsEstado) {
      if (it.cantidad_recibida !== '' || it.fecha_vencimiento !== '') {
        cargas[it.item_id] = {
          cantidad: it.cantidad_recibida,
          fecha_vencimiento: it.fecha_vencimiento,
        }
      }
    }
    return cargas
  }

  /**
   * Las facturas con la ACTIVA sincronizada desde los inputs. Fuente única
   * para cambiar de pestaña y para armar el payload al confirmar.
   */
  function facturasSincronizadas(): FacturaEntrega[] {
    return facturas.map((f, i) =>
      i === activaIdx ? { ...f, cargas: cargasDesdeInputs() } : f
    )
  }

  /** Activa la pestaña `idx` de `sync`: hidrata los inputs con sus cargas. */
  function activarFactura(sync: FacturaEntrega[], idx: number) {
    setFacturas(sync)
    const destino = sync[idx]
    setItemsEstado((prev) =>
      prev.map((it) => ({
        ...it,
        cantidad_recibida: destino.cargas[it.item_id]?.cantidad ?? '',
        fecha_vencimiento: destino.cargas[it.item_id]?.fecha_vencimiento ?? '',
      }))
    )
    setActivaIdx(idx)
    // El resaltado del escaneo no cruza facturas.
    setActivoId(null)
  }

  /**
   * Cambia de pestaña con autosave: lo tipeado en la actual queda guardado en
   * su borrador. No pide el N° — es obligatorio recién al Confirmar.
   */
  function cambiarDeFactura(idx: number) {
    if (idx === activaIdx || procesando) return
    activarFactura(facturasSincronizadas(), idx)
  }

  /** "Otra factura": abre una pestaña nueva vacía y salta a ella. */
  function agregarFactura() {
    if (procesando) return
    const sync = facturasSincronizadas()
    const nueva: FacturaEntrega = {
      id: `t${proximaTabRef.current++}`,
      numero: '',
      cargas: {},
    }
    activarFactura([...sync, nueva], sync.length)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    numeroFacturaInputRef.current?.focus()
  }

  /**
   * El N° de factura es OBLIGATORIO en toda factura con mercadería: por
   * política de la empresa no quedan facturas a medias (deudas sin
   * identificar que después no se pueden matchear con el papel). Las pestañas
   * vacías se ignoran. Ante un problema salta a la pestaña ofensora.
   */
  function validarFacturas(sync: FacturaEntrega[]): boolean {
    const vistos = new Map<string, number>()
    for (let i = 0; i < sync.length; i++) {
      if (unidadesDeCargas(sync[i].cargas) <= 0) continue
      const num = sync[i].numero.trim()
      if (!num) {
        toast.error(`Poné el N° de la factura ${i + 1} para confirmar.`)
        activarFactura(sync, i)
        window.scrollTo({ top: 0, behavior: 'smooth' })
        numeroFacturaInputRef.current?.focus()
        return false
      }
      const previo = vistos.get(num)
      if (previo != null) {
        toast.error(
          `La factura ${num} está repetida (pestañas ${previo + 1} y ${i + 1}).`
        )
        activarFactura(sync, i)
        window.scrollTo({ top: 0, behavior: 'smooth' })
        numeroFacturaInputRef.current?.focus()
        return false
      }
      vistos.set(num, i)
    }
    return true
  }

  /**
   * Confirmar final: exige la orden COMPLETA (sin recepción parcial, por
   * política) y recién ahí graba todas las facturas juntas, en una sola
   * transacción de `fn_recibir_pedido`. Con faltantes abre el diálogo que
   * ofrece confirmarlos como "no vino".
   */
  function confirmarTodo() {
    if (!usuario || hayErrores || !pedido?.proveedor) return
    // Snapshot de la activa: desde acá todo se calcula sobre `facturas`.
    const sync = facturasSincronizadas()
    setFacturas(sync)
    if (!validarFacturas(sync)) return
    if (itemsFaltantes.length > 0) {
      setDialogFaltanteAbierto(true)
      return
    }
    if (requiereSupervisor) {
      setNoVinoPendiente([])
      setModalSupervisorAbierto(true)
      return
    }
    ejecutarRecepcion()
  }

  /**
   * "No vinieron — descontar y recibir": los faltantes se confirman como no
   * venidos (0 → el renglón se elimina de la orden; incompleto → la pedida
   * baja a lo recibido) y la orden se recibe completa, todo en la misma
   * transacción. Si además hay exceso, primero pasa por el supervisor.
   */
  function confirmarNoVino() {
    const ids = itemsFaltantes.map((it) => it.item_id)
    setDialogFaltanteAbierto(false)
    if (requiereSupervisor) {
      setNoVinoPendiente(ids)
      setModalSupervisorAbierto(true)
      return
    }
    ejecutarRecepcion(ids)
  }

  function ejecutarRecepcion(noVino: number[] = []) {
    if (!usuario || !pedido?.proveedor) return
    // Facturas en orden de pestañas (las vacías se descartan solas); dentro de
    // cada una, sus renglones en el orden visual de la lista = el orden del
    // papel. El `orden` corre entre facturas. Una fila por (factura, renglón
    // con cantidad): el RPC acumula filas repetidas del mismo item y arma una
    // cuenta a pagar por factura_ref.
    const conCarga = facturasSincronizadas().filter(
      (f) => unidadesDeCargas(f.cargas) > 0
    )
    let orden = 0
    const items = conCarga.flatMap((f, idx) =>
      itemsEstado
        .filter((it) => (Number(f.cargas[it.item_id]?.cantidad) || 0) > 0)
        .map((it) => ({
          item_id: it.item_id,
          producto_id: it.producto_id,
          cantidad_recibida: Number(f.cargas[it.item_id].cantidad),
          precio_costo: it.precio_costo,
          fecha_vencimiento: f.cargas[it.item_id].fecha_vencimiento || null,
          factura_ref: `f${idx + 1}`,
          numero_factura: f.numero.trim() || null,
          orden: ++orden,
        }))
    )
    if (items.length === 0) return
    recibir.mutate(
      {
        pedido_id: pedido.id,
        proveedor_id: pedido.proveedor.id,
        usuario_id: usuario.id,
        condicion_pago_dias: condicionDias,
        items,
        no_vino: noVino,
      },
      {
        onSuccess: () => router.push('/movil/recepcion'),
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
      // aplicamos al ítem existente, lo acomodamos detrás de lo ya cargado
      // (orden del papel) y lo resaltamos.
      setItemsEstado((prev) =>
        moverAlFinalDeCargados(prev, yaEnLista.item_id).map((it) =>
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
    const nuevo: ItemEstado = {
      item_id: nuevoItem.id,
      producto_id: prod.id,
      nombre: prod.nombre,
      codigo_barras: prod.codigo_barras,
      cantidad_pedida: cant,
      ya_recibido: 0,
      precio_costo: 0,
      cantidad_recibida: String(cant),
      venta_por_peso: prod.venta_por_peso,
      fecha_vencimiento: venc,
      dias_vencimiento_minimo: prod.dias_vencimiento_minimo,
    }
    // Entra detrás de lo ya cargado, no al fondo de la lista: acaba de bajar
    // del camión, así que va en ese lugar del papel.
    setItemsEstado((prev) => {
      let destino = 0
      prev.forEach((it, i) => {
        if (estaCargado(it)) destino = i + 1
      })
      return [...prev.slice(0, destino), nuevo, ...prev.slice(destino)]
    })
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

      {/* Se desmonta mientras se edita un código: el modal usa la cámara y el
          teléfono no da dos streams a la vez. */}
      <div className="mb-4">
        {productoCodigo ? (
          <div className="rounded-2xl border border-dashed border-[#e4c9b0] bg-white/60 p-4 text-center text-xs text-[#6f3a2a]">
            Cámara en uso por el código de barras…
          </div>
        ) : (
          <EscanerCamara
            onDetectado={alEscanear}
            ayuda="Escaneá un producto y cargá cuántas llegaron"
          />
        )}
      </div>

      {/* Pestañas de facturas: todas son borradores editables hasta el final */}
      <div className="mb-4">
        {facturas.length > 1 && (
          <div className="-mx-4 mb-2 flex gap-1.5 overflow-x-auto px-4 pb-1">
            {facturas.map((f, i) => {
              const activa = i === activaIdx
              const unidades =
                activa ? totalUnidades : unidadesDeCargas(f.cargas)
              const numero = f.numero.trim()
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => cambiarDeFactura(i)}
                  className={cn(
                    'flex h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition active:scale-95',
                    activa
                      ? 'border-[#e4a42a] bg-[#f9b44c] text-[#391511]'
                      : 'border-[#e4c9b0] bg-white text-[#6f3a2a]'
                  )}
                >
                  {numero ? (
                    <Check
                      className={cn(
                        'h-3.5 w-3.5 shrink-0',
                        activa ? 'text-[#391511]' : 'text-[#9e6b15]'
                      )}
                    />
                  ) : unidades > 0 ? (
                    // Tiene mercadería pero le falta el N° (obligatorio al final).
                    <span className="h-2 w-2 shrink-0 rounded-full bg-[#e4a42a]" />
                  ) : null}
                  <span className="max-w-28 truncate">
                    {numero ? `Fact. ${numero}` : `Factura ${i + 1}`}
                  </span>
                  <span className="shrink-0 tabular-nums opacity-80">
                    {formatearNumero(Math.round(unidades * 1000) / 1000)} u.
                  </span>
                </button>
              )
            })}
            <button
              type="button"
              onClick={agregarFactura}
              disabled={procesando}
              aria-label="Otra factura"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-dashed border-[#e4c9b0] bg-white/60 text-[#9e6b15] active:scale-95"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        )}

        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#6f3a2a]">
          {facturas.length > 1
            ? `Factura ${activaIdx + 1} de ${facturas.length}`
            : 'Factura de esta entrega'}
        </p>
        <Input
          ref={numeroFacturaInputRef}
          value={facturas[activaIdx]?.numero ?? ''}
          onChange={(e) =>
            setFacturas((prev) =>
              prev.map((f, i) =>
                i === activaIdx ? { ...f, numero: e.target.value } : f
              )
            )
          }
          placeholder="N° de la factura (obligatorio)"
          className="h-11 border-[#e4c9b0] text-sm focus-visible:ring-[#f9b44c]"
        />
        <p className="mt-1.5 text-[11px] leading-snug text-[#6f3a2a]">
          ¿Vinieron varias facturas? Tocá <strong>Otra factura</strong> para
          abrir una pestaña nueva. Podés volver a cualquiera para controlarla o
          corregirla — nada se guarda hasta el <strong>Confirmar</strong> final,
          con la orden completa.
        </p>
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
          const renglon = numeroRenglon.get(it.item_id)
          // "Ya recibido" junta lo de la base con las facturas locales.
          const yaTotal = it.ya_recibido + (recibidoOtras.get(it.item_id) ?? 0)
          const diferencia = yaTotal + cantNum - it.cantidad_pedida
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
                  <p className="font-medium text-[#391511]">
                    {renglon != null && (
                      <span className="mr-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#f9b44c] px-1 text-[10px] font-bold tabular-nums text-[#391511]">
                        {renglon}
                      </span>
                    )}
                    {it.nombre}
                    {it.venta_por_peso && (
                      <span className="ml-1.5 rounded bg-[#f9b44c]/20 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#9e6b15]">
                        Por kg
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-[#6f3a2a]">
                    Pedido:{' '}
                    <span className="font-semibold tabular-nums">
                      {formatearCantidad(it.cantidad_pedida, it.venta_por_peso)}
                    </span>
                    {yaTotal > 0 && (
                      <>
                        {' '}
                        · ya recibido{' '}
                        <span className="font-semibold tabular-nums">
                          {formatearCantidad(yaTotal, it.venta_por_peso)}
                        </span>
                      </>
                    )}
                  </p>
                  {/* Código de barras: el encargado lo ve y lo corrige acá
                      mismo (un producto dado de alta al vuelo queda con el
                      HEX-… autogenerado y no se puede escanear). */}
                  <div className="mt-0.5 flex items-center gap-1.5">
                    {esCodigoAutogenerado(it.codigo_barras) ? (
                      <span className="rounded bg-[#c43e2c]/10 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#c43e2c]">
                        Sin código
                      </span>
                    ) : (
                      <span className="truncate font-mono text-[10px] text-[#c8a58a]">
                        {it.codigo_barras}
                      </span>
                    )}
                    {puedeEditarCodigo && (
                      <button
                        type="button"
                        onClick={() =>
                          setProductoCodigo({
                            id: it.producto_id,
                            nombre: it.nombre,
                            codigo_barras: it.codigo_barras,
                          })
                        }
                        className="flex h-6 items-center gap-1 rounded-md border border-[#e4c9b0] px-1.5 text-[10px] font-semibold text-[#9e6b15] active:scale-95"
                      >
                        <Barcode className="h-3 w-3" />
                        {esCodigoAutogenerado(it.codigo_barras)
                          ? 'Agregar'
                          : 'Editar'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Flechas del orden del papel: solo en los renglones cargados,
                    que son los que se envían y numeran. */}
                {renglon != null && (
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => moverItem(it.item_id, -1)}
                      disabled={renglon === ordenBase + 1}
                      aria-label="Subir un lugar"
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-[#e4c9b0] bg-[#fdfaf6] text-[#9e6b15] active:scale-95 disabled:opacity-30"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moverItem(it.item_id, 1)}
                      disabled={renglon === ordenBase + numeroRenglon.size}
                      aria-label="Bajar un lugar"
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-[#e4c9b0] bg-[#fdfaf6] text-[#9e6b15] active:scale-95 disabled:opacity-30"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a]">
                    Recibido {it.venta_por_peso && <span className="text-[#9e6b15]">(kg)</span>}
                  </Label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      ref={(el) => {
                        inputRefs.current[it.item_id] = el
                      }}
                      type="number"
                      min="0"
                      step={it.venta_por_peso ? '0.001' : '1'}
                      inputMode={it.venta_por_peso ? 'decimal' : 'numeric'}
                      value={it.cantidad_recibida}
                      onChange={(e) =>
                        actualizarItem(it.item_id, {
                          cantidad_recibida: e.target.value,
                        })
                      }
                      placeholder={it.venta_por_peso ? '0,000' : '0'}
                      className="h-12 flex-1 border-[#e4c9b0] text-lg tabular-nums focus-visible:ring-[#f9b44c]"
                    />
                    {it.venta_por_peso ? (
                      <span className="flex h-12 w-11 shrink-0 items-center justify-center rounded-md border border-[#e4c9b0] bg-[#fdfaf6] text-sm font-bold text-[#9e6b15]">
                        kg
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => sumarUno(it.item_id)}
                        className="h-12 w-11 shrink-0 rounded-md border border-[#e4c9b0] bg-[#fdfaf6] text-sm font-bold text-[#9e6b15] active:scale-95"
                        aria-label="Sumar 1"
                      >
                        +1
                      </button>
                    )}
                  </div>
                  {it.venta_por_peso &&
                    cantNum > 0 &&
                    (pareceGramosEnKg(it.cantidad_recibida) ? (
                      <div className="mt-1 rounded-lg border-2 border-[#c43e2c]/60 bg-[#c43e2c]/10 p-2 space-y-1.5">
                        <p className="text-[11px] text-[#c43e2c] font-bold flex items-start gap-1">
                          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          ¿{formatearNumero(cantNum)} KILOS? Parece un peso en
                          gramos de la balanza.
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            actualizarItem(it.item_id, {
                              cantidad_recibida: String(cantNum / 1000),
                            })
                          }
                          className="w-full rounded-md border border-[#c43e2c]/50 bg-white px-2 py-1.5 text-xs font-bold text-[#c43e2c] active:bg-[#c43e2c]/10"
                        >
                          Eran gramos → usar{' '}
                          {formatearCantidad(cantNum / 1000, true)}
                        </button>
                      </div>
                    ) : (
                      <p className="mt-0.5 text-[10px] text-[#6f3a2a]">
                        = {formatearNumero(Math.round(cantNum * 1000))} g
                      </p>
                    ))}
                  {diferencia !== 0 && !Number.isNaN(diferencia) && cantNum > 0 && (
                    <p
                      className={
                        diferencia > 0
                          ? 'mt-0.5 text-[10px] text-[#9e6b15]'
                          : 'mt-0.5 text-[10px] text-[#c43e2c]'
                      }
                    >
                      {diferencia > 0 ? '+' : '−'}
                      {formatearCantidad(Math.abs(diferencia), it.venta_por_peso)} vs.
                      pedido
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
        <div className="mx-auto flex max-w-md items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a]">
              {facturas.length > 1
                ? 'Esta factura'
                : itemsEstado.some((it) => it.ya_recibido > 0)
                  ? 'Esta entrega'
                  : 'A recibir'}
            </div>
            <div className="text-xl font-extrabold tabular-nums text-[#391511]">
              {formatearNumero(Math.round(totalUnidades * 1000) / 1000)} u.
            </div>
            {totalEntrega !== totalUnidades && (
              <div className="text-[10px] tabular-nums text-[#6f3a2a]">
                Entrega:{' '}
                {formatearNumero(Math.round(totalEntrega * 1000) / 1000)} u.
              </div>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={agregarFactura}
              disabled={procesando}
              className="h-12 border-[#e4a42a]/60 px-3 text-[#9e6b15]"
            >
              <Plus className="mr-1 h-4 w-4" />
              Otra factura
            </Button>
            <Button
              type="button"
              onClick={confirmarTodo}
              disabled={terminarDeshabilitado}
              className="h-12 bg-[#f9b44c] px-4 font-semibold text-[#391511] hover:bg-[#e4a42a]"
            >
              {procesando ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  …
                </>
              ) : facturas.length > 1 ? (
                'Confirmar todo'
              ) : (
                'Confirmar'
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Editar / asignar el código de barras (solo permiso `compras`). No se
          invalida el pedido: un refetch borraría lo ya tipeado. */}
      <ModalCodigoBarras
        abierto={productoCodigo != null}
        onCambioAbierto={(v) => {
          if (!v) setProductoCodigo(null)
        }}
        producto={productoCodigo}
        onGuardado={(productoId, codigo) =>
          setItemsEstado((prev) =>
            prev.map((it) =>
              it.producto_id === productoId
                ? { ...it, codigo_barras: codigo }
                : it
            )
          )
        }
      />

      <ModalClaveSupervisor
        abierto={modalSupervisorAbierto}
        onCambioAbierto={setModalSupervisorAbierto}
        motivo={`Se está recibiendo más cantidad de la pedida en ${itemsConExceso.length} producto(s). Un encargado debe autorizarlo.`}
        detalle={itemsConExceso.map((it) => {
          const rec =
            it.ya_recibido +
            (recibidoOtras.get(it.item_id) ?? 0) +
            (Number(it.cantidad_recibida) || 0)
          // Sin importes: el móvil lo usa el mostrador, que no ve costos.
          return `${it.nombre}: pedido ${formatearCantidad(it.cantidad_pedida, it.venta_por_peso)} → recibiendo ${formatearCantidad(rec, it.venta_por_peso)}`
        })}
        onAutorizado={(nombre) => {
          setExcesoAutorizado(true)
          setAutorizadoPor(nombre)
          ejecutarRecepcion(noVinoPendiente)
        }}
      />

      {/* Diálogo de faltantes: la orden se recibe completa — lo que no vino
          se puede descontar acá mismo (la orden se ajusta y queda auditado) */}
      <Dialog
        open={dialogFaltanteAbierto}
        onOpenChange={setDialogFaltanteAbierto}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#391511]">
              <AlertTriangle className="h-5 w-5 text-[#c43e2c]" />
              Falta mercadería del pedido
            </DialogTitle>
            <DialogDescription className="text-[#6f3a2a]">
              Faltan{' '}
              <strong className="tabular-nums">
                {formatearNumero(Math.round(unidadesFaltantes * 1000) / 1000)} u.
              </strong>{' '}
              de lo pedido. Si el proveedor no las trajo, se descuentan de la
              orden y se recibe completa:
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-[#e4c9b0]/60 bg-[#fdfaf6] p-2 text-xs text-[#391511]">
            {itemsFaltantes.slice(0, 6).map((it) => {
              const queda = it.cantidad_pedida - it.falta
              return (
                <li
                  key={it.item_id}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="min-w-0 truncate font-medium">
                    {it.nombre}
                  </span>
                  <span className="shrink-0 tabular-nums text-[#c43e2c]">
                    {queda <= 0
                      ? 'no vino — se saca de la orden'
                      : `queda en ${formatearCantidad(queda, it.venta_por_peso)}`}
                  </span>
                </li>
              )
            })}
            {itemsFaltantes.length > 6 && (
              <li className="pt-1 text-[#6f3a2a]">
                …y {itemsFaltantes.length - 6} producto
                {itemsFaltantes.length - 6 === 1 ? '' : 's'} más
              </li>
            )}
          </ul>
          <div className="space-y-2">
            <Button
              type="button"
              onClick={confirmarNoVino}
              disabled={procesando}
              className="h-12 w-full bg-[#f9b44c] font-semibold text-[#391511] hover:bg-[#e4a42a]"
            >
              No vinieron — descontar y recibir
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogFaltanteAbierto(false)}
              disabled={procesando}
              className="h-12 w-full border-[#e4c9b0] text-[#6f3a2a]"
            >
              Volver a cargar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
                <Label className="text-xs text-[#6f3a2a]">
                  {productoSeleccionado?.venta_por_peso
                    ? 'Peso que llegó (kg)'
                    : 'Unidades que llegaron'}
                </Label>
                <Input
                  type="number"
                  min={productoSeleccionado?.venta_por_peso ? '0' : '1'}
                  step={productoSeleccionado?.venta_por_peso ? '0.001' : '1'}
                  inputMode={
                    productoSeleccionado?.venta_por_peso ? 'decimal' : 'numeric'
                  }
                  value={nuevoCantidad}
                  onChange={(e) => setNuevoCantidad(e.target.value)}
                  placeholder={productoSeleccionado?.venta_por_peso ? '0,000' : '0'}
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
