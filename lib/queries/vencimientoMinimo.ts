import { createClient } from '@/lib/supabase/client'

/**
 * Aplica un `dias_vencimiento_minimo` a un grupo de productos —
 * filtrando por categoría, proveedor o ambos. Pasar `dias = null`
 * borra la restricción.
 *
 * Devuelve la cantidad de productos afectados.
 */
export async function aplicarMinimoMasivo(opts: {
  categoria_id?: number | null
  proveedor_id?: number | null
  dias: number | null
}): Promise<number> {
  const supabase = createClient()
  let q = supabase
    .from('productos')
    .update({
      dias_vencimiento_minimo: opts.dias,
      updated_at: new Date().toISOString(),
    })
    .eq('activo', true)

  if (opts.categoria_id != null) q = q.eq('categoria_id', opts.categoria_id)
  if (opts.proveedor_id != null) q = q.eq('proveedor_id', opts.proveedor_id)

  // Si no se pasa ningún filtro, no hacemos nada — evita borrar todo por accidente.
  if (opts.categoria_id == null && opts.proveedor_id == null) {
    throw new Error(
      'Elegí al menos un filtro (categoría o proveedor).'
    )
  }

  const { data, error } = await q.select('id')
  if (error) throw error
  return (data ?? []).length
}
