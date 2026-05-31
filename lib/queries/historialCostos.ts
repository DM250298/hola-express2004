import { createClient } from '@/lib/supabase/client'
import type { ConfigComprasUpdate, OrigenVariacionCosto } from '@/types/database'

export interface VariacionCosto {
  id: number
  producto_id: number
  producto_nombre: string
  codigo_barras: string | null
  precio_venta: number
  costo_anterior: number
  costo_nuevo: number
  variacion_pct: number
  origen: OrigenVariacionCosto
  pedido_id: number | null
  created_at: string
}

/** Últimas variaciones de costo registradas (monitor de costos). */
export async function getHistorialCostos(
  limite = 100
): Promise<VariacionCosto[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('historial_costos')
    .select(
      'id, producto_id, costo_anterior, costo_nuevo, variacion_pct, origen, pedido_id, created_at, productos(nombre, codigo_barras, precio_venta)'
    )
    .order('created_at', { ascending: false })
    .limit(limite)

  if (error) throw error

  type Fila = {
    id: number
    producto_id: number
    costo_anterior: number
    costo_nuevo: number
    variacion_pct: number
    origen: OrigenVariacionCosto
    pedido_id: number | null
    created_at: string
    productos: {
      nombre: string
      codigo_barras: string | null
      precio_venta: number
    } | null
  }

  return ((data ?? []) as unknown as Fila[]).map((f) => ({
    id: f.id,
    producto_id: f.producto_id,
    producto_nombre: f.productos?.nombre ?? 'Producto eliminado',
    codigo_barras: f.productos?.codigo_barras ?? null,
    precio_venta: Number(f.productos?.precio_venta ?? 0),
    costo_anterior: Number(f.costo_anterior),
    costo_nuevo: Number(f.costo_nuevo),
    variacion_pct: Number(f.variacion_pct),
    origen: f.origen,
    pedido_id: f.pedido_id,
    created_at: f.created_at,
  }))
}

export interface ConfigCompras {
  umbral_variacion_costo: number
  exige_factura: boolean
}

export async function getConfigCompras(): Promise<ConfigCompras> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('config_compras')
    .select('umbral_variacion_costo, exige_factura')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw error
  return {
    umbral_variacion_costo: Number(data?.umbral_variacion_costo ?? 10),
    exige_factura: data?.exige_factura ?? true,
  }
}

export async function actualizarConfigCompras(
  datos: ConfigComprasUpdate
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('config_compras')
    .update(datos)
    .eq('id', 1)
  if (error) throw error
}
