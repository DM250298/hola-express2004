import { createClient } from '@/lib/supabase/client'
import { costoDesdeEmbed, type CostoEmbed } from '@/lib/queries/productos'
import { traerTodo } from '@/lib/supabase/paginacion'
import { claveSemana, fechaLocal, semanasEnRango } from '@/lib/utils/periodos'
import type { CuentaAPagarUpdate, EgresoRow, Json } from '@/types/database'

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
  /** Comisiones de tarjeta/MP del período (movimientos_cuenta, categoría 'comisiones'). */
  comisiones: number
  /** Retención IIBB sufrida en el período (movimientos_cuenta, categoría 'iibb'). */
  iibb: number
  resultado_neto: number
  cantidad_ventas: number
  ticket_promedio: number
  series_semanales: PuntoSemana[]
}

/**
 * P&L del período. Notas técnicas:
 * - El CMV se calcula con el costo ACTUAL del producto (costos_producto). Si el
 *   costo cambió desde la venta, es aproximado; precisión histórica requeriría
 *   `costo_unitario` en items_venta (cambio de schema fuera de este alcance).
 * - Las comisiones de tarjeta/MP y la retención de IIBB NO están en la tabla
 *   `egresos`: se registran como movimientos_cuenta (categorías 'comisiones' e
 *   'iibb'). Se descuentan acá para que el resultado no quede sobreestimado.
 */
export async function getResumenFinanciero(
  desde: string,
  hasta: string
): Promise<ResumenFinanciero> {
  const supabase = createClient()

  type VentaCruda = {
    id: number
    total: number
    fecha: string
    items_venta: Array<{
      cantidad: number
      productos: { costos_producto: CostoEmbed } | null
    }>
  }

  // 1. Ventas brutas + items con precio costo de producto (gateado por RLS).
  // Paginado: >1000 ventas en el período truncarían el P&L en silencio.
  const ventas = await traerTodo<VentaCruda>(() =>
    supabase
      .from('ventas')
      .select(
        `id, total, fecha, items_venta(cantidad, productos(costos_producto(precio_costo)))`
      )
      .eq('estado', 'completada')
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('id')
  )
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

  // 2. Mermas del período (paginado)
  type MermaCruda = {
    cantidad: number
    productos: { costos_producto: CostoEmbed } | null
  }
  const mermasData = await traerTodo<MermaCruda>(() =>
    supabase
      .from('movimientos_stock')
      .select('cantidad, productos(costos_producto(precio_costo))')
      .eq('tipo', 'merma')
      .gte('created_at', desde)
      .lte('created_at', hasta)
      .order('id')
  )

  const mermas = mermasData.reduce(
    (acc, m) => acc + m.cantidad * costoDesdeEmbed(m.productos?.costos_producto ?? null),
    0
  )

  // 3. Egresos del período (paginado). `egresos.fecha` es DATE → comparar
  // contra fecha local, no contra el ISO (arrastra un día de más al final).
  // Se excluyen las categorías de MERCADERÍA: esa plata ya impacta el
  // resultado como CMV al vender; contarla acá la restaría dos veces.
  //  · compra_mercaderia — compra directa con stock.
  //  · pago_proveedores — egreso que genera fn_pagar_cuenta por cada pago de
  //    una cuenta a pagar (siempre mercadería de OC). Con el pago integrado
  //    en la factura (mig 144) estos egresos se masifican: sin excluirlos, el
  //    resultado restaba CMV + el pago de la misma mercadería.
  const egresosData = await traerTodo<{ monto: number; fecha: string }>(() =>
    supabase
      .from('egresos')
      .select('monto, fecha')
      .not('categoria', 'in', '(compra_mercaderia,pago_proveedores)')
      .gte('fecha', fechaLocal(desde))
      .lte('fecha', fechaLocal(hasta))
      .order('id')
  )

  const egresos = egresosData.reduce(
    (acc, e) => acc + Number(e.monto),
    0
  )

  // 3b. Comisiones de tarjeta/MP + retención IIBB del período. Viven en
  // movimientos_cuenta (no en egresos) y son costo real de vender: sin esto el
  // resultado queda sobreestimado. `fecha` también es DATE. Se traen ambos
  // tipos y se netea con signo: los reversos por anulación (ingresos con la
  // misma categoría, desde mig 114) descuentan lo que la venta anulada sumó.
  const movsCosto = await traerTodo<{
    monto: number
    categoria: string
    tipo: string
  }>(() =>
    supabase
      .from('movimientos_cuenta')
      .select('monto, categoria, tipo')
      .in('tipo', ['ingreso', 'egreso'])
      .in('categoria', ['comisiones', 'iibb'])
      .gte('fecha', fechaLocal(desde))
      .lte('fecha', fechaLocal(hasta))
      .order('id')
  )
  let comisiones = 0
  let iibb = 0
  for (const m of movsCosto) {
    const monto = (Number(m.monto) || 0) * (m.tipo === 'egreso' ? 1 : -1)
    if (m.categoria === 'comisiones') comisiones += monto
    else iibb += monto
  }

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
  for (const e of egresosData) {
    // e.fecha es date-only: parsearla local (new Date('yyyy-MM-dd') es UTC y
    // corre el egreso al día local anterior → semana equivocada los lunes).
    const k = claveSemana(new Date(`${e.fecha}T00:00:00`))
    const punto = serieMap.get(k)
    if (punto) punto.egresos += Number(e.monto)
  }

  const margen_bruto = ventas_brutas - cmv
  const resultado_neto = margen_bruto - mermas - egresos - comisiones - iibb
  const ticket_promedio =
    cantidad_ventas > 0 ? ventas_brutas / cantidad_ventas : 0

  return {
    ventas_brutas,
    cmv,
    margen_bruto,
    mermas,
    egresos,
    comisiones,
    iibb,
    resultado_neto,
    cantidad_ventas,
    ticket_promedio,
    series_semanales: [...serieMap.values()],
  }
}

export type EstadoCuentaDerivado = 'pendiente' | 'pagada' | 'vencida'

export interface CuentaAPagarConProveedor {
  id: number
  pedido_id: number | null
  proveedor_id: number
  monto: number
  /** Plata REAL que salió (incluye sobrepagos por redondeo, mig 144). */
  monto_pagado: number
  /**
   * Lo que de verdad canceló deuda = monto_pagado − Σ sobrantes. Es la misma
   * definición que usa fn_pagar_cuenta v3 en el server: contra esto se calcula
   * el pendiente, no contra monto_pagado (que sobreestimaría con sobrepagos).
   */
  monto_aplicado: number
  /** Saldo que falta pagar = max(0, monto − monto_aplicado). */
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
  /** Plan de cuotas (mig 148), con estado derivado por FIFO. [] si no hay plan. */
  cuotas: CuotaConEstado[]
  /** Primera cuota no cubierta del plan, o null (sin plan o todo cubierto). */
  proxima_cuota: CuotaConEstado | null
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

export type EstadoCuotaDerivado = 'pagada' | 'parcial' | 'pendiente' | 'vencida'

export interface CuotaConEstado {
  id: number
  numero: number
  monto: number
  fecha_vencimiento: string
  /** Porción de esta cuota ya cubierta por los pagos (reparto FIFO). */
  pagado: number
  estado: EstadoCuotaDerivado
}

export interface CuotaCruda {
  id: number
  numero: number
  monto: number
  fecha_vencimiento: string
}

/**
 * Deriva el estado de cada cuota repartiendo el aplicado de la deuda por FIFO
 * (misma regla que fn_sync_vencimiento_cuotas, mig 148): head = monto − Σcuotas
 * es la porción "ya cubierta" cuando el plan se definió sobre un saldo parcial;
 * lo que excede el head se aplica cuota a cuota en orden (fecha, numero).
 * Con el padre 'pagada' todas las cuotas se muestran pagadas (cubre la
 * condonación de residuos ≤ $1 y los sobrepagos).
 */
export function derivarCuotas(
  montoDeuda: number,
  aplicado: number,
  estadoPadre: 'pendiente' | 'pagada' | 'vencida',
  crudas: CuotaCruda[] | null | undefined
): CuotaConEstado[] {
  const lista = [...(crudas ?? [])].sort(
    (a, b) =>
      a.fecha_vencimiento.localeCompare(b.fecha_vencimiento) ||
      a.numero - b.numero
  )
  if (lista.length === 0) return []

  const suma = lista.reduce((acc, c) => acc + Number(c.monto), 0)
  const head = Math.max(0, montoDeuda - suma)
  let restante =
    estadoPadre === 'pagada' ? suma : Math.max(0, aplicado - head)

  return lista.map((c) => {
    const monto = Number(c.monto)
    const pagado = Math.min(monto, restante)
    restante = Math.max(0, restante - monto)
    let estado: EstadoCuotaDerivado
    if (pagado >= monto - 0.009) {
      estado = 'pagada'
    } else if (derivarEstado('pendiente', c.fecha_vencimiento) === 'vencida') {
      estado = 'vencida' // manda sobre parcial: lo que resta ya está vencido
    } else if (pagado > 0.009) {
      estado = 'parcial'
    } else {
      estado = 'pendiente'
    }
    return {
      id: c.id,
      numero: c.numero,
      monto,
      fecha_vencimiento: c.fecha_vencimiento,
      pagado,
      estado,
    }
  })
}

/**
 * Filtro de estado del listado. `'abiertas'` = pendientes + vencidas (todo lo
 * no pagado); `null` = abiertas completas + las últimas pagadas.
 */
export type FiltroEstadoCuentas = EstadoCuentaDerivado | 'abiertas' | null

/**
 * Tope de cuentas pagadas históricas (las más recientes). Las abiertas son la
 * cartera de trabajo y se traen siempre completas; las pagadas crecen sin
 * tope con el histórico y se acotan acá.
 */
export const LIMITE_CUENTAS_PAGADAS = 500

const SELECT_CUENTAS =
  'id, pedido_id, proveedor_id, monto, monto_pagado, fecha_vencimiento, fecha_pago, estado, tiene_factura, provisoria, numero_factura, nota, proveedores(nombre), pagos_cuenta(sobrante), cuotas_cuenta_pagar(id, numero, monto, fecha_vencimiento)'

type FilaCuentaCruda = {
  id: number
  pedido_id: number | null
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
  pagos_cuenta: { sobrante: number | null }[] | null
  cuotas_cuenta_pagar: CuotaCruda[] | null
}

function mapearCuenta(f: FilaCuentaCruda): CuentaAPagarConProveedor {
  const pagado = Number(f.monto_pagado ?? 0)
  // Aplicado = pagado − sobrantes por redondeo (mig 144): la MISMA definición
  // de pendiente que fn_pagar_cuenta v3 usa server-side. Contra monto_pagado
  // (plata real, que incluye sobrepagos) el saldo quedaría subestimado cuando
  // una cuenta sobrepagada se re-factura al alza.
  const sobrantes = (f.pagos_cuenta ?? []).reduce(
    (acc, p) => acc + Number(p.sobrante ?? 0),
    0
  )
  const aplicado = Math.max(0, pagado - sobrantes)
  // Clamp a 0: en una cuenta pagada el saldo nunca se muestra negativo.
  const saldo = Math.max(0, Number(f.monto) - aplicado)
  const cuotas = derivarCuotas(
    Number(f.monto),
    aplicado,
    f.estado,
    f.cuotas_cuenta_pagar
  )
  return {
    id: f.id,
    pedido_id: f.pedido_id,
    proveedor_id: f.proveedor_id,
    monto: Number(f.monto),
    monto_pagado: pagado,
    monto_aplicado: aplicado,
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
    cuotas,
    proxima_cuota: cuotas.find((c) => c.pagado < c.monto - 0.009) ?? null,
  }
}

export async function getCuentasAPagar(
  estadoFiltro?: FiltroEstadoCuentas
): Promise<CuentaAPagarConProveedor[]> {
  const supabase = createClient()

  // Abiertas (no pagadas): cartera de trabajo, completa y sin truncar.
  // El desempate por id hace el orden único: sin él, la paginación de
  // traerTodo puede duplicar/saltear filas entre páginas ante empates de
  // vencimiento (multi-factura comparte fecha).
  const traerAbiertas = () =>
    traerTodo<FilaCuentaCruda>(() =>
      supabase
        .from('cuentas_a_pagar')
        .select(SELECT_CUENTAS)
        .neq('estado', 'pagada')
        .order('fecha_vencimiento', { ascending: true })
        .order('id', { ascending: true })
    )

  // Pagadas: histórico acotado a las ÚLTIMAS PAGADAS (fecha_pago, no
  // vencimiento): un pago de hoy sobre una deuda vencida hace meses tiene
  // que aparecer siempre, o el pago parece perdido.
  const traerPagadas = async (): Promise<FilaCuentaCruda[]> => {
    const { data, error } = await supabase
      .from('cuentas_a_pagar')
      .select(SELECT_CUENTAS)
      .eq('estado', 'pagada')
      .order('fecha_pago', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(LIMITE_CUENTAS_PAGADAS)
    if (error) throw error
    return (data ?? []) as unknown as FilaCuentaCruda[]
  }

  let crudas: FilaCuentaCruda[]
  if (estadoFiltro === 'pagada') {
    crudas = await traerPagadas()
  } else if (estadoFiltro) {
    crudas = await traerAbiertas()
  } else {
    const [abiertas, pagadas] = await Promise.all([
      traerAbiertas(),
      traerPagadas(),
    ])
    crudas = [...abiertas, ...pagadas]
  }

  const filas = crudas
    .map(mapearCuenta)
    .sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))

  if (estadoFiltro === 'pendiente' || estadoFiltro === 'vencida') {
    return filas.filter((f) => f.estado === estadoFiltro)
  }
  return filas
}

/**
 * Cuentas a pagar sin factura cargada (cola de trabajo del three-way match).
 * Filtra server-side: la cola es chica por naturaleza, el histórico no viaja.
 */
export async function getCuentasSinFactura(): Promise<
  CuentaAPagarConProveedor[]
> {
  const supabase = createClient()
  const crudas = await traerTodo<FilaCuentaCruda>(() =>
    supabase
      .from('cuentas_a_pagar')
      .select(SELECT_CUENTAS)
      .eq('tiene_factura', false)
      .order('fecha_vencimiento', { ascending: true })
      .order('id', { ascending: true })
  )
  return crudas.map(mapearCuenta)
}

/**
 * Una cuenta puntual por id. Para abrir desde Comprobantes una factura
 * histórica cuya cuenta pagada quedó fuera de la ventana de 500 de
 * getCuentasAPagar.
 */
export async function getCuentaAPagarPorId(
  id: number
): Promise<CuentaAPagarConProveedor | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('cuentas_a_pagar')
    .select(SELECT_CUENTAS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data ? mapearCuenta(data as unknown as FilaCuentaCruda) : null
}

// ─── Formas de pago (lista canónica, espejo del CHECK de pagos_cuenta) ───────

export const FORMAS_PAGO = [
  { valor: 'efectivo', label: 'Efectivo' },
  { valor: 'transferencia', label: 'Transferencia' },
  { valor: 'cheque', label: 'Cheque' },
  { valor: 'debito', label: 'Débito' },
  { valor: 'otro', label: 'Otro' },
] as const
export type FormaPago = (typeof FORMAS_PAGO)[number]['valor']

export const FORMA_PAGO_LABEL: Record<FormaPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  debito: 'Débito',
  otro: 'Otro',
}

export function esFormaPago(v: string | null): v is FormaPago {
  return v != null && FORMAS_PAGO.some((f) => f.valor === v)
}

export interface PagarCuentaPayload {
  cuenta_id: number
  usuario_id: string
  cuenta_origen_id: number
  monto: number
  fecha: string
  nota?: string | null
  forma_pago?: FormaPago | null
  comprobante?: string | null
}

/**
 * Registra un pago (total, parcial o con sobrante) de una cuenta a pagar, de
 * forma atómica (`fn_pagar_cuenta` v3): descuenta del saldo de la cuenta de
 * tesorería de origen, deja el pago en el historial (con forma de pago y
 * comprobante estructurados), genera el egreso y su asiento (Debe Proveedores
 * por lo aplicado + Debe Diferencias por el sobrante / Haber según el tipo de
 * cuenta de origen). La cuenta pasa a 'pagada' cuando se cubre el total; si se
 * paga de más (redondeo), el excedente va a 5.2.10 y la deuda queda saldada.
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
    p_forma_pago: payload.forma_pago ?? null,
    p_comprobante: payload.comprobante ?? null,
  })
  if (error) throw error
}

export interface CuotaPlanPayload {
  monto: number
  fecha_vencimiento: string
}

export interface DefinirCuotasPayload {
  cuenta_id: number
  usuario_id: string
  /** [] quita el plan; con elementos, Σ debe = saldo pendiente ± $0,01. */
  cuotas: CuotaPlanPayload[]
}

/**
 * Define / reemplaza / quita el plan de cuotas de una deuda (mig 148). El
 * server valida la suma contra el saldo real y deja el vencimiento del padre
 * apuntando a la primera cuota impaga.
 */
export async function definirCuotasCuenta(
  payload: DefinirCuotasPayload
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_definir_cuotas_cuenta', {
    p_cuenta_id: payload.cuenta_id,
    p_usuario_id: payload.usuario_id,
    p_cuotas: payload.cuotas as unknown as Json,
  })
  if (error) throw error
}

export interface PagoConCuenta {
  id: number
  monto: number
  fecha: string
  nota: string | null
  forma_pago: string | null
  comprobante: string | null
  sobrante: number
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
    .select(
      'id, monto, fecha, nota, forma_pago, comprobante, sobrante, cuenta_origen_id, cuentas(nombre)'
    )
    .eq('cuenta_a_pagar_id', cuentaAPagarId)
    .order('fecha', { ascending: false })
  if (error) throw error

  type FilaCruda = {
    id: number
    monto: number
    fecha: string
    nota: string | null
    forma_pago: string | null
    comprobante: string | null
    sobrante: number | null
    cuenta_origen_id: number | null
    cuentas: { nombre: string } | null
  }

  return ((data ?? []) as unknown as FilaCruda[]).map((p) => ({
    id: p.id,
    monto: Number(p.monto),
    fecha: p.fecha,
    nota: p.nota,
    forma_pago: p.forma_pago,
    comprobante: p.comprobante,
    sobrante: Number(p.sobrante ?? 0),
    cuenta_origen_id: p.cuenta_origen_id,
    cuenta_origen_nombre: p.cuentas?.nombre ?? null,
  }))
}

// ─── Pagos programados (mig 146): "lo pago el viernes" sin debitar hoy ───────

export interface PagoProgramadoConDatos {
  id: number
  cuenta_a_pagar_id: number
  cuenta_origen_id: number | null
  cuenta_origen_nombre: string | null
  monto: number
  forma_pago: string | null
  comprobante: string | null
  nota: string | null
  fecha_programada: string
  proveedor_nombre: string | null
  pedido_id: number | null
  numero_factura: string | null
}

/** Pagos programados PENDIENTES (los ejecutados/cancelados no se listan). */
export async function getPagosProgramados(): Promise<PagoProgramadoConDatos[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('pagos_programados')
    .select(
      'id, cuenta_a_pagar_id, cuenta_origen_id, monto, forma_pago, comprobante, nota, fecha_programada, cuentas(nombre), cuentas_a_pagar(pedido_id, numero_factura, proveedores(nombre))'
    )
    .eq('estado', 'pendiente')
    .order('fecha_programada', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw error

  type FilaCruda = {
    id: number
    cuenta_a_pagar_id: number
    cuenta_origen_id: number | null
    monto: number
    forma_pago: string | null
    comprobante: string | null
    nota: string | null
    fecha_programada: string
    cuentas: { nombre: string } | null
    cuentas_a_pagar: {
      pedido_id: number | null
      numero_factura: string | null
      proveedores: { nombre: string } | null
    } | null
  }

  return ((data ?? []) as unknown as FilaCruda[]).map((p) => ({
    id: p.id,
    cuenta_a_pagar_id: p.cuenta_a_pagar_id,
    cuenta_origen_id: p.cuenta_origen_id,
    cuenta_origen_nombre: p.cuentas?.nombre ?? null,
    monto: Number(p.monto),
    forma_pago: p.forma_pago,
    comprobante: p.comprobante,
    nota: p.nota,
    fecha_programada: p.fecha_programada,
    proveedor_nombre: p.cuentas_a_pagar?.proveedores?.nombre ?? null,
    pedido_id: p.cuentas_a_pagar?.pedido_id ?? null,
    numero_factura: p.cuentas_a_pagar?.numero_factura ?? null,
  }))
}

/** Ejecuta el pago programado: debita HOY vía fn_pagar_cuenta (atómico). */
export async function ejecutarPagoProgramado(
  programadoId: number,
  usuarioId: string
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_ejecutar_pago_programado', {
    p_programado_id: programadoId,
    p_usuario_id: usuarioId,
  })
  if (error) throw error
}

/** Cancela un pago programado pendiente (no toca nada más). */
export async function cancelarPagoProgramado(
  programadoId: number
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('pagos_programados')
    .update({ estado: 'cancelado' })
    .eq('id', programadoId)
    .eq('estado', 'pendiente')
  if (error) throw error
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

  // La lectura previa corre si el cambio toca monto O vencimiento: ambos
  // chocan con un plan de cuotas vigente (mig 148: el vencimiento del padre
  // lo fija la próxima cuota impaga, y el monto debe cuadrar con Σ cuotas).
  if (payload.monto !== undefined || payload.fecha_vencimiento !== undefined) {
    const { data: actual, error: errLeer } = await supabase
      .from('cuentas_a_pagar')
      .select(
        'monto_pagado, tiene_factura, estado, pagos_cuenta(sobrante), cuotas_cuenta_pagar(id)'
      )
      .eq('id', payload.cuenta_id)
      .single<{
        monto_pagado: number | null
        tiene_factura: boolean
        estado: 'pendiente' | 'pagada' | 'vencida'
        pagos_cuenta: { sobrante: number | null }[] | null
        cuotas_cuenta_pagar: { id: number }[] | null
      }>()
    if (errLeer) throw errLeer

    if ((actual.cuotas_cuenta_pagar ?? []).length > 0) {
      throw new Error(
        'Esta deuda tiene un plan de cuotas: editá el plan (o quitalo) desde "Plan de cuotas".'
      )
    }

    if (payload.monto !== undefined) {
      if (actual.tiene_factura) {
        throw new Error(
          'No se puede cambiar el monto: la cuenta ya tiene una factura cargada. Editá la factura en Comprobantes.'
        )
      }
      // Aplicado = pagado − sobrantes (misma definición que el server, mig 144).
      const pagado = Number(actual.monto_pagado ?? 0)
      const sobrantes = (actual.pagos_cuenta ?? []).reduce(
        (acc, p) => acc + Number(p.sobrante ?? 0),
        0
      )
      const aplicado = Math.max(0, pagado - sobrantes)
      if (payload.monto < aplicado) {
        throw new Error('El monto no puede ser menor a lo ya pagado.')
      }
      patch.monto = payload.monto
      // Re-derivar estado con la misma regla que fn_guardar_factura_compra v14:
      // subir el monto de una cuenta pagada la REABRE (si no, quedaría 'pagada'
      // con saldo, invisible en pendientes/flujo); bajarlo hasta lo ya aplicado
      // la cierra.
      if (aplicado > 0.009) {
        const cubre = aplicado >= payload.monto - 0.009
        if (cubre && actual.estado !== 'pagada') {
          patch.estado = 'pagada'
          patch.fecha_pago = new Date().toISOString()
        } else if (!cubre && actual.estado === 'pagada') {
          patch.estado = 'pendiente'
          patch.fecha_pago = null
        }
      }
    }
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
  cuenta_nombre: string | null
}

export async function getEgresos(
  desde: string,
  hasta: string,
  categoria?: string | null
): Promise<EgresoConUsuario[]> {
  const supabase = createClient()
  let query = supabase
    .from('egresos')
    .select('*, usuarios(nombre), cuentas(nombre)')
    // `fecha` es DATE: comparar contra fecha local (el ISO arrastra un día de más)
    .gte('fecha', fechaLocal(desde))
    .lte('fecha', fechaLocal(hasta))
    .order('fecha', { ascending: false })

  if (categoria) {
    query = query.eq('categoria', categoria)
  }

  const { data, error } = await query
  if (error) throw error

  type FilaCruda = EgresoRow & {
    usuarios: { nombre: string } | null
    cuentas: { nombre: string } | null
  }

  return ((data ?? []) as unknown as FilaCruda[]).map(
    ({ usuarios, cuentas, ...resto }) => ({
      ...resto,
      usuario_nombre: usuarios?.nombre ?? null,
      cuenta_nombre: cuentas?.nombre ?? null,
    })
  )
}

export interface NuevoEgresoPayload {
  descripcion: string
  monto: number
  categoria: string
  fecha: string // ISO yyyy-MM-dd
  usuario_id: string
  /** Si el gasto sale de la caja de un turno, se vincula acá (efectivo del turno). */
  turno_id?: number | null
  /** Cuenta de tesorería de la que sale el gasto (egreso de Finanzas). Debita el saldo. */
  cuenta_origen_id?: number | null
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
    p_cuenta_origen_id: payload.cuenta_origen_id ?? null,
  })
  if (error) throw error
  if (!data) throw new Error('No se pudo registrar el egreso.')
  return data as EgresoRow
}

export interface ActualizarEgresoPayload {
  /** Solo se edita la descripción: el monto/categoría/cuenta mueven saldos, así
   *  que para cambiarlos hay que anular y volver a crear el egreso. */
  descripcion: string
}

export async function actualizarEgreso(
  id: number,
  datos: ActualizarEgresoPayload
): Promise<EgresoRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('egresos')
    .update({ descripcion: datos.descripcion })
    .eq('id', id)
    .select()
    .single<EgresoRow>()
  if (error) throw error
  return data
}

/**
 * Anula un egreso vía RPC: repone el saldo de la cuenta (si debitó una),
 * inserta el movimiento inverso y revierte el asiento. Reemplaza el delete plano.
 */
export async function anularEgreso(id: number, usuarioId: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_anular_egreso', {
    p_egreso_id: id,
    p_usuario_id: usuarioId,
  })
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
