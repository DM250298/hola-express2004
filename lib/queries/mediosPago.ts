import { createClient } from '@/lib/supabase/client'
import type { MedioPagoRow } from '@/types/database'

/**
 * Convierte un nombre legible a un código en kebab-case sin acentos.
 * Ej: "Cuenta DNI" → "cuenta-dni"
 */
export function slugMedio(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // saca acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export async function getMediosPago(): Promise<MedioPagoRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('medios_pago')
    .select('*')
    .order('orden', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw error
  return (data ?? []) as MedioPagoRow[]
}

export async function getMediosPagoActivos(): Promise<MedioPagoRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('medios_pago')
    .select('*')
    .eq('activo', true)
    .order('orden', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw error
  return (data ?? []) as MedioPagoRow[]
}

/** Medios marcados como disponibles para cobrar con terminal/posnet. */
export async function getMediosPagoTerminal(): Promise<MedioPagoRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('medios_pago')
    .select('*')
    .eq('disponible_terminal', true)
    .order('orden', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw error
  return (data ?? []) as MedioPagoRow[]
}

export interface NuevoMedioPagoPayload {
  nombre: string
  icono: string
  comision_porcentaje?: number
  dias_acreditacion?: number
  cuenta_id?: number | null
  disponible_terminal?: boolean
  mp_payment_type?: string | null
  mp_payment_method_id?: string | null
}

/**
 * Dado el `payment_method.type` y `payment_method.id` que devolvió MP Point
 * al aprobarse una orden, encuentra el medio de pago más específico que
 * matchea. Prioridad: type+method_id exacto > type-only > null (no match).
 */
export function matchMedioPagoPorMP(
  medios: MedioPagoRow[],
  mpType: string | null | undefined,
  mpMethodId: string | null | undefined
): MedioPagoRow | null {
  if (!mpType) return null
  const candidatos = medios.filter(
    (m) => m.disponible_terminal && m.mp_payment_type === mpType
  )
  if (candidatos.length === 0) return null
  // 1. Match exacto type + method_id
  if (mpMethodId) {
    const exacto = candidatos.find((m) => m.mp_payment_method_id === mpMethodId)
    if (exacto) return exacto
  }
  // 2. Genérico (method_id NULL) — wildcard del type
  const generico = candidatos.find((m) => m.mp_payment_method_id == null)
  if (generico) return generico
  return null
}

export async function crearMedioPago(
  payload: NuevoMedioPagoPayload
): Promise<MedioPagoRow> {
  const supabase = createClient()

  const nombre = payload.nombre.trim()
  if (!nombre) throw new Error('El nombre no puede estar vacío.')

  // Generar un código único a partir del nombre
  const base = slugMedio(nombre) || 'medio'
  const { data: existentes, error: errExist } = await supabase
    .from('medios_pago')
    .select('codigo, orden')
  if (errExist) throw errExist

  const codigosUsados = new Set((existentes ?? []).map((m) => m.codigo))
  let codigo = base
  let n = 2
  while (codigosUsados.has(codigo)) {
    codigo = `${base}-${n}`
    n++
  }

  const ordenMax = (existentes ?? []).reduce(
    (max, m) => Math.max(max, m.orden ?? 0),
    0
  )

  const { data, error } = await supabase
    .from('medios_pago')
    .insert({
      codigo,
      nombre,
      icono: payload.icono || 'wallet',
      comision_porcentaje: payload.comision_porcentaje ?? 0,
      dias_acreditacion: payload.dias_acreditacion ?? 0,
      cuenta_id: payload.cuenta_id ?? null,
      orden: ordenMax + 1,
      activo: true,
      disponible_terminal: payload.disponible_terminal ?? false,
      mp_payment_type: payload.mp_payment_type ?? null,
      mp_payment_method_id: payload.mp_payment_method_id ?? null,
      protegido: false,
    })
    .select()
    .single<MedioPagoRow>()
  if (error) throw error
  return data
}

export interface ActualizarMedioPagoPatch {
  nombre?: string
  icono?: string
  activo?: boolean
  disponible_terminal?: boolean
  comision_porcentaje?: number
  dias_acreditacion?: number
  cuenta_id?: number | null
  mp_payment_type?: string | null
  mp_payment_method_id?: string | null
}

export async function actualizarMedioPago(
  id: number,
  patch: ActualizarMedioPagoPatch
): Promise<MedioPagoRow> {
  const supabase = createClient()

  // No permitir desactivar un medio protegido (ej: efectivo).
  if (patch.activo === false) {
    const { data: actual } = await supabase
      .from('medios_pago')
      .select('protegido, nombre')
      .eq('id', id)
      .maybeSingle<{ protegido: boolean; nombre: string }>()
    if (actual?.protegido) {
      throw new Error(
        `"${actual.nombre}" es un medio base y no se puede desactivar.`
      )
    }
  }

  const { data, error } = await supabase
    .from('medios_pago')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single<MedioPagoRow>()
  if (error) throw error
  return data
}

/**
 * Borra un medio de pago. Bloquea si está protegido o si ya tiene ventas
 * registradas con ese medio (en ese caso conviene desactivarlo).
 */
export async function eliminarMedioPago(id: number): Promise<void> {
  const supabase = createClient()

  const { data: medio, error: errMedio } = await supabase
    .from('medios_pago')
    .select('codigo, nombre, protegido')
    .eq('id', id)
    .maybeSingle<{ codigo: string; nombre: string; protegido: boolean }>()
  if (errMedio) throw errMedio
  if (!medio) throw new Error('El medio de pago no existe.')
  if (medio.protegido) {
    throw new Error(`"${medio.nombre}" es un medio base y no se puede borrar.`)
  }

  // ¿Tiene ventas registradas con este medio?
  const { count, error: errUso } = await supabase
    .from('pagos_venta')
    .select('id', { count: 'exact', head: true })
    .eq('medio_pago', medio.codigo)
  if (errUso) throw errUso
  if ((count ?? 0) > 0) {
    throw new Error(
      `"${medio.nombre}" ya tiene ${count} pagos registrados. ` +
        'Desactivalo en vez de borrarlo para no perder el historial.'
    )
  }

  const { error } = await supabase.from('medios_pago').delete().eq('id', id)
  if (error) throw error
}
