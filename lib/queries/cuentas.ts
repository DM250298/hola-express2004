import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
import { fechaLocal } from '@/lib/utils/periodos'
import type {
  CuentaInsert,
  CuentaRow,
  CuentaUpdate,
  MovimientoCuentaRow,
  TipoMovimientoCuenta,
} from '@/types/database'

// ─── CRUD cuentas ──────────────────────────────────────────────────

export async function getCuentas(soloActivas = true): Promise<CuentaRow[]> {
  const supabase = createClient()
  let q = supabase.from('cuentas').select('*').order('nombre', { ascending: true })
  if (soloActivas) q = q.eq('activo', true)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as CuentaRow[]
}

export async function createCuenta(datos: CuentaInsert): Promise<CuentaRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('cuentas')
    .insert(datos)
    .select()
    .single<CuentaRow>()
  if (error) throw error
  return data
}

export async function updateCuenta(
  id: number,
  datos: CuentaUpdate
): Promise<CuentaRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('cuentas')
    .update(datos)
    .eq('id', id)
    .select()
    .single<CuentaRow>()
  if (error) throw error
  return data
}

// ─── Movimientos ──────────────────────────────────────────────────

export interface MovimientoConCuenta extends MovimientoCuentaRow {
  cuenta_nombre: string | null
  contraparte_nombre: string | null
  usuario_nombre: string | null
}

export interface FiltrosMovimientos {
  cuenta_id?: number | null
  tipo?: TipoMovimientoCuenta | null
  categoria?: string | null
  desde?: string
  hasta?: string
}

export async function getMovimientos(
  filtros: FiltrosMovimientos = {}
): Promise<MovimientoConCuenta[]> {
  const supabase = createClient()

  type FilaCruda = MovimientoCuentaRow & {
    cuentas: { nombre: string } | null
    contraparte: { nombre: string } | null
    usuarios: { nombre: string } | null
  }

  const data = await traerTodo<FilaCruda>(() => {
    let q = supabase
      .from('movimientos_cuenta')
      .select(
        `*,
         cuentas:cuenta_id(nombre),
         contraparte:contraparte_cuenta_id(nombre),
         usuarios(nombre)`
      )
      .order('fecha', { ascending: false })
      .order('id', { ascending: false })

    if (filtros.cuenta_id != null) q = q.eq('cuenta_id', filtros.cuenta_id)
    if (filtros.tipo) q = q.eq('tipo', filtros.tipo)
    if (filtros.categoria) q = q.eq('categoria', filtros.categoria)
    // `fecha` es DATE: usar la fecha LOCAL del rango. slice(0,10) del ISO toma
    // la fecha UTC y el fin del rango (23:59 local) cae en el día siguiente.
    if (filtros.desde) q = q.gte('fecha', fechaLocal(filtros.desde))
    if (filtros.hasta) q = q.lte('fecha', fechaLocal(filtros.hasta))
    return q
  })

  return data.map(({ cuentas, contraparte, usuarios, ...resto }) => ({
    ...resto,
    cuenta_nombre: cuentas?.nombre ?? null,
    contraparte_nombre: contraparte?.nombre ?? null,
    usuario_nombre: usuarios?.nombre ?? null,
  }))
}

// ─── Crear movimiento (ingreso o egreso) ──────────────────────────

export interface NuevoMovimientoPayload {
  cuenta_id: number
  tipo: 'ingreso' | 'egreso' | 'ajuste'
  monto: number
  descripcion: string
  categoria?: string | null
  fecha?: string // ISO yyyy-MM-dd
  usuario_id: string
}

/**
 * Registra un movimiento en una cuenta y actualiza su saldo, de forma
 * atómica (`fn_crear_movimiento`): INSERT del movimiento + UPDATE del saldo
 * dentro de una única transacción.
 */
export async function crearMovimiento(
  payload: NuevoMovimientoPayload
): Promise<MovimientoCuentaRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_crear_movimiento', {
    p_cuenta_id: payload.cuenta_id,
    p_tipo: payload.tipo,
    p_monto: payload.monto,
    p_descripcion: payload.descripcion,
    p_categoria: payload.categoria ?? null,
    p_fecha: payload.fecha ?? null,
    p_usuario_id: payload.usuario_id,
  })
  if (error) throw error
  if (!data) throw new Error('No se pudo registrar el movimiento.')
  return data as MovimientoCuentaRow
}

// ─── Conciliación bancaria ────────────────────────────────────────

/** Marca (o desmarca) un movimiento como conciliado contra el extracto. */
export async function setConciliadoMovimiento(
  id: number,
  conciliado: boolean
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('movimientos_cuenta')
    .update({
      conciliado,
      fecha_conciliacion: conciliado ? new Date().toISOString() : null,
    })
    .eq('id', id)
  if (error) throw error
}

// ─── Transferencia entre cuentas ──────────────────────────────────

export interface NuevaTransferenciaPayload {
  cuenta_origen_id: number
  cuenta_destino_id: number
  monto: number
  descripcion: string
  fecha?: string
  usuario_id: string
}

/**
 * Crea una transferencia entre dos cuentas, de forma atómica
 * (`fn_crear_transferencia`): dos movimientos enlazados por `transferencia_id`
 * y la actualización de ambos saldos, todo en una única transacción.
 */
export async function crearTransferencia(
  payload: NuevaTransferenciaPayload
): Promise<{ transferencia_id: string }> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_crear_transferencia', {
    p_origen_id: payload.cuenta_origen_id,
    p_destino_id: payload.cuenta_destino_id,
    p_monto: payload.monto,
    p_descripcion: payload.descripcion,
    p_fecha: payload.fecha ?? null,
    p_usuario_id: payload.usuario_id,
  })
  if (error) throw error
  return { transferencia_id: (data as string) ?? '' }
}

// ─── Categorías estandar para movimientos ─────────────────────────

export const CATEGORIAS_INGRESO = [
  { valor: 'venta', etiqueta: 'Venta' },
  { valor: 'cobro_cliente', etiqueta: 'Cobro a cliente' },
  { valor: 'aporte_socio', etiqueta: 'Aporte de socio' },
  { valor: 'devolucion', etiqueta: 'Devolución / Reintegro' },
  { valor: 'otros', etiqueta: 'Otros ingresos' },
] as const

export const CATEGORIAS_EGRESO_MOV = [
  { valor: 'pago_proveedor', etiqueta: 'Pago a proveedor' },
  { valor: 'alquiler', etiqueta: 'Alquiler' },
  { valor: 'servicios', etiqueta: 'Servicios (luz/agua/gas)' },
  { valor: 'sueldos', etiqueta: 'Sueldos' },
  { valor: 'impuestos', etiqueta: 'Impuestos' },
  { valor: 'mantenimiento', etiqueta: 'Mantenimiento' },
  { valor: 'retiro_socio', etiqueta: 'Retiro de socio' },
  { valor: 'comisiones', etiqueta: 'Comisiones bancarias' },
  { valor: 'otros', etiqueta: 'Otros egresos' },
] as const

// Nota: la configuración por medio de pago (cuenta destino, comisión, activo)
// vive ahora en la tabla `medios_pago` — ver lib/queries/mediosPago.ts
