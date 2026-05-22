import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
import type {
  ActivoFijoRow,
  AsientoItemRow,
  AsientoRow,
  Json,
  PlanCuentaRow,
  TipoCuentaContable,
} from '@/types/database'

export const TIPOS_CUENTA: Array<{
  valor: TipoCuentaContable
  etiqueta: string
}> = [
  { valor: 'activo', etiqueta: 'Activo' },
  { valor: 'pasivo', etiqueta: 'Pasivo' },
  { valor: 'patrimonio', etiqueta: 'Patrimonio Neto' },
  { valor: 'ingreso', etiqueta: 'Ingresos' },
  { valor: 'egreso', etiqueta: 'Egresos' },
]

/** Todas las cuentas del plan, ordenadas jerárquicamente por código. */
export async function getPlanCuentas(): Promise<PlanCuentaRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('plan_cuentas')
    .select('*')
    .order('codigo', { ascending: true })
  if (error) throw error
  return (data ?? []) as PlanCuentaRow[]
}

export interface NuevaCuentaPayload {
  codigo: string
  nombre: string
  tipo: TipoCuentaContable
  imputable: boolean
}

export async function crearCuentaContable(
  payload: NuevaCuentaPayload
): Promise<PlanCuentaRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('plan_cuentas')
    .insert({
      codigo: payload.codigo.trim(),
      nombre: payload.nombre.trim(),
      tipo: payload.tipo,
      imputable: payload.imputable,
    })
    .select()
    .single<PlanCuentaRow>()
  if (error) {
    if (error.code === '23505') {
      throw new Error(`Ya existe una cuenta con el código ${payload.codigo}.`)
    }
    throw error
  }
  return data
}

export interface ActualizarCuentaPatch {
  codigo?: string
  nombre?: string
  tipo?: TipoCuentaContable
  imputable?: boolean
  activo?: boolean
}

export async function actualizarCuentaContable(
  id: number,
  patch: ActualizarCuentaPatch
): Promise<PlanCuentaRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('plan_cuentas')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single<PlanCuentaRow>()
  if (error) throw error
  return data
}

export async function eliminarCuentaContable(id: number): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('plan_cuentas').delete().eq('id', id)
  if (error) throw error
}

// ─── Asientos contables (libro diario) ────────────────────────────

export interface AsientoListado extends AsientoRow {
  total: number
}

/** Libro diario: todos los asientos, del más reciente al más viejo. */
export async function getAsientos(): Promise<AsientoListado[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('asientos')
    .select('*, asientos_items(debe)')
    .order('fecha', { ascending: false })
    .order('id', { ascending: false })
  if (error) throw error

  type Fila = AsientoRow & { asientos_items: Array<{ debe: number }> }
  return ((data ?? []) as unknown as Fila[]).map(
    ({ asientos_items, ...resto }) => ({
      ...resto,
      total: (asientos_items ?? []).reduce((s, i) => s + Number(i.debe), 0),
    })
  )
}

export interface AsientoItemDetalle extends AsientoItemRow {
  cuenta_codigo: string
  cuenta_nombre: string
}

export interface AsientoDetalle {
  asiento: AsientoRow
  items: AsientoItemDetalle[]
}

export async function getAsientoDetalle(
  id: number
): Promise<AsientoDetalle | null> {
  const supabase = createClient()
  const { data: asiento, error: errA } = await supabase
    .from('asientos')
    .select('*')
    .eq('id', id)
    .maybeSingle<AsientoRow>()
  if (errA) throw errA
  if (!asiento) return null

  const { data: items, error: errI } = await supabase
    .from('asientos_items')
    .select('*, plan_cuentas(codigo, nombre)')
    .eq('asiento_id', id)
    .order('orden', { ascending: true })
  if (errI) throw errI

  type ItemCrudo = AsientoItemRow & {
    plan_cuentas: { codigo: string; nombre: string } | null
  }
  return {
    asiento,
    items: ((items ?? []) as unknown as ItemCrudo[]).map(
      ({ plan_cuentas, ...resto }) => ({
        ...resto,
        cuenta_codigo: plan_cuentas?.codigo ?? '',
        cuenta_nombre: plan_cuentas?.nombre ?? 'Cuenta eliminada',
      })
    ),
  }
}

export interface LineaAsientoPayload {
  cuenta_id: number
  debe: number
  haber: number
}

export interface NuevoAsientoPayload {
  fecha: string
  descripcion: string
  usuario_id: string
  lineas: LineaAsientoPayload[]
}

export async function crearAsientoManual(
  payload: NuevoAsientoPayload
): Promise<AsientoRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_crear_asiento', {
    p_fecha: payload.fecha,
    p_descripcion: payload.descripcion,
    p_usuario_id: payload.usuario_id,
    p_lineas: payload.lineas as unknown as Json,
  })
  if (error) throw error
  if (!data) throw new Error('No se pudo crear el asiento.')
  return data as AsientoRow
}

export async function anularAsiento(id: number): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('asientos')
    .update({ anulado: true })
    .eq('id', id)
  if (error) throw error
}

// ─── Activos fijos ────────────────────────────────────────────────

export interface DepreciacionActivo {
  mensual: number
  mesesTranscurridos: number
  amortAcumulada: number
  valorLibros: number
}

/** Amortización lineal de un activo fijo, calculada a la fecha de hoy. */
export function calcularDepreciacion(a: {
  fecha_adquisicion: string
  valor_origen: number
  vida_util_meses: number
  valor_residual: number
  estado: string
  fecha_baja: string | null
}): DepreciacionActivo {
  const depreciable = Math.max(
    Number(a.valor_origen) - Number(a.valor_residual),
    0
  )
  const mensual = a.vida_util_meses > 0 ? depreciable / a.vida_util_meses : 0
  const inicio = new Date(a.fecha_adquisicion)
  const hasta =
    a.estado === 'baja' && a.fecha_baja ? new Date(a.fecha_baja) : new Date()
  const meses = Math.max(
    0,
    (hasta.getFullYear() - inicio.getFullYear()) * 12 +
      (hasta.getMonth() - inicio.getMonth())
  )
  const amortAcumulada = Math.min(mensual * meses, depreciable)
  return {
    mensual: Math.round(mensual * 100) / 100,
    mesesTranscurridos: meses,
    amortAcumulada: Math.round(amortAcumulada * 100) / 100,
    valorLibros: Math.round((Number(a.valor_origen) - amortAcumulada) * 100) / 100,
  }
}

export async function getActivos(): Promise<ActivoFijoRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('activos_fijos')
    .select('*')
    .order('fecha_adquisicion', { ascending: false })
  if (error) throw error
  return (data ?? []) as ActivoFijoRow[]
}

export interface NuevoActivoPayload {
  nombre: string
  descripcion: string | null
  fecha_adquisicion: string
  valor_origen: number
  vida_util_meses: number
  valor_residual: number
  usuario_id: string
}

export async function crearActivo(
  payload: NuevoActivoPayload
): Promise<ActivoFijoRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_crear_activo', {
    p_nombre: payload.nombre,
    p_descripcion: payload.descripcion,
    p_fecha_adquisicion: payload.fecha_adquisicion,
    p_valor_origen: payload.valor_origen,
    p_vida_util_meses: payload.vida_util_meses,
    p_valor_residual: payload.valor_residual,
    p_usuario_id: payload.usuario_id,
  })
  if (error) throw error
  if (!data) throw new Error('No se pudo registrar el activo.')
  return data as ActivoFijoRow
}

export async function darDeBajaActivo(id: number): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('activos_fijos')
    .update({
      estado: 'baja',
      fecha_baja: new Date().toISOString().slice(0, 10),
    })
    .eq('id', id)
  if (error) throw error
}

// ─── Liquidación de IVA ───────────────────────────────────────────

const r2 = (n: number) => Math.round(n * 100) / 100

export interface LiquidacionIva {
  ventas_total: number
  iva_debito: number
  compras_neto: number
  iva_credito: number
  /** Posición: > 0 IVA a pagar · < 0 saldo a favor. */
  posicion: number
}

/**
 * Liquidación de IVA de un período (desde inclusive, hastaExcl exclusivo).
 *  · IVA Débito  = IVA contenido en las ventas (precio final, 21%).
 *  · IVA Crédito = IVA de las facturas de compra cargadas.
 */
export async function getLiquidacionIva(
  desde: string,
  hastaExcl: string
): Promise<LiquidacionIva> {
  const supabase = createClient()

  const ventas = await traerTodo<{ total: number }>(() =>
    supabase
      .from('ventas')
      .select('total')
      .eq('estado', 'completada')
      .gte('fecha', desde)
      .lt('fecha', hastaExcl)
  )
  const ventasTotal = ventas.reduce((s, v) => s + Number(v.total), 0)
  const ivaDebito = ventasTotal - ventasTotal / 1.21

  const { data: facturas, error } = await supabase
    .from('facturas_compra')
    .select('neto, iva_total')
    .gte('fecha', desde)
    .lt('fecha', hastaExcl)
  if (error) throw error

  const comprasNeto = (facturas ?? []).reduce(
    (s, f) => s + Number(f.neto),
    0
  )
  const ivaCredito = (facturas ?? []).reduce(
    (s, f) => s + Number(f.iva_total),
    0
  )

  return {
    ventas_total: r2(ventasTotal),
    iva_debito: r2(ivaDebito),
    compras_neto: r2(comprasNeto),
    iva_credito: r2(ivaCredito),
    posicion: r2(ivaDebito - ivaCredito),
  }
}
