import { createClient } from '@/lib/supabase/client'
import { costoDesdeEmbed, type CostoEmbed } from '@/lib/queries/productos'
import { claveSemana, semanasEnRango } from '@/lib/utils/periodos'
import type { CuentaAPagarUpdate, EgresoRow } from '@/types/database'

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

  // 1. Ventas brutas + items con precio costo de producto (gateado por RLS)
  const { data: ventasData, error: errVentas } = await supabase
    .from('ventas')
    .select(
      `id, total, fecha, items_venta(cantidad, productos(costos_producto(precio_costo)))`
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
      productos: { costos_producto: CostoEmbed } | null
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
          s + it.cantidad * costoDesdeEmbed(it.productos?.costos_producto ?? null),
        0
      ),
    0
  )

  // 2. Mermas del período
  const { data: mermasData, error: errMermas } = await supabase
    .from('movimientos_stock')
    .select('cantidad, productos(costos_producto(precio_costo))')
    .eq('tipo', 'merma')
    .gte('created_at', desde)
    .lte('created_at', hasta)

  if (errMermas) throw errMermas

  type MermaCruda = {
    cantidad: number
    productos: { costos_producto: CostoEmbed } | null
  }

  const mermas = ((mermasData ?? []) as unknown as MermaCruda[]).reduce(
    (acc, m) => acc + m.cantidad * costoDesdeEmbed(m.productos?.costos_producto ?? null),
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
  monto_pagado: number
  /** Saldo que falta pagar = monto − monto_pagado. */
  saldo_pendiente: number
  fecha_vencimiento: string
  fecha_pago: string | null
  estado: EstadoCuentaDerivado
  /** true si hay pagos pero no cubre el total (parcial). */
  parcial: boolean
  tiene_factura: boolean
  provisoria: boolean
  numero_factura: string | null
  nota: string | null
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
      'id, pedido_id, proveedor_id, monto, monto_pagado, fecha_vencimiento, fecha_pago, estado, tiene_factura, provisoria, numero_factura, nota, proveedores(nombre)'
    )
    .order('fecha_vencimiento', { ascending: true })

  if (error) throw error

  type FilaCruda = {
    id: number
    pedido_id: number
    proveedor_id: number
    monto: number
    monto_pagado: number | null
    fecha_vencimiento: string
    fecha_pago: string | null
    estado: 'pendiente' | 'pagada' | 'vencida'
    tiene_factura: boolean
    provisoria: boolean
    numero_factura: string | null
    nota: string | null
    proveedores: { nombre: string } | null
  }

  const filas = ((data ?? []) as unknown as FilaCruda[]).map((f) => {
    const pagado = Number(f.monto_pagado ?? 0)
    const saldo = Number(f.monto) - pagado
    return {
      id: f.id,
      pedido_id: f.pedido_id,
      proveedor_id: f.proveedor_id,
      monto: Number(f.monto),
      monto_pagado: pagado,
      saldo_pendiente: saldo,
      fecha_vencimiento: f.fecha_vencimiento,
      fecha_pago: f.fecha_pago,
      estado: derivarEstado(f.estado, f.fecha_vencimiento),
      parcial: f.estado !== 'pagada' && pagado > 0.009,
      tiene_factura: f.tiene_factura,
      provisoria: f.provisoria,
      numero_factura: f.numero_factura,
      nota: f.nota,
      proveedor_nombre: f.proveedores?.nombre ?? null,
    }
  })

  if (estadoFiltro) {
    return filas.filter((f) => f.estado === estadoFiltro)
  }
  return filas
}

export interface PagarCuentaPayload {
  cuenta_id: number
  usuario_id: string
  cuenta_origen_id: number
  monto: number
  fecha: string
  nota?: string | null
}

/**
 * Registra un pago (total o parcial) de una cuenta a pagar, de forma atómica
 * (`fn_pagar_cuenta`): descuenta del saldo de la cuenta de tesorería de
 * origen, deja el pago en el historial, genera el egreso y su asiento
 * (Debe Proveedores / Haber según el tipo de cuenta de origen). La cuenta
 * pasa a 'pagada' recién cuando se cubre el total.
 */
export async function pagarCuenta(payload: PagarCuentaPayload): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_pagar_cuenta', {
    p_cuenta_id: payload.cuenta_id,
    p_usuario_id: payload.usuario_id,
    p_cuenta_origen_id: payload.cuenta_origen_id,
    p_monto: payload.monto,
    p_fecha: payload.fecha,
    p_nota: payload.nota ?? null,
  })
  if (error) throw error
}

export interface PagoConCuenta {
  id: number
  monto: number
  fecha: string
  nota: string | null
  cuenta_origen_id: number | null
  cuenta_origen_nombre: string | null
}

/** Historial de pagos de una cuenta a pagar, con el nombre de la cuenta origen. */
export async function getPagosCuenta(
  cuentaAPagarId: number
): Promise<PagoConCuenta[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('pagos_cuenta')
    .select('id, monto, fecha, nota, cuenta_origen_id, cuentas(nombre)')
    .eq('cuenta_a_pagar_id', cuentaAPagarId)
    .order('fecha', { ascending: false })
  if (error) throw error

  type FilaCruda = {
    id: number
    monto: number
    fecha: string
    nota: string | null
    cuenta_origen_id: number | null
    cuentas: { nombre: string } | null
  }

  return ((data ?? []) as unknown as FilaCruda[]).map((p) => ({
    id: p.id,
    monto: Number(p.monto),
    fecha: p.fecha,
    nota: p.nota,
    cuenta_origen_id: p.cuenta_origen_id,
    cuenta_origen_nombre: p.cuentas?.nombre ?? null,
  }))
}

export interface EditarCuentaPayload {
  cuenta_id: number
  fecha_vencimiento?: string
  monto?: number
  nota?: string | null
}

/**
 * Edita una cuenta a pagar: vencimiento, nota y/o monto. El monto solo se
 * permite cambiar si la cuenta NO tiene factura cargada (rompería el cruce
 * three-way) y nunca por debajo de lo ya pagado.
 */
export async function editarCuentaAPagar(
  payload: EditarCuentaPayload
): Promise<void> {
  const supabase = createClient()

  const patch: CuentaAPagarUpdate = {}
  if (payload.fecha_vencimiento !== undefined)
    patch.fecha_vencimiento = payload.fecha_vencimiento
  if (payload.nota !== undefined) patch.nota = payload.nota

  if (payload.monto !== undefined) {
    const { data: actual, error: errLeer } = await supabase
      .from('cuentas_a_pagar')
      .select('monto_pagado, tiene_factura')
      .eq('id', payload.cuenta_id)
      .single<{ monto_pagado: number | null; tiene_factura: boolean }>()
    if (errLeer) throw errLeer
    if (actual.tiene_factura) {
      throw new Error(
        'No se puede cambiar el monto: la cuenta ya tiene una factura cargada. Editá la factura en Comprobantes.'
      )
    }
    if (payload.monto < Number(actual.monto_pagado ?? 0)) {
      throw new Error('El monto no puede ser menor a lo ya pagado.')
    }
    patch.monto = payload.monto
  }

  if (Object.keys(patch).length === 0) return

  const { error } = await supabase
    .from('cuentas_a_pagar')
    .update(patch)
    .eq('id', payload.cuenta_id)
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
