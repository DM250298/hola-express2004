import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
import { costoDesdeEmbed, type CostoEmbed } from '@/lib/queries/productos'

// ─── Tipos ──────────────────────────────────────────────────────────────────

export type ClaseABC = 'A' | 'B' | 'C'

export interface ProductoABC {
  producto_id: number
  nombre: string
  codigo_barras: string | null
  categoria_id: number | null
  categoria_nombre: string | null
  precio_venta: number
  precio_costo: number
  stock_actual: number
  unidades_vendidas: number
  ingresos: number
  /** Porcentaje del ingreso total que aporta este producto. */
  porcentaje_ingreso: number
  /** Porcentaje acumulado (orden descendente por ingresos). */
  porcentaje_acumulado: number
  clase: ClaseABC
}

export interface ResumenABC {
  /** Total facturado en el período. */
  total_ingresos: number
  /** Cantidad de productos que tuvieron al menos 1 venta. */
  productos_con_ventas: number
  /** Cantidad total de productos activos (con o sin ventas). */
  productos_totales: number
  /** Desglose por clase. */
  clases: Record<ClaseABC, ClaseDetalle>
  /** Lista completa ordenada por ingresos desc. */
  productos: ProductoABC[]
}

export interface ClaseDetalle {
  cantidad: number
  ingresos: number
  porcentaje_ingreso: number
}

// ─── Umbrales ABC ───────────────────────────────────────────────────────────

/** Productos que suman hasta el 80 % del ingreso → A */
const UMBRAL_A = 0.80
/** Del 80 % al 95 % → B, el resto → C */
const UMBRAL_B = 0.95

function asignarClase(porcentajeAcumulado: number): ClaseABC {
  if (porcentajeAcumulado <= UMBRAL_A) return 'A'
  if (porcentajeAcumulado <= UMBRAL_B) return 'B'
  return 'C'
}

// ─── Query principal ────────────────────────────────────────────────────────

/**
 * Calcula la clasificación ABC basada en los ingresos de ventas en el período.
 * @param dias Cantidad de días hacia atrás desde hoy (30, 60, 90).
 */
export async function calcularClasificacionABC(
  dias: number
): Promise<ResumenABC> {
  const supabase = createClient()

  // Fecha de corte
  const desde = new Date()
  desde.setDate(desde.getDate() - dias)
  const fechaDesde = desde.toISOString()

  // 1. Traer items_venta del período (solo ventas completadas)
  const { data: itemsVenta, error: errorItems } = await supabase
    .from('items_venta')
    .select(`
      producto_id,
      cantidad,
      precio_unitario,
      subtotal,
      venta:ventas!inner(id, fecha, estado)
    `)
    .gte('venta.fecha', fechaDesde)
    .eq('venta.estado', 'completada')

  if (errorItems) throw new Error(errorItems.message)

  // 2. Agrupar por producto_id → sumar ingresos y unidades
  const mapa = new Map<
    number,
    { unidades: number; ingresos: number }
  >()

  for (const item of itemsVenta ?? []) {
    const prev = mapa.get(item.producto_id) ?? {
      unidades: 0,
      ingresos: 0,
    }
    prev.unidades += item.cantidad
    prev.ingresos += item.subtotal ?? item.cantidad * item.precio_unitario
    mapa.set(item.producto_id, prev)
  }

  // 3. Traer todos los productos activos con categoría
  const productosActivos = await traerTodo<{
    id: number
    nombre: string
    codigo_barras: string | null
    categoria_id: number | null
    precio_venta: number
    costos_producto: CostoEmbed
    stock_actual: number
    categorias: { nombre: string } | null
  }>(() =>
    supabase
      .from('productos')
      .select('id, nombre, codigo_barras, categoria_id, precio_venta, stock_actual, categorias(nombre), costos_producto(precio_costo)')
      .eq('activo', true)
      .order('nombre')
  )

  const totalIngresos = Array.from(mapa.values()).reduce(
    (s, v) => s + v.ingresos,
    0
  )

  // 4. Armar lista con porcentajes, ordenada por ingresos desc
  const lista: ProductoABC[] = productosActivos.map((p) => {
    const ventas = mapa.get(p.id) ?? { unidades: 0, ingresos: 0 }
    return {
      producto_id: p.id,
      nombre: p.nombre,
      codigo_barras: p.codigo_barras,
      categoria_id: p.categoria_id,
      categoria_nombre:
        (p.categorias as { nombre: string } | null)?.nombre ?? null,
      precio_venta: p.precio_venta,
      precio_costo: costoDesdeEmbed(p.costos_producto),
      stock_actual: p.stock_actual,
      unidades_vendidas: ventas.unidades,
      ingresos: ventas.ingresos,
      porcentaje_ingreso:
        totalIngresos > 0 ? (ventas.ingresos / totalIngresos) * 100 : 0,
      porcentaje_acumulado: 0, // se calcula abajo
      clase: 'C' as ClaseABC, // provisional
    }
  })

  // Ordenar por ingresos desc (los que no vendieron van al final)
  lista.sort((a, b) => b.ingresos - a.ingresos)

  // 5. Calcular acumulado y asignar clase
  let acumulado = 0
  for (const prod of lista) {
    if (totalIngresos > 0) {
      acumulado += prod.ingresos / totalIngresos
    }
    prod.porcentaje_acumulado = acumulado * 100
    prod.clase = prod.ingresos > 0 ? asignarClase(acumulado) : 'C'
  }

  // 6. Armar resumen por clase
  const clases: Record<ClaseABC, ClaseDetalle> = {
    A: { cantidad: 0, ingresos: 0, porcentaje_ingreso: 0 },
    B: { cantidad: 0, ingresos: 0, porcentaje_ingreso: 0 },
    C: { cantidad: 0, ingresos: 0, porcentaje_ingreso: 0 },
  }

  for (const prod of lista) {
    clases[prod.clase].cantidad += 1
    clases[prod.clase].ingresos += prod.ingresos
  }

  for (const clase of ['A', 'B', 'C'] as ClaseABC[]) {
    clases[clase].porcentaje_ingreso =
      totalIngresos > 0
        ? (clases[clase].ingresos / totalIngresos) * 100
        : 0
  }

  return {
    total_ingresos: totalIngresos,
    productos_con_ventas: mapa.size,
    productos_totales: productosActivos.length,
    clases,
    productos: lista,
  }
}
