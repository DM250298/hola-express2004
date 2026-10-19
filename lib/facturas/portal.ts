/**
 * Lógica pura del portal de facturas de proveedores (Compras › Facturas de
 * proveedores, oct-2026). Sin React ni Supabase: la prueba `portal.test.ts`
 * la corre con `node --test`.
 *
 * Una "fila" del portal es una deuda (`cuentas_a_pagar`) con su factura
 * (`facturas_compra`) si ya se cargó, o una compra directa pagada en el acto
 * (factura sin deuda). Sobre esa fila se deriva UN estado explícito:
 *
 *   sin_factura → a_validar → a_pagar / vencida → pagada
 *
 * y marcas secundarias (parcial, cuotas, con diferencias, sin datos
 * fiscales, pagada sin factura). "vencida" y "parcial" ya vienen derivados
 * de `mapearCuenta` (lib/queries/finanzas.ts): acá no se recalculan.
 */

import type { CuentaAPagarConProveedor } from '@/lib/queries/finanzas'
import type { ComprobanteCargado } from '@/lib/queries/facturasCompra'

export type EstadoFactura =
  | 'sin_factura'
  | 'a_validar'
  | 'a_pagar'
  | 'vencida'
  | 'pagada'

export const ESTADOS_FACTURA: EstadoFactura[] = [
  'sin_factura',
  'a_validar',
  'a_pagar',
  'vencida',
  'pagada',
]

export const ETIQUETA_ESTADO: Record<EstadoFactura, string> = {
  sin_factura: 'Sin factura',
  a_validar: 'A validar',
  a_pagar: 'A pagar',
  vencida: 'Vencida',
  pagada: 'Pagada',
}

export type MarcaFactura =
  | 'parcial'
  | 'cuotas'
  | 'con_diferencias'
  | 'sin_datos_fiscales'
  | 'pagada_sin_factura'
  | 'pago_inmediato'

export type AccionFactura = 'cargar_factura' | 'validar' | 'pagar' | 'ver'

export interface FilaPortal {
  /** 'c-<cuenta_id>' o 'f-<factura_id>' (directa sin deuda). */
  clave: string
  cuenta: CuentaAPagarConProveedor | null
  factura: ComprobanteCargado | null
  proveedor_id: number | null
  proveedor_nombre: string
  estado: EstadoFactura
  marcas: MarcaFactura[]
  accion: AccionFactura
  /** Total de la factura; si no hay factura, el estimado de la recepción. */
  total: number
  pagado: number
  saldo: number
  /** Vencimiento de la deuda (date). null = sin deuda (pagada en el acto). */
  vence: string | null
  /** Fecha de pago (date) si está pagada. */
  fecha_pago: string | null
  /** Pedido de origen; null = compra directa. */
  pedido_id: number | null
  /** Para el período de las pagadas: fecha_pago o emisión. */
  fecha_referencia: string
  /**
   * Fecha del comprobante (yyyy-MM-dd): la emisión de la factura o, si
   * todavía no hay factura, el día en que se registró la deuda (la recepción).
   */
  fecha_comprobante: string
}

/** Cómo se ordena la lista. */
export type OrdenPortal = 'fecha_asc' | 'fecha_desc' | 'vencimiento'

export const ETIQUETA_ORDEN: Record<OrdenPortal, string> = {
  fecha_desc: 'Fecha · más nuevo primero',
  fecha_asc: 'Fecha · más viejo primero',
  vencimiento: 'Urgencia · vencidas primero',
}

export interface FiltrosPortal {
  estado: EstadoFactura | 'todas'
  /** Texto libre: proveedor, n° de comprobante, pedido, nota. */
  texto: string
  proveedorId: number | null
  /** Rango (yyyy-MM-dd, inclusive) que acota SOLO las pagadas. */
  desde: string
  hasta: string
}

/**
 * ¿Le faltan datos fiscales al comprobante? Tipo X (ticket/recibo sin datos)
 * está exento, igual que `exigeDatosFiscales` de lib/utils/fiscal.
 */
export function faltanDatosFiscales(f: ComprobanteCargado): boolean {
  const tipo = (f.tipo_comprobante ?? '').trim().toUpperCase()
  if (tipo === 'X') return false
  return !tipo || !f.punto_venta || !f.numero_comprobante || !f.cuit_proveedor
}

/** Estado explícito de una deuda con (o sin) su factura. */
export function estadoFactura(
  cuenta: CuentaAPagarConProveedor | null,
  factura: ComprobanteCargado | null
): EstadoFactura {
  if (!factura) {
    if (!cuenta) return 'pagada'
    if (!cuenta.tiene_factura) return 'sin_factura'
    // Deuda marcada con factura pero sin comprobante en facturas_compra
    // (flujos previos a la mig 086): no hay nada que validar.
    return estadoDeuda(cuenta)
  }
  if (!factura.validada) return 'a_validar'
  if (!cuenta) return 'pagada'
  return estadoDeuda(cuenta)
}

function estadoDeuda(cuenta: CuentaAPagarConProveedor): EstadoFactura {
  if (cuenta.estado === 'pagada') return 'pagada'
  if (cuenta.estado === 'vencida') return 'vencida'
  return 'a_pagar'
}

export function accionDe(estado: EstadoFactura): AccionFactura {
  switch (estado) {
    case 'sin_factura':
      return 'cargar_factura'
    case 'a_validar':
      return 'validar'
    case 'a_pagar':
    case 'vencida':
      return 'pagar'
    default:
      return 'ver'
  }
}

export function marcasDe(
  cuenta: CuentaAPagarConProveedor | null,
  factura: ComprobanteCargado | null,
  estado: EstadoFactura
): MarcaFactura[] {
  const m: MarcaFactura[] = []
  if (cuenta) {
    if (estado !== 'pagada' && cuenta.parcial) m.push('parcial')
    if (cuenta.cuotas.length > 0) m.push('cuotas')
    if (!cuenta.tiene_factura && cuenta.estado === 'pagada') {
      m.push('pagada_sin_factura')
    }
  } else if (factura) {
    m.push('pago_inmediato')
  }
  if (factura) {
    if ((factura.renglones_diferentes ?? 0) > 0) m.push('con_diferencias')
    if (faltanDatosFiscales(factura)) m.push('sin_datos_fiscales')
  }
  return m
}

/**
 * Arma las filas del portal a partir de las deudas y las facturas cargadas.
 * Una deuda puede no tener factura (provisoria) y una factura directa puede
 * no tener deuda (pagada en el acto). `nombresProveedor` resuelve el nombre
 * de las facturas directas (facturas_compra.proveedor_id no tiene FK).
 */
export function armarFilasPortal(
  cuentas: readonly CuentaAPagarConProveedor[],
  facturas: readonly ComprobanteCargado[],
  nombresProveedor: ReadonlyMap<number, string>
): FilaPortal[] {
  const facturaPorCuenta = new Map<number, ComprobanteCargado>()
  const sinCuenta: ComprobanteCargado[] = []
  for (const f of facturas) {
    if (f.cuenta_id != null) facturaPorCuenta.set(f.cuenta_id, f)
    else sinCuenta.push(f)
  }

  const filas: FilaPortal[] = []
  for (const c of cuentas) {
    const f = facturaPorCuenta.get(c.id) ?? null
    const estado = estadoFactura(c, f)
    filas.push({
      clave: `c-${c.id}`,
      cuenta: c,
      factura: f,
      proveedor_id: c.proveedor_id,
      proveedor_nombre:
        c.proveedor_nombre ??
        nombresProveedor.get(c.proveedor_id) ??
        'Proveedor',
      estado,
      marcas: marcasDe(c, f, estado),
      accion: accionDe(estado),
      total: f ? f.total : c.monto,
      pagado: c.monto_pagado,
      saldo: c.saldo_pendiente,
      vence: c.fecha_vencimiento,
      fecha_pago: c.fecha_pago,
      pedido_id: c.pedido_id ?? f?.pedido_id ?? null,
      fecha_referencia: (c.fecha_pago ?? f?.fecha ?? c.fecha_vencimiento).slice(0, 10),
      fecha_comprobante: (f?.fecha ?? c.created_at ?? c.fecha_vencimiento).slice(0, 10),
    })
  }
  for (const f of sinCuenta) {
    const estado = estadoFactura(null, f)
    filas.push({
      clave: `f-${f.id}`,
      cuenta: null,
      factura: f,
      proveedor_id: f.proveedor_id,
      proveedor_nombre:
        (f.proveedor_id != null ? nombresProveedor.get(f.proveedor_id) : null) ??
        'Proveedor',
      estado,
      marcas: marcasDe(null, f, estado),
      accion: accionDe(estado),
      total: f.total,
      pagado: f.total,
      saldo: 0,
      vence: null,
      fecha_pago: f.fecha,
      pedido_id: f.pedido_id,
      fecha_referencia: f.fecha.slice(0, 10),
      fecha_comprobante: f.fecha.slice(0, 10),
    })
  }
  return filas.sort(ordenPortal)
}

/** Copia ordenada según `orden` (la lista cronológica es la que pidió el dueño). */
export function ordenarFilas(
  filas: readonly FilaPortal[],
  orden: OrdenPortal
): FilaPortal[] {
  const copia = [...filas]
  if (orden === 'vencimiento') return copia.sort(ordenPortal)
  const signo = orden === 'fecha_asc' ? 1 : -1
  return copia.sort(
    (a, b) =>
      signo * a.fecha_comprobante.localeCompare(b.fecha_comprobante) ||
      a.clave.localeCompare(b.clave)
  )
}

/**
 * Orden por urgencia: primero lo que requiere acción (vencidas, luego por
 * vencimiento más próximo), las pagadas al final de la más reciente a la más
 * vieja.
 */
export function ordenPortal(a: FilaPortal, b: FilaPortal): number {
  const pa = a.estado === 'pagada' ? 1 : 0
  const pb = b.estado === 'pagada' ? 1 : 0
  if (pa !== pb) return pa - pb
  if (pa === 1) {
    return b.fecha_referencia.localeCompare(a.fecha_referencia) || b.clave.localeCompare(a.clave)
  }
  const va = a.estado === 'vencida' ? 0 : 1
  const vb = b.estado === 'vencida' ? 0 : 1
  if (va !== vb) return va - vb
  return (
    (a.vence ?? '9999').localeCompare(b.vence ?? '9999') ||
    a.clave.localeCompare(b.clave)
  )
}

/** Número de comprobante como lo imprime el papel: "A 0003-00045812". */
export function nroComprobante(f: ComprobanteCargado | null): string | null {
  if (!f) return null
  if (!f.tipo_comprobante && !f.punto_venta && !f.numero_comprobante) return null
  const pto = f.punto_venta ? f.punto_venta.padStart(4, '0') : '----'
  const nro = f.numero_comprobante
    ? f.numero_comprobante.padStart(8, '0')
    : '--------'
  return `${f.tipo_comprobante ?? '?'} ${pto}-${nro}`
}

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

export function filtrarFilas(
  filas: readonly FilaPortal[],
  filtros: FiltrosPortal
): FilaPortal[] {
  const texto = normalizar(filtros.texto.trim())
  const soloDigitos = texto.replace(/\D/g, '')
  return filas.filter((f) => {
    if (filtros.estado !== 'todas' && f.estado !== filtros.estado) return false
    if (filtros.proveedorId != null && f.proveedor_id !== filtros.proveedorId) {
      return false
    }
    // El período acota solo las pagadas: lo abierto se muestra siempre.
    if (
      f.estado === 'pagada' &&
      (f.fecha_referencia < filtros.desde || f.fecha_referencia > filtros.hasta)
    ) {
      return false
    }
    if (texto === '') return true
    if (normalizar(f.proveedor_nombre).includes(texto)) return true
    const nro = nroComprobante(f.factura)
    if (nro && normalizar(nro).includes(texto)) return true
    if (
      soloDigitos &&
      f.factura?.numero_comprobante &&
      f.factura.numero_comprobante.replace(/^0+/, '').includes(soloDigitos.replace(/^0+/, ''))
    ) {
      return true
    }
    if (f.pedido_id != null && (texto === `#${f.pedido_id}` || texto === String(f.pedido_id))) {
      return true
    }
    if (f.cuenta?.numero_factura && normalizar(f.cuenta.numero_factura).includes(texto)) {
      return true
    }
    if (f.cuenta?.nota && normalizar(f.cuenta.nota).includes(texto)) return true
    return false
  })
}

export interface ResumenPortal {
  sin_factura: { cantidad: number; estimado: number }
  a_validar: { cantidad: number; total: number; con_diferencias: number }
  a_pagar: { cantidad: number; saldo: number; vencidas: number; saldo_vencido: number }
  pagadas: { cantidad: number; total: number; sin_factura: number }
  /** Cantidad por estado para las pestañas (las pagadas, dentro del período). */
  porEstado: Record<EstadoFactura | 'todas', number>
}

/**
 * Resumen para las tarjetas de arriba. Las pagadas se cuentan dentro del
 * período; lo abierto, siempre todo. El filtro de proveedor sí aplica a todo.
 */
export function resumirPortal(
  filas: readonly FilaPortal[],
  filtros: Pick<FiltrosPortal, 'desde' | 'hasta' | 'proveedorId'>
): ResumenPortal {
  const base = filtrarFilas(filas, {
    estado: 'todas',
    texto: '',
    proveedorId: filtros.proveedorId,
    desde: filtros.desde,
    hasta: filtros.hasta,
  })
  const r: ResumenPortal = {
    sin_factura: { cantidad: 0, estimado: 0 },
    a_validar: { cantidad: 0, total: 0, con_diferencias: 0 },
    a_pagar: { cantidad: 0, saldo: 0, vencidas: 0, saldo_vencido: 0 },
    pagadas: { cantidad: 0, total: 0, sin_factura: 0 },
    porEstado: { todas: base.length, sin_factura: 0, a_validar: 0, a_pagar: 0, vencida: 0, pagada: 0 },
  }
  for (const f of base) {
    r.porEstado[f.estado] += 1
    switch (f.estado) {
      case 'sin_factura':
        r.sin_factura.cantidad += 1
        r.sin_factura.estimado += f.total
        break
      case 'a_validar':
        r.a_validar.cantidad += 1
        r.a_validar.total += f.total
        if (f.marcas.includes('con_diferencias')) r.a_validar.con_diferencias += 1
        break
      case 'a_pagar':
      case 'vencida':
        r.a_pagar.cantidad += 1
        r.a_pagar.saldo += f.saldo
        if (f.estado === 'vencida') {
          r.a_pagar.vencidas += 1
          r.a_pagar.saldo_vencido += f.saldo
        }
        break
      case 'pagada':
        r.pagadas.cantidad += 1
        r.pagadas.total += f.total
        if (f.marcas.includes('pagada_sin_factura')) r.pagadas.sin_factura += 1
        break
    }
  }
  return r
}
