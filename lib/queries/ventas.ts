import { createClient } from '@/lib/supabase/client'
import { encolarVenta, nuevoUuid } from '@/lib/offline/cola'
import { esErrorDeRed } from '@/lib/offline/sync'
import type { Json, ListaPrecio, MedioPago, VentaRow } from '@/types/database'

export interface ItemVentaPayload {
  producto_id: number
  /** Unidades, o kilos con hasta 3 decimales si `venta_por_peso`. */
  cantidad: number
  /** Precio por unidad, o por kilo si `venta_por_peso`. */
  precio_unitario: number
  stock_actual: number
  nombre: string
  /** true = se vendió por peso: el ticket imprime kg y el precio por kilo. */
  venta_por_peso: boolean
  /**
   * Lista aplicada al ítem (mig 153). Opcional por las ventas encoladas en
   * IndexedDB con el payload viejo: sin la clave, el RPC asume minorista.
   */
  lista_precio?: ListaPrecio
}

export interface PagoPayload {
  medio_pago: MedioPago
  monto: number
  /** Solo para medio_pago === 'nota_credito': código del vale a consumir. */
  nc_codigo?: string | null
  /**
   * Comisión REAL en pesos (cobro con terminal MP). Si viene, la venta la
   * usa en vez de calcularla con el % de la tabla de medios de pago.
   */
  comision_monto?: number | null
  /** Retención de IIBB REAL en pesos (cobro con terminal MP). Override de la tabla. */
  iibb_monto?: number | null
  /** Solo para medio_pago === 'cuenta_corriente': a quién se le fía. */
  deudor_tipo?: 'cliente' | 'empleado' | null
  deudor_id?: number | null
  /**
   * Nombre y saldo del deudor al momento de fiar. Son SOLO para el ticket
   * (constancia de quién se llevó la mercadería y cuánto queda debiendo): no
   * viajan al RPC, que resuelve el deudor por `deudor_id`.
   */
  deudor_nombre?: string | null
  deudor_saldo?: number | null
}

export interface CrearVentaPayload {
  turno_id: number
  usuario_id: string
  /** Lista de pagos (split payment). Para pago único, array con una sola entrada. */
  pagos: PagoPayload[]
  items: ItemVentaPayload[]
  /** Cliente del CRM (FASE 3). Opcional — null = venta al mostrador. */
  cliente_id?: number | null
  /**
   * Nombre del cliente elegido, solo para imprimirlo en el ticket. No viaja al
   * RPC (que ya tiene el `cliente_id`); evita una consulta extra justo cuando
   * el POS necesita mostrar el comprobante.
   */
  cliente_nombre?: string | null
  /**
   * UUID de idempotencia de la venta. Si viene, se usa como `cliente_uuid` en
   * `fn_crear_venta` (que ya deduplica por ese campo). Lo aprovecha el cobro con
   * terminal: el POS y el webhook usan el MISMO uuid (el id del intento de
   * cobro) para que, gane quien gane, la venta se registre una sola vez. Si no
   * viene, se genera uno como siempre.
   */
  cliente_uuid?: string
}

/** Quién se llevó la mercadería, para el ticket. */
export interface ClienteVenta {
  nombre: string
  /** true = la venta se fió: el ticket es la constancia de la deuda. */
  fiado: boolean
  /** Deuda TOTAL que queda tras esta venta (solo en fiado). */
  deudaTotal: number | null
}

export interface VentaCompleta {
  venta: VentaRow
  items: Array<{
    producto_id: number
    nombre: string
    cantidad: number
    precio_unitario: number
    subtotal: number
    /** true = cantidad en kg y precio_unitario por kilo. */
    venta_por_peso: boolean
    lista_precio: ListaPrecio
  }>
  pagos: PagoPayload[]
  total: number
  /** 'mayorista' si algún ítem se cobró a precio mayorista (para el ticket). */
  listaPrecio: ListaPrecio
  /** true si la venta se cobró offline y quedó en cola para sincronizar. */
  pendiente?: boolean
  /** Cliente a imprimir. null = venta al mostrador (el ticket no lo menciona). */
  cliente?: ClienteVenta | null
}

/**
 * Resuelve el cliente que va al ticket a partir del payload.
 *
 * El fiado MANDA sobre el cliente del CRM: es quien queda debiendo, y el
 * ticket es su constancia. `deudor_saldo` es la deuda ANTES de esta venta
 * (saldo positivo = debe), así que la deuda final suma el monto fiado.
 */
function resolverClienteVenta(payload: CrearVentaPayload): ClienteVenta | null {
  const fiado = payload.pagos.find(
    (p) => p.medio_pago === 'cuenta_corriente' && p.deudor_nombre
  )
  if (fiado?.deudor_nombre) {
    return {
      nombre: fiado.deudor_nombre,
      fiado: true,
      deudaTotal:
        fiado.deudor_saldo != null
          ? Math.round((fiado.deudor_saldo + fiado.monto) * 100) / 100
          : null,
    }
  }
  const nombre = payload.cliente_nombre?.trim()
  if (nombre) return { nombre, fiado: false, deudaTotal: null }
  return null
}

function detalleItems(items: ItemVentaPayload[]) {
  return items.map((it) => ({
    producto_id: it.producto_id,
    nombre: it.nombre,
    cantidad: it.cantidad,
    precio_unitario: it.precio_unitario,
    subtotal: it.precio_unitario * it.cantidad,
    // `?? false` por las ventas que quedaron encoladas en IndexedDB con una
    // versión anterior del payload, que no traía el flag.
    venta_por_peso: it.venta_por_peso ?? false,
    lista_precio: it.lista_precio ?? ('minorista' as ListaPrecio),
  }))
}

/** Lista de la venta para el ticket: mayorista si algún ítem lo es. */
function listaDeVenta(items: ItemVentaPayload[]): ListaPrecio {
  return items.some((it) => it.lista_precio === 'mayorista')
    ? 'mayorista'
    : 'minorista'
}

/** Medio de pago con mayor monto (el "principal" de la venta). */
function medioPrincipal(pagos: PagoPayload[]): MedioPago {
  return [...pagos].sort((a, b) => b.monto - a.monto)[0]?.medio_pago ?? 'efectivo'
}

/** Arma una VentaCompleta sintética para una venta encolada offline. */
function ventaPendienteCompleta(
  payload: CrearVentaPayload,
  clienteUuid: string,
  total: number
): VentaCompleta {
  const ahora = new Date().toISOString()
  return {
    venta: {
      id: 0,
      turno_id: payload.turno_id,
      usuario_id: payload.usuario_id,
      fecha: ahora,
      total,
      medio_pago: medioPrincipal(payload.pagos),
      estado: 'completada',
      created_at: ahora,
      cliente_uuid: clienteUuid,
      cliente_id: payload.cliente_id ?? null,
      lista_precio: listaDeVenta(payload.items),
      // La venta encolada todavía no pasó por fn_crear_venta: la base gravada
      // y el IVA débito se calculan al sincronizar. Acá solo alimenta el ticket.
      base_gravada: null,
      iva_debito: null,
    },
    items: detalleItems(payload.items),
    pagos: payload.pagos,
    total,
    listaPrecio: listaDeVenta(payload.items),
    pendiente: true,
    cliente: resolverClienteVenta(payload),
  }
}

/**
 * Registra una venta completa.
 *
 * FASE 0 — atomicidad: toda la cascada (cabecera, pagos, movimientos de
 * cuenta con comisiones, items, descuento de stock, movimientos de stock y
 * descuento FIFO de lotes) ocurre dentro de la función Postgres
 * `fn_crear_venta`, en una única transacción.
 *
 * FASE 2 — offline: si no hay conexión, la venta se encola en IndexedDB con
 * un `cliente_uuid` único y se devuelve una venta "pendiente" para que el
 * cajero igual pueda imprimir el ticket. El motor de sincronización la
 * reenvía al volver internet; ese uuid evita duplicados.
 */
export async function crearVenta(
  payload: CrearVentaPayload
): Promise<VentaCompleta> {
  const total = payload.items.reduce(
    (acc, it) => acc + it.precio_unitario * it.cantidad,
    0
  )

  if (payload.pagos.length === 0) {
    throw new Error('La venta debe tener al menos un pago.')
  }

  const clienteUuid = payload.cliente_uuid ?? nuevoUuid()

  // Una venta FIADA nunca se encola: el tope se valida en el server y sin
  // conexión la deuda no existiría hasta sincronizar — si para entonces el
  // cupo está lleno, la venta rebota con la mercadería ya entregada.
  const tieneFiado = payload.pagos.some(
    (p) => p.medio_pago === 'cuenta_corriente'
  )

  // Sin conexión: encolar directamente, sin intentar la red.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (tieneFiado) {
      throw new Error(
        'Sin conexión no se puede fiar (no podemos verificar el cupo). Cobrá de otra forma.'
      )
    }
    await encolarVenta(
      {
        turno_id: payload.turno_id,
        usuario_id: payload.usuario_id,
        cliente_id: payload.cliente_id ?? null,
        pagos: payload.pagos,
        items: payload.items,
        total,
      },
      clienteUuid
    )
    return ventaPendienteCompleta(payload, clienteUuid, total)
  }

  const supabase = createClient()

  try {
    const { data, error } = await supabase.rpc('fn_crear_venta', {
      p_turno_id: payload.turno_id,
      p_usuario_id: payload.usuario_id,
      p_pagos: payload.pagos.map((p) => ({
        medio_pago: p.medio_pago,
        monto: p.monto,
        nc_codigo: p.nc_codigo ?? null,
        comision_monto: p.comision_monto ?? null,
        iibb_monto: p.iibb_monto ?? null,
        deudor_tipo: p.deudor_tipo ?? null,
        deudor_id: p.deudor_id ?? null,
      })) as unknown as Json,
      p_items: payload.items.map((it) => ({
        producto_id: it.producto_id,
        cantidad: it.cantidad,
        precio_unitario: it.precio_unitario,
        lista_precio: it.lista_precio ?? null,
      })) as unknown as Json,
      p_cliente_uuid: clienteUuid,
      p_cliente_id: payload.cliente_id ?? null,
    })

    if (error) throw error
    if (!data) throw new Error('No se pudo registrar la venta.')

    return {
      venta: data as VentaRow,
      items: detalleItems(payload.items),
      pagos: payload.pagos,
      total,
      listaPrecio: listaDeVenta(payload.items),
      cliente: resolverClienteVenta(payload),
    }
  } catch (error) {
    // Se cayó la red a mitad de la operación: encolar para sincronizar luego.
    // Nunca con fiado (mismo motivo que arriba: el tope se valida online).
    if (esErrorDeRed(error)) {
      if (tieneFiado) {
        throw new Error(
          'Se cortó la conexión y la venta fiada no se registró. Cobrá de otra forma o reintentá.'
        )
      }
      await encolarVenta(
        {
          turno_id: payload.turno_id,
          usuario_id: payload.usuario_id,
          cliente_id: payload.cliente_id ?? null,
          pagos: payload.pagos,
          items: payload.items,
          total,
        },
        clienteUuid
      )
      return ventaPendienteCompleta(payload, clienteUuid, total)
    }
    throw error
  }
}

/**
 * Anula una venta completa, de forma atómica (función `fn_anular_venta`):
 *  1. Devuelve TODO el stock vendido (productos + movimientos_stock).
 *  2. Revierte los movimientos de cuenta de la venta (ingresos y comisiones).
 *  3. Marca la venta como `anulada`.
 *
 * Todo ocurre en una única transacción Postgres: o se revierte todo, o nada.
 *
 * Nota: el stock se devuelve sobre `productos.stock_actual`. Los lotes no se
 * re-incrementan; el descuento FIFO tolera esa diferencia.
 */
export async function anularVenta(
  ventaId: number,
  usuarioId: string
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_anular_venta', {
    p_venta_id: ventaId,
    p_usuario_id: usuarioId,
  })
  if (error) throw error
}

export interface ProductoFrecuente {
  producto_id: number
  nombre: string
  codigo_barras: string | null
  precio_venta: number
  precio_mayorista: number | null
  stock_actual: number
  cantidad_vendida: number
  venta_por_peso: boolean
  imagen_url: string | null
}

/**
 * Devuelve los productos más vendidos del turno (hasta `limite`).
 *
 * Como supabase-js no soporta GROUP BY desde el cliente, traemos los items
 * con join a productos y agrupamos en memoria. Para un turno típico (< 500 items)
 * esto es trivial.
 */
export async function getProductosFrecuentesTurno(
  turnoId: number,
  limite = 12
): Promise<ProductoFrecuente[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('items_venta')
    .select(
      `cantidad,
       ventas!inner(turno_id, estado),
       productos!inner(id, nombre, codigo_barras, precio_venta, precio_mayorista, stock_actual, activo, venta_por_peso, imagen_url)`
    )
    .eq('ventas.turno_id', turnoId)
    .eq('ventas.estado', 'completada')
    .eq('productos.activo', true)
    .eq('productos.no_ofrecer_ventas', false)

  // Offline: los frecuentes son un "nice to have"; sin red devolvemos vacío.
  if (error) {
    if (esErrorDeRed(error)) return []
    throw error
  }

  type FilaCruda = {
    cantidad: number
    productos: {
      id: number
      nombre: string
      codigo_barras: string | null
      precio_venta: number
      precio_mayorista: number | null
      stock_actual: number
      venta_por_peso: boolean
      imagen_url: string | null
    }
  }

  const acumulado = new Map<number, ProductoFrecuente>()

  for (const fila of (data ?? []) as unknown as FilaCruda[]) {
    const p = fila.productos
    if (!p) continue
    const previo = acumulado.get(p.id)
    if (previo) {
      previo.cantidad_vendida += fila.cantidad
    } else {
      acumulado.set(p.id, {
        producto_id: p.id,
        nombre: p.nombre,
        codigo_barras: p.codigo_barras,
        precio_venta: p.precio_venta,
        precio_mayorista: p.precio_mayorista,
        stock_actual: p.stock_actual,
        venta_por_peso: p.venta_por_peso,
        imagen_url: p.imagen_url,
        cantidad_vendida: fila.cantidad,
      })
    }
  }

  return [...acumulado.values()]
    .sort((a, b) => b.cantidad_vendida - a.cantidad_vendida)
    .slice(0, limite)
}
