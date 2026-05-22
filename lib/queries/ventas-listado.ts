import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
import type {
  ItemVentaRow,
  MedioPago,
  PagoVentaRow,
  VentaRow,
} from '@/types/database'

export interface VentaListadoRow extends VentaRow {
  cajero_nombre: string | null
  cantidad_items: number
}

export interface FiltrosVentas {
  desde?: string // ISO
  hasta?: string // ISO
  medio_pago?: MedioPago | null
  turno_id?: number | null
  estado?: 'completada' | 'anulada' | null
}

export async function getVentas(
  filtros: FiltrosVentas = {}
): Promise<VentaListadoRow[]> {
  const supabase = createClient()

  type FilaCruda = VentaRow & {
    usuarios: { nombre: string } | null
    items_venta: Array<{ cantidad: number }>
  }

  const data = await traerTodo<FilaCruda>(() => {
    let q = supabase
      .from('ventas')
      .select('*, usuarios(nombre), items_venta(cantidad)')
      .order('fecha', { ascending: false })

    if (filtros.desde) q = q.gte('fecha', filtros.desde)
    if (filtros.hasta) q = q.lte('fecha', filtros.hasta)
    if (filtros.medio_pago) q = q.eq('medio_pago', filtros.medio_pago)
    if (filtros.turno_id) q = q.eq('turno_id', filtros.turno_id)
    if (filtros.estado) q = q.eq('estado', filtros.estado)
    return q
  })

  return data.map(({ usuarios, items_venta, ...resto }) => ({
    ...resto,
    cajero_nombre: usuarios?.nombre ?? null,
    cantidad_items: (items_venta ?? []).reduce(
      (acc, i) => acc + (i.cantidad ?? 0),
      0
    ),
  }))
}

export interface VentaDetalleCompleta {
  venta: VentaRow
  cajero_nombre: string | null
  items: Array<
    ItemVentaRow & {
      producto_nombre: string | null
      producto_codigo: string | null
    }
  >
  pagos: PagoVentaRow[]
}

export async function getVentaDetalle(
  id: number
): Promise<VentaDetalleCompleta | null> {
  const supabase = createClient()

  const [resVenta, resItems, resPagos] = await Promise.all([
    supabase
      .from('ventas')
      .select('*, usuarios(nombre)')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('items_venta')
      .select('*, productos(nombre, codigo_barras)')
      .eq('venta_id', id),
    supabase
      .from('pagos_venta')
      .select('*')
      .eq('venta_id', id)
      .order('id', { ascending: true }),
  ])

  if (resVenta.error) throw resVenta.error
  if (resItems.error) throw resItems.error
  if (resPagos.error) throw resPagos.error
  if (!resVenta.data) return null

  type VentaCruda = VentaRow & { usuarios: { nombre: string } | null }
  type ItemCrudo = ItemVentaRow & {
    productos: { nombre: string; codigo_barras: string | null } | null
  }

  const ventaData = resVenta.data as unknown as VentaCruda
  const itemsData = (resItems.data ?? []) as unknown as ItemCrudo[]

  return {
    venta: {
      id: ventaData.id,
      turno_id: ventaData.turno_id,
      usuario_id: ventaData.usuario_id,
      fecha: ventaData.fecha,
      total: ventaData.total,
      medio_pago: ventaData.medio_pago,
      estado: ventaData.estado,
      created_at: ventaData.created_at,
      cliente_uuid: ventaData.cliente_uuid ?? null,
      cliente_id: ventaData.cliente_id ?? null,
    },
    cajero_nombre: ventaData.usuarios?.nombre ?? null,
    items: itemsData.map(({ productos, ...resto }) => ({
      ...resto,
      producto_nombre: productos?.nombre ?? null,
      producto_codigo: productos?.codigo_barras ?? null,
    })),
    pagos: (resPagos.data ?? []) as PagoVentaRow[],
  }
}
