import { createClient } from '@/lib/supabase/client'
import type { ConfigVentasUpdate } from '@/types/database'

export interface ConfigVentas {
  /** Si es true, el POS deja vender productos aunque el stock sea 0 o negativo. */
  permitir_venta_sin_stock: boolean
}

/** Config global de ventas (singleton id=1). Default seguro: sin venta en negativo. */
export async function getConfigVentas(): Promise<ConfigVentas> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('config_ventas')
    .select('permitir_venta_sin_stock')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw error
  return {
    permitir_venta_sin_stock: data?.permitir_venta_sin_stock ?? false,
  }
}

export async function actualizarConfigVentas(
  datos: ConfigVentasUpdate
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('config_ventas')
    .update(datos)
    .eq('id', 1)
  if (error) throw error
}
