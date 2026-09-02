'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  Loader2,
  PackageCheck,
  Plus,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { BannerBorrador } from './recepcion/BannerBorrador'
import { FilaFactura } from './recepcion/FilaFactura'
import { FilaPendiente } from './recepcion/FilaPendiente'
import { HojaCargaRenglon } from './recepcion/HojaCargaRenglon'
import { HojaRevision } from './recepcion/HojaRevision'
import { ModalAgregarProducto } from './recepcion/ModalAgregarProducto'
import { PestanasFactura } from './recepcion/PestanasFactura'
import {
  cantidadDe,
  cargaVacia,
  conRenglonEnFactura,
  conRenglonMovido,
  sinRenglonEnFactura,
  type Advertencia,
  type ItemEstado,
  type ProdParaAgregar,
} from './recepcion/tipos'
import { usePedidoDetalle, useRecibirPedido } from '@/lib/hooks/usePedidos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { useAutosaveBorrador } from '@/lib/hooks/useAutosaveBorrador'
import { agregarItemPedido, parsearDiasCondicionPago } from '@/lib/queries/pedidos'
import { toggleProductoActivo } from '@/lib/queries/productos'
import {
  BORRADOR_RECEPCION_V,
  claveBorradorRecepcion,
  facturaEnBlanco,
  facturaVacia,
  reconciliarBorrador,
  unidadesDeCargas,
  type BorradorRecepcion,
  type CargaRenglon,
  type FacturaEntrega,
} from '@/lib/recepcion/borrador'
import { leerBorrador, purgarBorradoresVencidos } from '@/lib/utils/borradores'
import { diasHasta } from '@/lib/utils/fechaCorta'
import {
  formatearCantidad,
  formatearFechaCorta,
  formatearNumero,
} from '@/lib/utils/formato'
import { tienePermiso } from '@/lib/permisos'
import { cn } from '@/lib/utils'

interface Props {
  pedidoId: number
}

interface Restauracion {
  renglones: number
  facturas: number
  nombresDescartados: string[]
  recibidoCambio: number
}

/**
 * Recepción de un pedido desde el teléfono.
 *
 * El flujo real del negocio: llega el camión, le dan la factura al empleado, y
 * este escanea los productos EN EL ORDEN EN QUE SALEN EN EL PAPEL, cargando
 * cuántos llegaron y cuándo vencen. Ese orden viaja como
 * `items_pedido.orden_recepcion` para que administración después cargue los
 * precios en el mismo orden que tiene la factura en la mano.
 *
 * ── Cómo está armado ──────────────────────────────────────────────────
 *
 * `facturas` es la ÚNICA fuente de verdad de todo lo tipeado: cada pestaña
 * tiene su `numero`, sus `cargas` por renglón y su `orden` (los renglones que
 * están en ese papel, en su posición). `itemsEstado` es solo el pool de lo que
 * dice la orden en la base, de solo lectura.
 *
 * Estar "en la factura" es estar en `orden`, no tener cantidad. Por eso un
 * renglón recién escaneado ya se puede acomodar aunque todavía no se le haya
 * puesto la cantidad — que es lo que antes no se podía.
 *
 * La carga de cada renglón ocurre en una hoja modal (`HojaCargaRenglon`) que se
 * abre sola al escanear: un producto por vez, sin una pared de 80 inputs.
 *
 * ── Política de la empresa ────────────────────────────────────────────
 *
 * Nada viaja a la base hasta el Confirmar final, y la orden se recibe COMPLETA
 * o no se recibe. Si al confirmar faltan renglones, el diálogo de faltantes
 * ofrece darlos por "no vino": la orden se ajusta en la misma transacción (0
 * recibido → el renglón se elimina; incompleto → la pedida baja a lo recibido).
 * Queda en auditoría.
 *
 * La única excepción a "nada se graba antes" es agregar un producto que no
 * estaba en la orden: eso hace un INSERT real en `items_pedido`, así que esos
 * renglones vuelven solos en un refetch.
 *
 * Como no hay nada en el servidor, el trabajo a medias se guarda en el teléfono
 * (`lib/recepcion/borrador.ts` + `useAutosaveBorrador`): un F5, quedarse sin
 * batería o que Android descarte la pestaña ya no borran la descarga.
 */
export function RecepcionMovil({ pedidoId }: Props) {
  const router = useRouter()
  const { data: usuario } = useUsuario()
  const { data: pedido, isLoading } = usePedidoDetalle(pedidoId)
  const recibir = useRecibirPedido()

  const [itemsEstado, setItemsEstado] = useState<ItemEstado[]>([])
  const [facturas, setFacturas] = useState<FacturaEntrega[]>([facturaVacia('t1')])
  const [activaIdx, setActivaIdx] = useState(0)
  const proximaTabRef = useRef(2)

  // Gate del autoguardado. Es STATE y no ref a propósito: hasta que la
  // inicialización no terminó, el estado está vacío y guardarlo pisaría el
  // borrador que justo estamos por restaurar.
  const [listo, setListo] = useState(false)
  const [restauracion, setRestauracion] = useState<Restauracion | null>(null)

  const [editandoId, setEditandoId] = useState<number | null>(null)
  const [activoId, setActivoId] = useState<number | null>(null)
  const [revisionAbierta, setRevisionAbierta] = useState(false)
  const [controlado, setControlado] = useState(false)
  const [verPendientes, setVerPendientes] = useState(true)
  const [busquedaPendientes, setBusquedaPendientes] = useState('')

  const [aceptaPorDebajoMin, setAceptaPorDebajoMin] = useState(false)
  const [excesoAutorizado, setExcesoAutorizado] = useState(false)
  const [autorizadoPor, setAutorizadoPor] = useState<string | null>(null)
  const [modalSupervisorAbierto, setModalSupervisorAbierto] = useState(false)
  const [dialogFaltanteAbierto, setDialogFaltanteAbierto] = useState(false)
  const [noVinoPendiente, setNoVinoPendiente] = useState<number[]>([])
  const [dialogCerrarFactura, setDialogCerrarFactura] = useState<number | null>(null)

  const [modalAgregarAbierto, setModalAgregarAbierto] = useState(false)
  const [codigoNoEncontrado, setCodigoNoEncontrado] = useState('')
  const [productoCodigo, setProductoCodigo] = useState<{
    id: number
    nombre: string
    codigo_barras: string | null
  } | null>(null)

  const puedeEditarCodigo = tienePermiso(usuario?.permisos, 'compras')
  const procesando = recibir.isPending

  // ── Inicialización: una por pedido, con restauración del borrador ─────
  // El ref se escribe ANTES de cualquier setState y el borrador se lee de
  // localStorage, que es síncrono: no hay una segunda pasada asíncrona donde
  // un refetch de TanStack pueda pisar lo tipeado.
  const inicializadoRef = useRef<number | null>(null)
  const [reinit, setReinit] = useState(0)

  useEffect(() => {
    if (!pedido) return
    if (inicializadoRef.current === pedido.id) return
    inicializadoRef.current = pedido.id

    const base: ItemEstado[] = pedido.items.map((it) => ({
      item_id: it.id,
      producto_id: it.producto_id,
      nombre: it.producto?.nombre ?? 'Producto eliminado',
      codigo_barras: it.producto?.codigo_barras ?? null,
      cantidad_pedida: it.cantidad_pedida,
      ya_recibido: it.cantidad_recibida ?? 0,
      precio_costo: it.precio_costo,
      venta_por_peso: it.producto?.venta_por_peso ?? false,
      dias_vencimiento_minimo: it.producto?.dias_vencimiento_minimo ?? null,
    }))
    setItemsEstado(base)

    purgarBorradoresVencidos()
    const crudo = leerBorrador<BorradorRecepcion>(claveBorradorRecepcion(pedido.id))
    const rec = reconciliarBorrador(
      crudo,
      base.map((it) => ({ item_id: it.item_id, ya_recibido: it.ya_recibido }))
    )

    if (rec) {
      setFacturas(rec.borrador.facturas)
      setActivaIdx(rec.borrador.activaIdx)
      proximaTabRef.current = rec.borrador.proximaTab
      setRestauracion({
        renglones: rec.borrador.facturas.reduce((a, f) => a + f.orden.length, 0),
        facturas: rec.borrador.facturas.filter((f) => !facturaEnBlanco(f)).length,
        nombresDescartados: rec.nombresDescartados,
        recibidoCambio: rec.recibidoCambio.length,
      })
    } else {
      setFacturas([facturaVacia('t1')])
      setActivaIdx(0)
      proximaTabRef.current = 2
      setRestauracion(null)
    }

    // Consentimientos y autorizaciones NUNCA se restauran: que un exceso quede
    // autorizado tras un reload, sin que nadie lo vuelva a mirar, sería un
    // agujero. Lo mismo el "acepto recibir igual" de vencimiento corto.
    setAceptaPorDebajoMin(false)
    setExcesoAutorizado(false)
    setAutorizadoPor(null)
    setNoVinoPendiente([])
    setControlado(false)
    setListo(true)
  }, [pedido, reinit])

  // ── Autoguardado ──────────────────────────────────────────────────────
  const foto = useMemo<BorradorRecepcion | null>(() => {
    if (!listo) return null
    const nombres: Record<number, string> = {}
    const yaRecibido: Record<number, number> = {}
    for (const it of itemsEstado) {
      if (it.ya_recibido !== 0) yaRecibido[it.item_id] = it.ya_recibido
      if (facturas.some((f) => cantidadDe(f, it.item_id) > 0)) {
        nombres[it.item_id] = it.nombre
      }
    }
    return {
      v: BORRADOR_RECEPCION_V,
      facturas,
      activaIdx,
      proximaTab: proximaTabRef.current,
      nombres,
      yaRecibido,
    }
  }, [listo, itemsEstado, facturas, activaIdx])

  const borrador = useAutosaveBorrador(claveBorradorRecepcion(pedidoId), foto, {
    activo: listo && !procesando,
  })

  function descartarBorrador() {
    borrador.descartar()
    inicializadoRef.current = null
    setListo(false)
    setRestauracion(null)
    setReinit((n) => n + 1)
  }

  // ── Derivados ─────────────────────────────────────────────────────────
  const porId = useMemo(
    () => new Map(itemsEstado.map((it) => [it.item_id, it])),
    [itemsEstado]
  )
  const activa = facturas[activaIdx] ?? facturas[0]

  /** Renglones ya numerados en las pestañas anteriores a la activa. */
  const ordenBase = useMemo(
    () => facturas.slice(0, activaIdx).reduce((a, f) => a + f.orden.length, 0),
    [facturas, activaIdx]
  )

  /** Acumulado por renglón de las OTRAS facturas de la entrega. */
  const recibidoOtras = useMemo(() => {
    const m = new Map<number, number>()
    facturas.forEach((f, i) => {
      if (i === activaIdx) return
      for (const id of f.orden) {
        const c = cantidadDe(f, id)
        if (c > 0) m.set(id, (m.get(id) ?? 0) + c)
      }
    })
    return m
  }, [facturas, activaIdx])

  /** Total recibido de un renglón: la base + todas las facturas de la entrega. */
  const totalDe = useCallback(
    (item_id: number) => {
      const it = porId.get(item_id)
      if (!it) return 0
      return (
        it.ya_recibido +
        facturas.reduce((a, f) => a + cantidadDe(f, item_id), 0)
      )
    },
    [porId, facturas]
  )

  const pendientes = useMemo(() => {
    const enFactura = new Set(activa?.orden ?? [])
    const q = busquedaPendientes.trim().toLowerCase()
    return itemsEstado.filter((it) => {
      if (enFactura.has(it.item_id)) return false
      if (!q) return true
      return (
        it.nombre.toLowerCase().includes(q) ||
        (it.codigo_barras ?? '').toLowerCase().includes(q)
      )
    })
  }, [itemsEstado, activa, busquedaPendientes])

  /** Renglones de toda la orden que ya tienen cantidad en alguna factura. */
  const controlados = useMemo(
    () =>
      itemsEstado.filter((it) =>
        facturas.some((f) => cantidadDe(f, it.item_id) > 0)
      ).length,
    [itemsEstado, facturas]
  )

  const totalEntrega = useMemo(
    () => facturas.reduce((a, f) => a + unidadesDeCargas(f.cargas), 0),
    [facturas]
  )

  /** Renglones que todavía no llegan a lo pedido. */
  const itemsFaltantes = useMemo(
    () =>
      itemsEstado.flatMap((it) => {
        const falta = it.cantidad_pedida - totalDe(it.item_id)
        return falta > 0 ? [{ ...it, falta }] : []
      }),
    [itemsEstado, totalDe]
  )
  const unidadesFaltantes = itemsFaltantes.reduce((a, it) => a + it.falta, 0)

  /**
   * Solo cuenta como exceso lo que ESTA entrega agrega por encima del pedido:
   * un exceso ya autorizado en una recepción anterior no vuelve a pedir clave.
   */
  const itemsConExceso = useMemo(
    () =>
      itemsEstado.filter((it) => {
        const nuevo = facturas.reduce((a, f) => a + cantidadDe(f, it.item_id), 0)
        return nuevo > 0 && it.ya_recibido + nuevo > it.cantidad_pedida
      }),
    [itemsEstado, facturas]
  )
  const requiereSupervisor = itemsConExceso.length > 0 && !excesoAutorizado

  /** Renglones cargados con una fecha por debajo del mínimo del producto. */
  const itemsPorDebajoMinimo = useMemo(
    () =>
      itemsEstado.flatMap((it) => {
        const min = it.dias_vencimiento_minimo
        if (min == null) return []
        const cortos = facturas
          .map((f) => f.cargas[it.item_id])
          .filter(
            (c): c is CargaRenglon =>
              c != null && (Number(c.cantidad) || 0) > 0 && !!c.fecha_vencimiento
          )
          .map((c) => diasHasta(c.fecha_vencimiento))
          .filter((d): d is number => d != null && d < min)
        return cortos.length === 0 ? [] : [{ ...it, diasReales: Math.min(...cortos) }]
      }),
    [itemsEstado, facturas]
  )
  const requiereAceptacion = itemsPorDebajoMinimo.length > 0 && !aceptaPorDebajoMin

  /** Renglones que están en el papel pero quedaron sin cantidad. */
  const sinCantidad = useMemo(
    () =>
      facturas.flatMap((f, idx) =>
        f.orden
          .filter((id) => cantidadDe(f, id) <= 0)
          .map((id) => ({ item_id: id, facturaIdx: idx }))
      ),
    [facturas]
  )

  const advertencias = useMemo<Advertencia[]>(() => {
    const lista: Advertencia[] = []

    // El N° es obligatorio en toda factura con mercadería: sin él la deuda al
    // proveedor después no se puede matchear con el papel.
    const vistos = new Map<string, number>()
    facturas.forEach((f, i) => {
      if (unidadesDeCargas(f.cargas) <= 0) return
      const num = f.numero.trim()
      if (!num) {
        lista.push({
          clave: 'sin_numero',
          bloqueante: true,
          texto: `A la factura ${i + 1} le falta el N°.`,
          facturaIdx: i,
        })
        return
      }
      const previo = vistos.get(num)
      if (previo != null) {
        lista.push({
          clave: 'numero_repetido',
          bloqueante: true,
          texto: `El N° ${num} está repetido en las facturas ${previo + 1} y ${i + 1}.`,
          facturaIdx: i,
        })
      }
      vistos.set(num, i)
    })

    if (sinCantidad.length > 0) {
      lista.push({
        clave: 'sin_cantidad',
        bloqueante: true,
        texto: `${sinCantidad.length} renglón${sinCantidad.length === 1 ? '' : 'es'} en la factura sin cantidad. Cargala o sacalo del papel.`,
        facturaIdx: sinCantidad[0].facturaIdx,
      })
    }

    const sinFecha = facturas.reduce(
      (acc, f) =>
        acc +
        f.orden.filter((id) => {
          const c = f.cargas[id]
          return (
            (Number(c?.cantidad) || 0) > 0 &&
            !c?.fecha_vencimiento &&
            !c?.sin_vencimiento
          )
        }).length,
      0
    )
    if (sinFecha > 0) {
      lista.push({
        clave: 'sin_fecha',
        bloqueante: false,
        texto: `${sinFecha} renglón${sinFecha === 1 ? '' : 'es'} sin fecha de vencimiento. No se les va a crear lote.`,
      })
    }

    if (itemsFaltantes.length > 0) {
      lista.push({
        clave: 'faltantes',
        bloqueante: false,
        texto: `Faltan ${formatearNumero(Math.round(unidadesFaltantes * 1000) / 1000)} u. de lo pedido. Al confirmar se pregunta si no vinieron.`,
      })
    }

    if (itemsConExceso.length > 0) {
      lista.push({
        clave: 'excesos',
        bloqueante: false,
        texto: `${itemsConExceso.length} renglón${itemsConExceso.length === 1 ? '' : 'es'} con más de lo pedido. Va a pedir clave de encargado.`,
      })
    }

    return lista
  }, [facturas, sinCantidad, itemsFaltantes, unidadesFaltantes, itemsConExceso])

  const confirmarDeshabilitado =
    procesando || requiereAceptacion || totalEntrega <= 0

  // ── Acciones sobre la factura activa ──────────────────────────────────
  const editarActiva = useCallback(
    (fn: (f: FacturaEntrega) => FacturaEntrega) => {
      setFacturas((prev) => prev.map((f, i) => (i === activaIdx ? fn(f) : f)))
    },
    [activaIdx]
  )

  const abrirCarga = useCallback(
    (item_id: number) => {
      editarActiva((f) => conRenglonEnFactura(f, item_id))
      setActivoId(item_id)
      setEditandoId(item_id)
    },
    [editarActiva]
  )

  function guardarCarga(item_id: number, carga: CargaRenglon) {
    editarActiva((f) => ({
      ...conRenglonEnFactura(f, item_id),
      cargas: { ...f.cargas, [item_id]: carga },
    }))
  }

  /**
   * Cierra la hoja de carga. Un renglón que se abrió y se cerró sin cargar nada
   * sale del papel: se tocó por error (o se escaneó el producto equivocado) y
   * dejarlo ahí lo único que hace es bloquear el confirmar más tarde.
   */
  function cerrarCarga() {
    const id = editandoId
    setEditandoId(null)
    if (id == null) return
    const c = activa?.cargas[id]
    const vacio =
      !c || (c.cantidad === '' && c.fecha_vencimiento === '' && !c.sin_vencimiento)
    if (vacio) {
      editarActiva((f) => sinRenglonEnFactura(f, id))
      if (activoId === id) setActivoId(null)
    }
  }

  function quitarDeFactura(item_id: number) {
    editarActiva((f) => sinRenglonEnFactura(f, item_id))
    setEditandoId(null)
    if (activoId === item_id) setActivoId(null)
  }

  function moverEnFactura(item_id: number, direccion: -1 | 1) {
    editarActiva((f) => conRenglonMovido(f, item_id, direccion))
  }

  function agregarFactura() {
    if (procesando) return
    const nueva = facturaVacia(`t${proximaTabRef.current++}`)
    setFacturas((prev) => [...prev, nueva])
    setActivaIdx(facturas.length)
    setActivoId(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cerrarFactura(idx: number) {
    const f = facturas[idx]
    if (!f || facturas.length <= 1) return
    if (!facturaEnBlanco(f)) {
      setDialogCerrarFactura(idx)
      return
    }
    eliminarFactura(idx)
  }

  function eliminarFactura(idx: number) {
    setFacturas((prev) => prev.filter((_, i) => i !== idx))
    setActivaIdx((prev) => Math.max(0, Math.min(prev, facturas.length - 2)))
    setDialogCerrarFactura(null)
    setActivoId(null)
    // `proximaTabRef` NO se decrementa: los ids de pestaña tienen que seguir
    // siendo únicos aunque se borren.
  }

  /**
   * Escaneo: mete el producto en el papel y abre su hoja para cargar la
   * cantidad. Si no está en la orden, ofrece buscarlo o darlo de alta.
   */
  function alEscanear(codigo: string) {
    const item = itemsEstado.find((it) => it.codigo_barras === codigo)
    if (!item) {
      setCodigoNoEncontrado(codigo)
      setModalAgregarAbierto(true)
      toast.error('No está en el pedido. Buscalo o cargalo para sumarlo.')
      return
    }
    abrirCarga(item.item_id)
  }

  /** Suma un producto que no estaba en la orden. Esto SÍ toca la base. */
  async function agregarProductoALista(
    prod: ProdParaAgregar,
    cant: number,
    venc: string
  ) {
    const yaEnLista = itemsEstado.find((it) => it.producto_id === prod.id)
    if (yaEnLista) {
      guardarCarga(yaEnLista.item_id, {
        cantidad: String(cant),
        fecha_vencimiento: venc,
      })
      setActivoId(yaEnLista.item_id)
      toast.info(`${prod.nombre} ya estaba en la lista — actualicé la cantidad.`)
      return
    }
    // Si estaba dado de baja lo reactivamos: si no, el stock recibido quedaría
    // en un producto oculto del POS y del inventario.
    if (!prod.activo) {
      try {
        await toggleProductoActivo(prod.id, true)
      } catch {
        // Si falla no bloqueamos la recepción; se corrige a mano.
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
        venta_por_peso: prod.venta_por_peso,
        dias_vencimiento_minimo: prod.dias_vencimiento_minimo,
      },
    ])
    guardarCarga(nuevoItem.id, {
      cantidad: String(cant),
      fecha_vencimiento: venc,
    })
    setActivoId(nuevoItem.id)
    toast.success(`${prod.nombre} agregado al pedido`)
  }

  // ── Confirmación ──────────────────────────────────────────────────────
  function confirmarDesdeRevision() {
    if (!usuario || !pedido?.proveedor) return
    if (advertencias.some((a) => a.bloqueante)) return
    setRevisionAbierta(false)
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
   * "No vinieron": los faltantes se confirman como no venidos (0 recibido → el
   * renglón se elimina de la orden; incompleto → la pedida baja a lo recibido)
   * y la orden se recibe completa, todo en la misma transacción.
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
    // Las facturas vacías se descartan solas; dentro de cada una los renglones
    // van en el orden del papel (`orden`). El `orden` del payload corre entre
    // facturas: es lo que después ordena la carga de precios en administración.
    const conCarga = facturas.filter((f) => unidadesDeCargas(f.cargas) > 0)
    let orden = 0
    const items = conCarga.flatMap((f, idx) =>
      f.orden
        .filter((id) => cantidadDe(f, id) > 0)
        .flatMap((id) => {
          const it = porId.get(id)
          if (!it) return []
          return [
            {
              item_id: id,
              producto_id: it.producto_id,
              cantidad_recibida: cantidadDe(f, id),
              precio_costo: it.precio_costo,
              fecha_vencimiento: f.cargas[id]?.fecha_vencimiento || null,
              factura_ref: `f${idx + 1}`,
              numero_factura: f.numero.trim() || null,
              orden: ++orden,
            },
          ]
        })
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
        onSuccess: () => {
          // El orden importa: primero se da de baja el borrador y recién
          // después se navega, para que el flush del cleanup no lo reescriba.
          borrador.limpiar()
          router.push('/movil/recepcion')
        },
      }
    )
  }

  const condicionDias = parsearDiasCondicionPago(
    pedido?.proveedor_completo?.condicion_pago
  )
  const fechaVencimientoCuenta = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + condicionDias)
    return d.toISOString().slice(0, 10)
  }, [condicionDias])

  /** Fecha del renglón anterior de esta factura, para "Igual que el anterior". */
  const fechaAnterior = useMemo(() => {
    if (editandoId == null || !activa) return null
    const i = activa.orden.indexOf(editandoId)
    for (let j = i - 1; j >= 0; j--) {
      const f = activa.cargas[activa.orden[j]]?.fecha_vencimiento
      if (f) return f
    }
    return null
  }, [editandoId, activa])

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

  const enFactura = activa?.orden ?? []

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

      {restauracion && (
        <BannerBorrador
          renglones={restauracion.renglones}
          facturas={restauracion.facturas}
          nombresDescartados={restauracion.nombresDescartados}
          recibidoCambio={restauracion.recibidoCambio}
          onDescartar={descartarBorrador}
        />
      )}

      {/* Progreso: con la política de "completa o nada", llegar al total es
          exactamente la condición para poder confirmar. */}
      <div className="mb-3 rounded-xl border border-[#e4c9b0]/60 bg-white/70 px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-[#391511]">
            {controlados} de {itemsEstado.length} renglones controlados
          </span>
          <span className="text-xs tabular-nums text-[#6f3a2a]">
            {formatearNumero(Math.round(totalEntrega * 1000) / 1000)} u.
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#e4c9b0]/50">
          <div
            className="h-full rounded-full bg-[#f9b44c] transition-all"
            style={{
              width: `${itemsEstado.length ? (controlados / itemsEstado.length) * 100 : 0}%`,
            }}
          />
        </div>
      </div>

      {/* Se desmonta mientras se edita un código: ese modal usa la cámara y el
          teléfono no da dos streams a la vez. */}
      <div className="mb-4">
        {productoCodigo ? (
          <div className="rounded-2xl border border-dashed border-[#e4c9b0] bg-white/60 p-4 text-center text-xs text-[#6f3a2a]">
            Cámara en uso por el código de barras…
          </div>
        ) : (
          <EscanerCamara
            compacto
            pausado={editandoId != null || modalAgregarAbierto || revisionAbierta}
            onDetectado={alEscanear}
            ayuda="Escaneá un producto y cargá cuántos llegaron"
          />
        )}
      </div>

      <div className="mb-4">
        <PestanasFactura
          facturas={facturas}
          activaIdx={activaIdx}
          deshabilitado={procesando}
          onCambiar={(i) => {
            setActivaIdx(i)
            setActivoId(null)
          }}
          onAgregar={agregarFactura}
          onCerrar={cerrarFactura}
          onNumero={(numero) => editarActiva((f) => ({ ...f, numero }))}
        />
        <p className="mt-1.5 text-[11px] leading-snug text-[#6f3a2a]">
          ¿Vinieron varias facturas? Tocá <strong>Otra</strong> para abrir otra
          pestaña. Nada se guarda hasta el <strong>Confirmar</strong> final.
        </p>
      </div>

      {excesoAutorizado && autorizadoPor && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-[#2f7d4f]/30 bg-[#2f7d4f]/10 px-3 py-2 text-xs text-[#2f7d4f]">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          Exceso autorizado por{' '}
          <span className="font-semibold">{autorizadoPor}</span>.
        </div>
      )}

      {/* ── En la factura ─────────────────────────────────────────────── */}
      <section className="mb-4">
        <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#6f3a2a]">
          En la factura ({enFactura.length})
        </h2>
        {enFactura.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[#e4c9b0] bg-white/50 px-3 py-4 text-center text-xs text-[#6f3a2a]">
            Escaneá el primer producto de la factura. Van a ir apareciendo acá,
            numerados en el orden del papel.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {enFactura.map((id, i) => {
              const item = porId.get(id)
              if (!item) return null
              return (
                <FilaFactura
                  key={id}
                  item={item}
                  carga={activa.cargas[id]}
                  renglon={ordenBase + i + 1}
                  yaTotal={item.ya_recibido + (recibidoOtras.get(id) ?? 0)}
                  activo={id === activoId}
                  primero={i === 0}
                  ultimo={i === enFactura.length - 1}
                  onEditar={() => {
                    setActivoId(id)
                    setEditandoId(id)
                  }}
                  onMover={(d) => moverEnFactura(id, d)}
                />
              )
            })}
          </ul>
        )}
      </section>

      {/* ── Falta controlar ───────────────────────────────────────────── */}
      <section>
        <button
          type="button"
          onClick={() => setVerPendientes((v) => !v)}
          className="mb-1.5 flex w-full items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wider text-[#6f3a2a]"
        >
          <span>Falta controlar ({pendientes.length})</span>
          <ChevronDown
            className={cn(
              'h-4 w-4 transition-transform',
              verPendientes && 'rotate-180'
            )}
          />
        </button>

        {verPendientes && (
          <>
            {itemsEstado.length > 8 && (
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#c8a58a]" />
                <Input
                  value={busquedaPendientes}
                  onChange={(e) => setBusquedaPendientes(e.target.value)}
                  placeholder="Buscar en el pedido…"
                  className="h-10 border-[#e4c9b0] bg-white pl-9 text-sm focus-visible:ring-[#f9b44c]"
                />
              </div>
            )}
            {pendientes.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[#e4c9b0] bg-white/50 px-3 py-3 text-center text-xs text-[#6f3a2a]">
                {busquedaPendientes
                  ? 'Nada coincide con la búsqueda.'
                  : 'Ya controlaste todo el pedido.'}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {pendientes.map((it) => (
                  <FilaPendiente
                    key={it.item_id}
                    item={it}
                    yaTotal={it.ya_recibido + (recibidoOtras.get(it.item_id) ?? 0)}
                    puedeEditarCodigo={puedeEditarCodigo}
                    onCargar={() => abrirCarga(it.item_id)}
                    onEditarCodigo={() =>
                      setProductoCodigo({
                        id: it.producto_id,
                        nombre: it.nombre,
                        codigo_barras: it.codigo_barras,
                      })
                    }
                  />
                ))}
              </ul>
            )}
          </>
        )}

        <button
          type="button"
          onClick={() => {
            setCodigoNoEncontrado('')
            setModalAgregarAbierto(true)
          }}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#e4c9b0] bg-white/60 px-3 py-3 text-sm font-semibold text-[#9e6b15] transition active:scale-[0.99]"
        >
          <Plus className="h-4 w-4" />
          Buscar o agregar un producto
        </button>
      </section>

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

      {/* Barra de acción fija */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[#e4c9b0]/60 bg-[#fdfaf6]/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a]">
              {facturas.length > 1 ? 'Toda la entrega' : 'A recibir'}
            </div>
            <div className="text-xl font-extrabold tabular-nums text-[#391511]">
              {formatearNumero(Math.round(totalEntrega * 1000) / 1000)} u.
            </div>
          </div>
          <Button
            type="button"
            onClick={() => setRevisionAbierta(true)}
            disabled={confirmarDeshabilitado}
            className="h-12 flex-1 bg-[#f9b44c] px-4 text-base font-semibold text-[#391511] hover:bg-[#e4a42a]"
          >
            {procesando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Grabando…
              </>
            ) : (
              'Revisar y confirmar'
            )}
          </Button>
        </div>
      </div>

      <HojaCargaRenglon
        item={editandoId != null ? (porId.get(editandoId) ?? null) : null}
        carga={
          (editandoId != null ? activa?.cargas[editandoId] : undefined) ??
          cargaVacia()
        }
        renglon={ordenBase + (editandoId != null ? enFactura.indexOf(editandoId) : 0) + 1}
        yaTotal={
          editandoId != null
            ? (porId.get(editandoId)?.ya_recibido ?? 0) +
              (recibidoOtras.get(editandoId) ?? 0)
            : 0
        }
        fechaAnterior={fechaAnterior}
        puedeEditarCodigo={puedeEditarCodigo}
        onCambio={(c) => {
          if (editandoId != null) guardarCarga(editandoId, c)
        }}
        onCerrar={cerrarCarga}
        onQuitar={() => {
          if (editandoId != null) quitarDeFactura(editandoId)
        }}
        onEditarCodigo={() => {
          const it = editandoId != null ? porId.get(editandoId) : null
          if (!it) return
          setEditandoId(null)
          setProductoCodigo({
            id: it.producto_id,
            nombre: it.nombre,
            codigo_barras: it.codigo_barras,
          })
        }}
      />

      <HojaRevision
        abierto={revisionAbierta}
        facturas={facturas}
        porId={porId}
        advertencias={advertencias}
        controlado={controlado}
        procesando={procesando}
        onControlado={setControlado}
        onIrAFactura={(i) => setActivaIdx(i)}
        onCerrar={() => {
          setRevisionAbierta(false)
          setControlado(false)
        }}
        onConfirmar={confirmarDesdeRevision}
      />

      <ModalAgregarProducto
        abierto={modalAgregarAbierto}
        codigoInicial={codigoNoEncontrado}
        onCerrar={() => setModalAgregarAbierto(false)}
        onAgregar={agregarProductoALista}
      />

      {/* No se invalida el pedido al guardar: un refetch borraría lo tipeado. */}
      <ModalCodigoBarras
        abierto={productoCodigo != null}
        onCambioAbierto={(v) => {
          if (!v) setProductoCodigo(null)
        }}
        producto={productoCodigo}
        onGuardado={(productoId, codigo) =>
          setItemsEstado((prev) =>
            prev.map((it) =>
              it.producto_id === productoId ? { ...it, codigo_barras: codigo } : it
            )
          )
        }
      />

      <ModalClaveSupervisor
        abierto={modalSupervisorAbierto}
        onCambioAbierto={setModalSupervisorAbierto}
        motivo={`Se está recibiendo más cantidad de la pedida en ${itemsConExceso.length} producto(s). Un encargado debe autorizarlo.`}
        detalle={itemsConExceso.map((it) => {
          // Sin importes: el móvil lo usa el mostrador, que no ve costos.
          return `${it.nombre}: pedido ${formatearCantidad(it.cantidad_pedida, it.venta_por_peso)} → recibiendo ${formatearCantidad(totalDe(it.item_id), it.venta_por_peso)}`
        })}
        onAutorizado={(nombre) => {
          setExcesoAutorizado(true)
          setAutorizadoPor(nombre)
          ejecutarRecepcion(noVinoPendiente)
        }}
      />

      {/* La orden se recibe completa: lo que no vino se descuenta acá mismo. */}
      <Dialog open={dialogFaltanteAbierto} onOpenChange={setDialogFaltanteAbierto}>
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
              de lo pedido. Si el proveedor no las trajo, se descuentan de la orden
              y se recibe completa:
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
                  <span className="min-w-0 truncate font-medium">{it.nombre}</span>
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

      <Dialog
        open={dialogCerrarFactura != null}
        onOpenChange={(v) => {
          if (!v) setDialogCerrarFactura(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#391511]">
              <AlertTriangle className="h-5 w-5 text-[#c43e2c]" />
              Cerrar la factura {(dialogCerrarFactura ?? 0) + 1}
            </DialogTitle>
            <DialogDescription className="text-[#6f3a2a]">
              Se pierden los{' '}
              {dialogCerrarFactura != null
                ? facturas[dialogCerrarFactura]?.orden.length
                : 0}{' '}
              renglones cargados en esta factura. Los otros no se tocan.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogCerrarFactura(null)}
              className="h-11 flex-1 border-[#e4c9b0] text-[#6f3a2a]"
            >
              Volver
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (dialogCerrarFactura != null) eliminarFactura(dialogCerrarFactura)
              }}
              className="h-11 flex-1 bg-[#c43e2c] font-semibold text-white hover:bg-[#9e2f25]"
            >
              Cerrarla
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
