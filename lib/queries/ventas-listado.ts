import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
import type {
  ItemVentaRow,
  MedioPago,
  PagoVentaRow,
  VentaRow,
} from '@/types/database'

/** Quién se llevó la venta: cliente del CRM o empleado con fiado. */
export type TipoCliente = 'cliente' | 'empleado'

export interface VentaListadoRow extends VentaRow {
  cajero_nombre: string | null
  cantidad_items: number
  /** Nombre del cliente/deudor. null = venta al mostrador. */
  cliente_nombre: string | null
  cliente_tipo: TipoCliente | null
}

/** Nombre visible de un empleado, mismo criterio que `fn_buscar_deudores`. */
function nombreEmpleado(e: { nombre: string | null; apellido: string | null }) {
  return `${e.nombre ?? ''} ${e.apellido ?? ''}`.trim()
}

/**
 * Mapa venta_id → nombre del empleado, para las ventas fiadas a un empleado.
 *
 * Hace falta porque en ese caso `ventas.cliente_id` queda NULL (la FK apunta a
 * `clientes`): el único vínculo es `cuenta_corriente_empleado.venta_id`. Se
 * acota por el mismo rango de fechas del listado. Si la consulta falla o la
 * RLS la recorta, se devuelve vacío: la venta se muestra sin nombre, no rompe.
 */
async function mapaFiadosEmpleado(
  filtros: FiltrosVentas
): Promise<Map<number, string>> {
  const mapa = new Map<number, string>()
  try {
    const supabase = createClient()
    type Fila = {
      venta_id: number | null
      empleados: { nombre: string | null; apellido: string | null } | null
    }
    const filas = await traerTodo<Fila>(() => {
      let q = supabase
        .from('cuenta_corriente_empleado')
        .select('venta_id, empleados(nombre, apellido)')
        .eq('tipo', 'consumo')
        .not('venta_id', 'is', null)
      // `fecha` es date: se compara contra el día del ISO del período.
      if (filtros.desde) q = q.gte('fecha', filtros.desde.slice(0, 10))
      if (filtros.hasta) q = q.lte('fecha', filtros.hasta.slice(0, 10))
      return q
    })
    for (const f of filas) {
      if (f.venta_id == null || !f.empleados) continue
      const nombre = nombreEmpleado(f.empleados)
      if (nombre) mapa.set(f.venta_id, nombre)
    }
  } catch {
    // Sin permiso o sin red: el listado sale igual, sin el nombre.
  }
  return mapa
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
    clientes: { nombre: string } | null
    items_venta: Array<{ cantidad: number }>
  }

  // El embed de clientes cubre el CRM y el fiado a cliente (el RPC asocia el
  // cliente_id solo); los fiados a EMPLEADO se resuelven aparte.
  const [data, fiadosEmpleado] = await Promise.all([
    traerTodo<FilaCruda>(() => {
      let q = supabase
        .from('ventas')
        .select('*, usuarios(nombre), clientes(nombre), items_venta(cantidad)')
        .order('fecha', { ascending: false })

      if (filtros.desde) q = q.gte('fecha', filtros.desde)
      if (filtros.hasta) q = q.lte('fecha', filtros.hasta)
      if (filtros.medio_pago) q = q.eq('medio_pago', filtros.medio_pago)
      if (filtros.turno_id) q = q.eq('turno_id', filtros.turno_id)
      if (filtros.estado) q = q.eq('estado', filtros.estado)
      return q
    }),
    mapaFiadosEmpleado(filtros),
  ])

  return data.map(({ usuarios, clientes, items_venta, ...resto }) => {
    const empleado = fiadosEmpleado.get(resto.id) ?? null
    return {
      ...resto,
      cajero_nombre: usuarios?.nombre ?? null,
      // El cliente del CRM manda: si la venta lo tiene, es el titular.
      cliente_nombre: clientes?.nombre ?? empleado,
      cliente_tipo: clientes?.nombre
        ? ('cliente' as const)
        : empleado
          ? ('empleado' as const)
          : null,
      cantidad_items: (items_venta ?? []).reduce(
        (acc, i) => acc + (i.cantidad ?? 0),
        0
      ),
    }
  })
}

export interface VentaDetalleCompleta {
  venta: VentaRow
  cajero_nombre: string | null
  /** Nombre del cliente/deudor. null = venta al mostrador. */
  cliente_nombre: string | null
  cliente_tipo: TipoCliente | null
  /** true si la venta se fió (tiene un pago de cuenta corriente). */
  fiada: boolean
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

  const [resVenta, resItems, resPagos, resFiadoEmpleado] = await Promise.all([
    supabase
      .from('ventas')
      .select('*, usuarios(nombre), clientes(nombre)')
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
    // Fiado a empleado: no hay FK desde ventas, se resuelve por acá.
    // `limit(1)` y no `maybeSingle()`: si alguna vez hubiera dos movimientos
    // sobre la misma venta, single tiraría error y voltearía todo el detalle.
    supabase
      .from('cuenta_corriente_empleado')
      .select('empleados(nombre, apellido)')
      .eq('venta_id', id)
      .eq('tipo', 'consumo')
      .limit(1),
  ])

  if (resVenta.error) throw resVenta.error
  if (resItems.error) throw resItems.error
  if (resPagos.error) throw resPagos.error
  if (!resVenta.data) return null

  type VentaCruda = VentaRow & {
    usuarios: { nombre: string } | null
    clientes: { nombre: string } | null
  }
  type ItemCrudo = ItemVentaRow & {
    productos: { nombre: string; codigo_barras: string | null } | null
  }

  const ventaData = resVenta.data as unknown as VentaCruda
  const itemsData = (resItems.data ?? []) as unknown as ItemCrudo[]
  const pagosData = (resPagos.data ?? []) as PagoVentaRow[]

  // El error de la consulta de empleados se ignora a propósito (RLS/red): sin
  // ese dato el detalle se muestra igual, solo que sin nombre.
  const empleadoCrudo = ((resFiadoEmpleado.data ?? [])[0] ??
    null) as unknown as {
    empleados: { nombre: string | null; apellido: string | null } | null
  } | null
  const empleadoNombre = empleadoCrudo?.empleados
    ? nombreEmpleado(empleadoCrudo.empleados) || null
    : null
  const clienteNombre = ventaData.clientes?.nombre ?? null

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
    cliente_nombre: clienteNombre ?? empleadoNombre,
    cliente_tipo: clienteNombre
      ? ('cliente' as const)
      : empleadoNombre
        ? ('empleado' as const)
        : null,
    fiada: pagosData.some((p) => p.medio_pago === 'cuenta_corriente'),
    items: itemsData.map(({ productos, ...resto }) => ({
      ...resto,
      producto_nombre: productos?.nombre ?? null,
      producto_codigo: productos?.codigo_barras ?? null,
    })),
    pagos: pagosData,
  }
}
