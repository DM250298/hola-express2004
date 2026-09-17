import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'

/**
 * Quiebres de stock (eventos de la mig 172, leídos vía fn_quiebres de la
 * mig 173). Un quiebre abierto = producto con control de stock que cruzó
 * a <= 0 y todavía no volvió a tener stock.
 *
 * `venta_perdida_*` es SIEMPRE una estimación (velocity 30 días previa al
 * quiebre × días sin stock, a precio de venta vigente): mostrarla con esa
 * etiqueta, nunca como dato contable.
 */
export interface QuiebreStock {
  id: number
  producto_id: number
  nombre: string
  codigo_barras: string | null
  venta_por_peso: boolean
  inicio_at: string
  fin_at: string | null
  abierto: boolean
  duracion_horas: number
  venta_perdida_unid: number | null
  venta_perdida_pesos: number | null
}

export interface FiltrosQuiebres {
  desde?: string
  hasta?: string
  solo_abiertos?: boolean
}

/**
 * Lista de quiebres. Devuelve `null` si la migración 172/173 todavía no
 * corrió (PGRST202) para que la UI oculte el bloque en vez de romper —
 * mismo criterio que el fallback de fn_ultimo_movimiento_por_producto.
 * Paginada con traerTodo: el Max Rows de PostgREST (1000) corta también a
 * las funciones set-returning (gotcha migs 104/151/160).
 */
export async function getQuiebres(
  filtros: FiltrosQuiebres = {}
): Promise<QuiebreStock[] | null> {
  const supabase = createClient()
  try {
    return await traerTodo<QuiebreStock>(() =>
      supabase.rpc('fn_quiebres', {
        p_desde: filtros.desde ?? null,
        p_hasta: filtros.hasta ?? null,
        p_solo_abiertos: filtros.solo_abiertos ?? false,
      })
    )
  } catch (e) {
    if ((e as Error & { code?: string }).code === 'PGRST202') return null
    throw e
  }
}

/** Quiebres activos ahora mismo (para las tarjetas de alertas). */
export async function getQuiebresActivos(): Promise<QuiebreStock[] | null> {
  return getQuiebres({ solo_abiertos: true })
}
