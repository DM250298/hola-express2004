import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
import type { MapaSkuRow, TipoUbicacion } from '@/types/database'

/**
 * Inteligencia por góndola (Fase E, migs 193 y 194). El mapa deja de ser
 * solo "dónde está" y pasa a decir "cuánto vende, cuánto inmoviliza y qué
 * tiene roto" cada parte del local.
 *
 * Cada nodo trae lo suyo MÁS lo de todo lo que cuelga de él. El semáforo
 * sale de las alertas vivas de sus productos (Fase F), no de un umbral
 * suelto: rojo = alguna crítica, amarillo = alguna de atención, verde =
 * sin alertas, gris = todavía sin productos ubicados.
 *
 * `null` = migraciones pendientes, para que la UI avise en vez de romper.
 */

export type ColorSemaforo = 'rojo' | 'amarillo' | 'verde' | 'gris'

export interface NodoMapa {
  id: number
  parent_id: number | null
  tipo: TipoUbicacion
  nombre: string
  codigo: string | null
  activo: boolean
  /** SKUs del nodo y de todos sus descendientes. */
  skus: number
  /** SKUs asignados exactamente a este nodo. */
  skus_directos: number
  ingresos: number
  margen: number | null
  margen_pct: number | null
  stock_valorizado: number | null
  dias_inventario: number | null
  quiebres: number
  sin_stock: number
  sin_movimiento: number
  alertas_criticas: number
  alertas_atencion: number
  semaforo: ColorSemaforo
}

export interface MapaSemaforo {
  puede_ver_costos: boolean
  periodo: { desde: string; hasta: string; dias: number }
  nodos: NodoMapa[]
  /** Productos activos que todavía no están en el mapa. */
  sin_ubicar: number
}

export type SkuNodo = MapaSkuRow

function faltaMigracion(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST202' || error?.code === 'PGRST205' || error?.code === '42P01'
}

export async function getMapaSemaforo(
  desde: string,
  hasta: string
): Promise<MapaSemaforo | null> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_mapa_semaforo', {
    p_desde: desde,
    p_hasta: hasta,
  })
  if (error) {
    if (faltaMigracion(error)) return null
    throw new Error(error.message)
  }
  return data as unknown as MapaSemaforo
}

/** Productos de un nodo y de todo lo que cuelga de él. */
export async function getSkusNodo(
  ubicacionId: number,
  desde: string,
  hasta: string
): Promise<SkuNodo[] | null> {
  const supabase = createClient()
  try {
    return await traerTodo<SkuNodo>(() =>
      supabase.rpc('fn_mapa_nodo_skus', {
        p_ubicacion_id: ubicacionId,
        p_desde: desde,
        p_hasta: hasta,
      })
    )
  } catch (e) {
    if (faltaMigracion(e as Error & { code?: string })) return null
    throw e
  }
}
