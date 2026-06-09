import { createClient } from '@/lib/supabase/client'
import { encolarVenta, nuevoUuid } from '@/lib/offline/cola'
import { esErrorDeRed } from '@/lib/offline/sync'
import type { Json, MedioPago, VentaRow } from '@/types/database'

export interface ItemVentaPayload {
  producto_id: number
  cantidad: number
  precio_unitario: number
  stock_actual: number
  nombre: string
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
}

export interface CrearVentaPayload {
  turno_id: number
  usuario_id: string
  /** Lista de pagos (split payment). Para pago único, array con una sola entrada. */
  pagos: PagoPayload[]
  items: ItemVentaPayload[]
  /** Cliente del CRM (FASE 3). Opcional — null = venta al mostrador. */
  cliente_id?: number | null
}

export interface VentaCompleta {
  venta: VentaRow
  items: Array<{
    producto_id: number
    nombre: string
    cantidad: number
    precio_unitario: number
    subtotal: number
  }>
  pagos: PagoPayload[]
  total: number
  /** true si la venta se cobró offline y quedó en cola para sincronizar. */
  pendiente?: boolean
}

function detalleItems(items: ItemVentaPayload[]) {
  return items.map((it) => ({
    producto_id: it.producto_id,
    nombre: it.nombre,
    cantidad: it.cantidad,
    precio_unitario: it.precio_unitario,
    subtotal: it.precio_unitario * it.cantidad,
  }))
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
    },
    items: detalleItems(payload.items),
    pagos: payload.pagos,
    total,
    pendiente: true,
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

  const clienteUuid = nuevoUuid()

  // Sin conexión: encolar directamente, sin intentar la red.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
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
      })) as unknown as Json,
      p_items: payload.items.map((it) => ({
        producto_id: it.producto_id,
        cantidad: it.cantidad,
        precio_unitario: it.precio_unitario,
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
    }
  } catch (error) {
    // Se cayó la red a mitad de la operación: encolar para sincronizar luego.
    if (esErrorDeRed(error)) {
      await encolarVenta(
        {
          turno_id: payload.turno_id,
          usuario_id: payload.usuario_id,
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
  stock_actual: number
  cantidad_vendida: number
  venta_por_peso: boolean
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
       productos!inner(id, nombre, codigo_barras, precio_venta, stock_actual, activo, venta_por_peso)`
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
      stock_actual: number
      venta_por_peso: boolean
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
        stock_actual: p.stock_actual,
        venta_por_peso: p.venta_por_peso,
        cantidad_vendida: fila.cantidad,
      })
    }
  }

  return [...acumulado.values()]
    .sort((a, b) => b.cantidad_vendida - a.cantidad_vendida)
    .slice(0, limite)
}
