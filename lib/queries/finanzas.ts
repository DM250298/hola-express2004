import { createClient } from '@/lib/supabase/client'
import { claveSemana, semanasEnRango } from '@/lib/utils/periodos'
import type { EgresoRow } from '@/types/database'

export interface PuntoSemana {
  semana: string // ISO yyyy-MM-dd (lunes)
  ventas: number
  egresos: number
}

export interface ResumenFinanciero {
  ventas_brutas: number
  cmv: number
  margen_bruto: number
  mermas: number
  egresos: number
  resultado_neto: number
  cantidad_ventas: number
  ticket_promedio: number
  series_semanales: PuntoSemana[]
}

/**
 * P&L del período. Nota técnica importante: el costo de mercadería vendida (CMV)
 * se calcula como `items_venta.cantidad × productos.precio_costo` con el precio
 * costo ACTUAL del producto. Si el costo cambió desde la venta, el cálculo es
 * aproximado. Para precisión histórica habría que agregar `costo_unitario` a
 * items_venta (cambio de schema fuera de este alcance).
 */
export async function getResumenFinanciero(
  desde: string,
  hasta: string
): Promise<ResumenFinanciero> {
  const supabase = createClient()

  // 1. Ventas brutas + items con precio costo de producto
  const { data: ventasData, error: errVentas } = await supabase
    .from('ventas')
    .select(
      `id, total, fecha, items_venta(cantidad, productos(precio_costo))`
    )
    .eq('estado', 'completada')
    .gte('fecha', desde)
    .lte('fecha', hasta)

  if (errVentas) throw errVentas

  type VentaCruda = {
    id: number
    total: number
    fecha: string
    items_venta: Array<{
      cantidad: number
      productos: { precio_costo: number } | null
    }>
  }

  const ventas = (ventasData ?? []) as unknown as VentaCruda[]
  const ventas_brutas = ventas.reduce((acc, v) => acc + Number(v.total), 0)
  const cantidad_ventas = ventas.length
  const cmv = ventas.reduce(
    (acc, v) =>
      acc +
      v.items_venta.reduce(
        (s, it) =>
          s + it.cantidad * (it.productos?.precio_costo ?? 0),
        0
      ),
    0
  )

  // 2. Mermas del período
  const { data: mermasData, error: errMermas } = await supabase
    .from('movimientos_stock')
    .select('cantidad, productos(precio_costo)')
    .eq('tipo', 'merma')
    .gte('created_at', desde)
    .lte('created_at', hasta)

  if (errMermas) throw errMermas

  type MermaCruda = {
    cantidad: number
    productos: { precio_costo: number } | null
  }

  const mermas = ((mermasData ?? []) as unknown as MermaCruda[]).reduce(
    (acc, m) => acc + m.cantidad * (m.productos?.precio_costo ?? 0),
    0
  )

  // 3. Egresos del período
  const { data: egresosData, error: errEgresos } = await supabase
    .from('egresos')
    .select('monto, fecha')
    .gte('fecha', desde)
    .lte('fecha', hasta)

  if (errEgresos) throw errEgresos

  const egresos = (egresosData ?? []).reduce(
    (acc, e) => acc + Number(e.monto),
    0
  )

  // 4. Series semanales: agregar ventas y egresos por semana
  const claves = semanasEnRango(desde, hasta)
  const serieMap = new Map<string, PuntoSemana>()
  for (const k of claves) {
    serieMap.set(k, { semana: k, ventas: 0, egresos: 0 })
  }

  for (const v of ventas) {
    const k = claveSemana(new Date(v.fecha))
    const punto = serieMap.get(k)
    if (punto) punto.ventas += Number(v.total)
  }
  for (const e of egresosData ?? []) {
    const k = claveSemana(new Date(e.fecha))
    const punto = serieMap.get(k)
    if (punto) punto.egresos += Number(e.monto)
  }

  const margen_bruto = ventas_brutas - cmv
  const resultado_neto = margen_bruto - mermas - egresos
  const ticket_promedio =
    cantidad_ventas > 0 ? ventas_brutas / cantidad_ventas : 0

  return {
    ventas_brutas,
    cmv,
    margen_bruto,
    mermas,
    egresos,
    resultado_neto,
    cantidad_ventas,
    ticket_promedio,
    series_semanales: [...serieMap.values()],
  }
}

export type EstadoCuentaDerivado = 'pendiente' | 'pagada' | 'vencida'

export interface CuentaAPagarConProveedor {
  id: number
  pedido_id: number
  proveedor_id: number
  monto: number
  fecha_vencimiento: string
  fecha_pago: string | null
  estado: EstadoCuentaDerivado
  proveedor_nombre: string | null
}

/**
 * El estado "vencida" se deriva en memoria: si `pendiente` y la fecha
 * de vencimiento ya pasó, mostrar como vencida sin tocar la BD.
 */
function derivarEstado(
  estado: 'pendiente' | 'pagada' | 'vencida',
  fechaVencimiento: string
): EstadoCuentaDerivado {
  if (estado === 'pagada') return 'pagada'
  const venc = new Date(fechaVencimiento)
  venc.setHours(23, 59, 59, 999)
  if (venc.getTime() < Date.now()) return 'vencida'
  return 'pendiente'
}

export async function getCuentasAPagar(
  estadoFiltro?: EstadoCuentaDerivado | null
): Promise<CuentaAPagarConProveedor[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('cuentas_a_pagar')
    .select(
      'id, pedido_id, proveedor_id, monto, fecha_vencimiento, fecha_pago, estado, proveedores(nombre)'
    )
    .order('fecha_vencimiento', { ascending: true })

  if (error) throw error

  type FilaCruda = {
    id: number
    pedido_id: number
    proveedor_id: number
    monto: number
    fecha_vencimiento: string
    fecha_pago: string | null
    estado: 'pendiente' | 'pagada' | 'vencida'
    proveedores: { nombre: string } | null
  }

  const filas = ((data ?? []) as unknown as FilaCruda[]).map((f) => ({
    id: f.id,
    pedido_id: f.pedido_id,
    proveedor_id: f.proveedor_id,
    monto: f.monto,
    fecha_vencimiento: f.fecha_vencimiento,
    fecha_pago: f.fecha_pago,
    estado: derivarEstado(f.estado, f.fecha_vencimiento),
    proveedor_nombre: f.proveedores?.nombre ?? null,
  }))

  if (estadoFiltro) {
    return filas.filter((f) => f.estado === estadoFiltro)
  }
  return filas
}

export interface PagarCuentaPayload {
  cuenta_id: number
  usuario_id: string
}

/**
 * Marca la cuenta como pagada y genera el egreso del pago, de forma atómica
 * (`fn_pagar_cuenta`). El egreso dispara su propio asiento contable
 * (Debe Proveedores / Haber Caja).
 */
export async function pagarCuenta(payload: PagarCuentaPayload): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_pagar_cuenta', {
    p_cuenta_id: payload.cuenta_id,
    p_usuario_id: payload.usuario_id,
  })
  if (error) throw error
}

export interface EgresoConUsuario extends EgresoRow {
  usuario_nombre: string | null
}

export async function getEgresos(
  desde: string,
  hasta: string,
  categoria?: string | null
): Promise<EgresoConUsuario[]> {
  const supabase = createClient()
  let query = supabase
    .from('egresos')
    .select('*, usuarios(nombre)')
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: false })

  if (categoria) {
    query = query.eq('categoria', categoria)
  }

  const { data, error } = await query
  if (error) throw error

  type FilaCruda = EgresoRow & { usuarios: { nombre: string } | null }

  return ((data ?? []) as unknown as FilaCruda[]).map(
    ({ usuarios, ...resto }) => ({
      ...resto,
      usuario_nombre: usuarios?.nombre ?? null,
    })
  )
}

export interface NuevoEgresoPayload {
  descripcion: string
  monto: number
  categoria: string
  fecha: string // ISO yyyy-MM-dd
  usuario_id: string
  /** Si el gasto sale de la caja de un turno, se vincula acá. */
  turno_id?: number | null
}

export async function crearEgreso(payload: NuevoEgresoPayload): Promise<EgresoRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_crear_egreso', {
    p_descripcion: payload.descripcion,
    p_monto: payload.monto,
    p_categoria: payload.categoria,
    p_fecha: payload.fecha,
    p_usuario_id: payload.usuario_id,
    p_turno_id: payload.turno_id ?? null,
  })
  if (error) throw error
  if (!data) throw new Error('No se pudo registrar el egreso.')
  return data as EgresoRow
}

export interface ActualizarEgresoPayload {
  descripcion: string
  monto: number
  categoria: string
  fecha: string
}

export async function actualizarEgreso(
  id: number,
  datos: ActualizarEgresoPayload
): Promise<EgresoRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('egresos')
    .update(datos)
    .eq('id', id)
    .select()
    .single<EgresoRow>()
  if (error) throw error
  return data
}

export async function eliminarEgreso(id: number): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('egresos').delete().eq('id', id)
  if (error) throw error
}

/** Suma de los gastos de caja registrados contra un turno. */
export async function getGastosTurno(turnoId: number): Promise<number> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('egresos')
    .select('monto')
    .eq('turno_id', turnoId)
  if (error) throw error
  return (data ?? []).reduce((acc, e) => acc + Number(e.monto), 0)
}

export const CATEGORIAS_EGRESO = [
  { valor: 'alquiler', etiqueta: 'Alquiler' },
  { valor: 'servicios', etiqueta: 'Servicios (luz/agua/gas)' },
  { valor: 'sueldos', etiqueta: 'Sueldos' },
  { valor: 'pago_proveedores', etiqueta: 'Pago a proveedores' },
  { valor: 'mantenimiento', etiqueta: 'Mantenimiento' },
  { valor: 'impuestos', etiqueta: 'Impuestos' },
  { valor: 'otros', etiqueta: 'Otros' },
] as const
