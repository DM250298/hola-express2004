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

export interface NuevoMedioPagoPayload {
  nombre: string
  icono: string
  comision_porcentaje?: number
  cuenta_id?: number | null
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
      cuenta_id: payload.cuenta_id ?? null,
      orden: ordenMax + 1,
      activo: true,
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
  comision_porcentaje?: number
  cuenta_id?: number | null
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
