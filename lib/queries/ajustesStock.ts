import { createClient } from '@/lib/supabase/client'
import type {
  AjusteStockRow,
  ItemAjusteStockRow,
  Json,
} from '@/types/database'

export type TipoAjuste = 'entrada' | 'salida' | 'ajuste'

export const RAZONES_AJUSTE = [
  { valor: 'merma', etiqueta: 'Merma' },
  { valor: 'rotura', etiqueta: 'Rotura' },
  { valor: 'vencimiento', etiqueta: 'Vencimiento' },
  { valor: 'robo', etiqueta: 'Robo / Faltante' },
  { valor: 'sobrante', etiqueta: 'Sobrante encontrado' },
  { valor: 'recuento', etiqueta: 'Recuento / Diferencia' },
  { valor: 'devolucion', etiqueta: 'Devolución de cliente' },
  { valor: 'otra', etiqueta: 'Otra razón' },
] as const

export function etiquetaRazon(valor: string): string {
  return RAZONES_AJUSTE.find((r) => r.valor === valor)?.etiqueta ?? valor
}

export const ETIQUETAS_TIPO_AJUSTE: Record<TipoAjuste, string> = {
  entrada: 'Entrada (+)',
  salida: 'Salida (−)',
  ajuste: 'Fijar stock',
}

export interface ItemAjustePayload {
  producto_id: number
  nombre: string
  tipo: TipoAjuste
  /** entrada/salida: cantidad a sumar/restar. ajuste: nuevo stock total. */
  cantidad: number
  stock_actual: number
  precio_costo: number
}

export interface NuevoAjustePayload {
  usuario_id: string
  razon: string
  razon_detalle: string | null
  items: ItemAjustePayload[]
}

/** Calcula el stock final, la diferencia absoluta y el subtotal valorizado. */
export function calcularAjuste(it: {
  tipo: TipoAjuste
  cantidad: number
  stock_actual: number
  precio_costo: number
}) {
  let stockFinal: number
  if (it.tipo === 'entrada') stockFinal = it.stock_actual + it.cantidad
  else if (it.tipo === 'salida') stockFinal = it.stock_actual - it.cantidad
  else stockFinal = it.cantidad // 'ajuste' = nuevo stock total
  const diferencia = Math.abs(stockFinal - it.stock_actual)
  const subtotal = diferencia * (it.precio_costo || 0)
  return { stockFinal, diferencia, subtotal }
}

/**
 * Registra un ajuste de stock con varios productos:
 *  1. Inserta la cabecera `ajustes_stock`.
 *  2. Por cada item: actualiza `productos.stock_actual`, registra el
 *     `movimientos_stock` y guarda el `items_ajuste_stock`.
 *
 * Valida que ningún ajuste deje stock negativo ANTES de aplicar nada.
 */
/**
 * Registra un ajuste de stock multi-producto, de forma atómica
 * (`fn_crear_ajuste_stock`): cabecera, stock de cada producto, movimientos
 * e items del ajuste — todo en una transacción. Si un ajuste dejaría stock
 * negativo, falla entero y no aplica nada.
 */
export async function crearAjusteStock(
  payload: NuevoAjustePayload
): Promise<AjusteStockRow> {
  const supabase = createClient()
  if (payload.items.length === 0) {
    throw new Error('Agregá al menos un producto al ajuste.')
  }

  const { data, error } = await supabase.rpc('fn_crear_ajuste_stock', {
    p_usuario_id: payload.usuario_id,
    p_razon: payload.razon,
    p_razon_detalle: payload.razon_detalle,
    p_items: payload.items.map((it) => ({
      producto_id: it.producto_id,
      tipo: it.tipo,
      cantidad: it.cantidad,
    })) as unknown as Json,
  })
  if (error) throw error
  if (!data) throw new Error('No se pudo registrar el ajuste.')
  return data as AjusteStockRow
}

export interface AjusteListado extends AjusteStockRow {
  usuario_nombre: string | null
}

export async function getAjustesStock(): Promise<AjusteListado[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('ajustes_stock')
    .select('*, usuarios(nombre)')
    .order('fecha', { ascending: false })
    .limit(100)
  if (error) throw error

  type Fila = AjusteStockRow & { usuarios: { nombre: string } | null }
  return ((data ?? []) as unknown as Fila[]).map(
    ({ usuarios, ...resto }) => ({
      ...resto,
      usuario_nombre: usuarios?.nombre ?? null,
    })
  )
}

export interface ItemAjusteDetalle extends ItemAjusteStockRow {
  producto_nombre: string | null
  producto_codigo: string | null
}

export async function getAjusteDetalle(
  ajusteId: number
): Promise<ItemAjusteDetalle[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('items_ajuste_stock')
    .select('*, productos(nombre, codigo_barras)')
    .eq('ajuste_id', ajusteId)
    .order('id', { ascending: true })
  if (error) throw error

  type Fila = ItemAjusteStockRow & {
    productos: { nombre: string; codigo_barras: string | null } | null
  }
  return ((data ?? []) as unknown as Fila[]).map(
    ({ productos, ...resto }) => ({
      ...resto,
      producto_nombre: productos?.nombre ?? null,
      producto_codigo: productos?.codigo_barras ?? null,
    })
  )
}
