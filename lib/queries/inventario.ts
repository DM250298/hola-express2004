import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
import { costoDesdeEmbed, type CostoEmbed } from '@/lib/queries/productos'
import type {
  CoberturaStockRow,
  Json,
  MovimientoStockRow,
  ProductoRow,
  TipoMovimiento,
} from '@/types/database'

export type EstadoStock = 'normal' | 'bajo' | 'critico'

export interface ProductoConStock {
  id: number
  nombre: string
  codigo_barras: string | null
  marca: string | null
  ubicacion: string | null
  categoria_id: number | null
  proveedor_id: number | null
  precio_venta: number
  stock_actual: number
  stock_minimo: number
  activo: boolean
  categoria_nombre: string | null
  proveedor_nombre: string | null
  estado_stock: EstadoStock
  /** Días de cobertura = stock_actual / promedio_diario. NULL si no hubo ventas. */
  dias_cobertura: number | null
  /** Promedio diario de unidades vendidas (últimos 14 días). */
  promedio_diario: number
  /** Serie de ventas por día (14 valores, antiguo → reciente). */
  serie_14d: number[]
}

export interface FiltrosInventario {
  busqueda?: string
  categoria_id?: number | null
  proveedor_id?: number | null
  ubicacion?: string | null
  estado_stock?: EstadoStock | null
  orden?: 'nombre' | 'stock_asc' | 'stock_desc' | 'categoria'
  solo_activos?: boolean
}

export function calcularEstadoStock(
  stock_actual: number,
  stock_minimo: number
): EstadoStock {
  if (stock_actual <= 0) return 'critico'
  if (stock_actual < stock_minimo) return 'bajo'
  return 'normal'
}

/**
 * Trae las métricas de cobertura para todos los productos activos.
 * Devuelve un Map indexado por producto_id para mergear con la lista de stock.
 */
export async function getCoberturaStock(): Promise<Map<number, CoberturaStockRow>> {
  const supabase = createClient()
  const filas = await traerTodo<CoberturaStockRow>(() =>
    supabase
      .from('vista_cobertura_stock')
      .select('producto_id, stock_actual, ventas_14d, promedio_diario, dias_cobertura, serie_14d')
  )
  const mapa = new Map<number, CoberturaStockRow>()
  for (const f of filas) mapa.set(f.producto_id, f)
  return mapa
}

/** Cobertura de un solo producto. NULL si el producto no es activo o no existe. */
export async function getCoberturaProducto(
  producto_id: number
): Promise<CoberturaStockRow | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('vista_cobertura_stock')
    .select('producto_id, stock_actual, ventas_14d, promedio_diario, dias_cobertura, serie_14d')
    .eq('producto_id', producto_id)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}

const COBERTURA_VACIA: Pick<
  ProductoConStock,
  'dias_cobertura' | 'promedio_diario' | 'serie_14d'
> = {
  dias_cobertura: null,
  promedio_diario: 0,
  serie_14d: Array(14).fill(0),
}

export async function getProductosConStock(
  filtros: FiltrosInventario = {}
): Promise<ProductoConStock[]> {
  const supabase = createClient()
  const busqueda = filtros.busqueda?.trim()
  const patron = busqueda
    ? `%${busqueda.replace(/[%_]/g, '\\$&')}%`
    : null

  type FilaCruda = {
    id: number
    nombre: string
    codigo_barras: string | null
    marca: string | null
    ubicacion: string | null
    categoria_id: number | null
    proveedor_id: number | null
    precio_venta: number
    stock_actual: number
    stock_minimo: number
    activo: boolean
    categorias: { nombre: string } | null
    proveedores: { nombre: string } | null
  }

  // Paginamos productos y traemos cobertura en paralelo
  const [data, cobertura] = await Promise.all([
    traerTodo<FilaCruda>(() => {
      let q = supabase
        .from('productos')
        .select(
          'id, nombre, codigo_barras, marca, ubicacion, categoria_id, proveedor_id, precio_venta, stock_actual, stock_minimo, activo, categorias(nombre), proveedores(nombre)'
        )
      if (filtros.solo_activos !== false) q = q.eq('activo', true)
      if (patron) q = q.or(`nombre.ilike.${patron},codigo_barras.ilike.${patron}`)
      if (filtros.categoria_id != null) q = q.eq('categoria_id', filtros.categoria_id)
      if (filtros.proveedor_id != null) q = q.eq('proveedor_id', filtros.proveedor_id)
      return q
    }),
    getCoberturaStock(),
  ])

  const productos: ProductoConStock[] = data.map((p) => {
    const cob = cobertura.get(p.id)
    return {
      id: p.id,
      nombre: p.nombre,
      codigo_barras: p.codigo_barras,
      marca: p.marca,
      ubicacion: p.ubicacion,
      categoria_id: p.categoria_id,
      proveedor_id: p.proveedor_id,
      precio_venta: p.precio_venta,
      stock_actual: p.stock_actual,
      stock_minimo: p.stock_minimo,
      activo: p.activo,
      categoria_nombre: p.categorias?.nombre ?? null,
      proveedor_nombre: p.proveedores?.nombre ?? null,
      estado_stock: calcularEstadoStock(p.stock_actual, p.stock_minimo),
      dias_cobertura: cob?.dias_cobertura ?? COBERTURA_VACIA.dias_cobertura,
      promedio_diario: cob?.promedio_diario ?? COBERTURA_VACIA.promedio_diario,
      serie_14d: cob?.serie_14d ?? COBERTURA_VACIA.serie_14d,
    }
  })

  // Filtro por estado se hace en memoria (depende del cálculo)
  let filtrados = productos
  if (filtros.estado_stock) {
    filtrados = productos.filter((p) => p.estado_stock === filtros.estado_stock)
  }
  if (filtros.ubicacion) {
    filtrados = filtrados.filter((p) => p.ubicacion === filtros.ubicacion)
  }

  // Ordenamiento en memoria
  const orden = filtros.orden ?? 'nombre'
  filtrados = [...filtrados].sort((a, b) => {
    switch (orden) {
      case 'stock_asc':
        return a.stock_actual - b.stock_actual
      case 'stock_desc':
        return b.stock_actual - a.stock_actual
      case 'categoria':
        return (a.categoria_nombre ?? '').localeCompare(
          b.categoria_nombre ?? '',
          'es-AR'
        )
      case 'nombre':
      default:
        return a.nombre.localeCompare(b.nombre, 'es-AR')
    }
  })

  return filtrados
}

/** Ubicaciones distintas presentes en el catálogo activo (para el filtro). */
export async function getUbicaciones(): Promise<string[]> {
  const supabase = createClient()
  const filas = await traerTodo<{ ubicacion: string | null }>(() =>
    supabase.from('productos').select('ubicacion').eq('activo', true)
  )
  const set = new Set<string>()
  for (const f of filas) {
    const u = f.ubicacion?.trim()
    if (u) set.add(u)
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'es-AR'))
}

export interface ResumenAlertasStock {
  total_productos: number
  bajo_stock: number
  agotados: number
}

export async function getResumenAlertasStock(): Promise<ResumenAlertasStock> {
  const supabase = createClient()
  type Fila = { stock_actual: number; stock_minimo: number }

  // Paginamos para que el conteo sea exacto en catálogos > 1000 productos
  const lista = await traerTodo<Fila>(() =>
    supabase
      .from('productos')
      .select('stock_actual, stock_minimo')
      .eq('activo', true)
  )

  const bajo_stock = lista.filter(
    (p) => p.stock_actual < p.stock_minimo
  ).length
  const agotados = lista.filter((p) => p.stock_actual <= 0).length

  return {
    total_productos: lista.length,
    bajo_stock,
    agotados,
  }
}

export interface AjusteStockPayload {
  producto_id: number
  tipo: Extract<TipoMovimiento, 'entrada' | 'salida' | 'ajuste'>
  cantidad: number
  nota: string
  usuario_id: string
}

/**
 * Aplica un ajuste manual de stock de UN producto, de forma atómica vía el
 * RPC `fn_crear_ajuste_stock` (cabecera + stock + movimiento + item del
 * ajuste, todo en una transacción). Es el mismo camino que usa la tab de
 * Ajustes multi-producto, así que no hay dos lógicas divergentes.
 *
 * Para tipo:
 * - 'entrada': suma la cantidad al stock
 * - 'salida': resta la cantidad (el RPC rechaza si dejaría stock negativo)
 * - 'ajuste': la cantidad ES el nuevo stock total
 *
 * Reemplaza el lee-modifica-escribe anterior, que tenía una race condition con
 * el POS vendiendo en paralelo y podía dejar el stock cambiado sin movimiento.
 * La nota libre del modal se guarda como detalle de la razón del ajuste.
 */
export async function ajustarStock(payload: AjusteStockPayload): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_crear_ajuste_stock', {
    p_usuario_id: payload.usuario_id,
    p_razon: 'otra',
    p_razon_detalle: payload.nota,
    p_items: [
      {
        producto_id: payload.producto_id,
        tipo: payload.tipo,
        cantidad: payload.cantidad,
      },
    ] as unknown as Json,
  })
  if (error) throw error
}

export interface MovimientoConUsuario extends MovimientoStockRow {
  usuario_nombre: string | null
}

export interface HistorialPaginado {
  movimientos: MovimientoConUsuario[]
  total: number
}

export async function getHistorialMovimientos(
  producto_id: number,
  pagina = 0,
  porPagina = 20
): Promise<HistorialPaginado> {
  const supabase = createClient()
  const desde = pagina * porPagina
  const hasta = desde + porPagina - 1

  const { data, error, count } = await supabase
    .from('movimientos_stock')
    .select('*, usuarios(nombre)', { count: 'exact' })
    .eq('producto_id', producto_id)
    .order('created_at', { ascending: false })
    .range(desde, hasta)

  if (error) throw error

  type FilaCruda = MovimientoStockRow & {
    usuarios: { nombre: string } | null
  }

  const movimientos: MovimientoConUsuario[] = ((data ?? []) as unknown as FilaCruda[]).map(
    ({ usuarios, ...resto }) => ({
      ...resto,
      usuario_nombre: usuarios?.nombre ?? null,
    })
  )

  return {
    movimientos,
    total: count ?? 0,
  }
}

export async function getProductoDetalle(
  id: number
): Promise<(ProductoRow & {
  categoria_nombre: string | null
  proveedor_nombre: string | null
}) | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('productos')
    .select(
      '*, categorias(nombre), proveedores(nombre), costos_producto(precio_costo)'
    )
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  type FilaCruda = ProductoRow & {
    categorias: { nombre: string } | null
    proveedores: { nombre: string } | null
    costos_producto: CostoEmbed
  }
  const fila = data as unknown as FilaCruda
  return {
    ...fila,
    // El costo vive en costos_producto (gateado por RLS). Para un cajero el
    // embed viene null → 0 (no ve el costo).
    precio_costo: costoDesdeEmbed(fila.costos_producto),
    categoria_nombre: fila.categorias?.nombre ?? null,
    proveedor_nombre: fila.proveedores?.nombre ?? null,
  }
}

export interface PuntoEvolucionStock {
  fecha: string // ISO yyyy-MM-dd
  stock: number
}

/**
 * Reconstruye el stock de los últimos N días al cierre de cada día.
 *
 * Algoritmo: partimos del stock actual (de hoy) y retrocedemos restando
 * el cambio neto de cada día. Para los días sin movimientos, el stock
 * se mantiene igual al día siguiente.
 */
export async function getEvolucionStock(
  producto_id: number,
  dias = 30
): Promise<PuntoEvolucionStock[]> {
  const supabase = createClient()

  // Stock actual
  const { data: producto, error: errProd } = await supabase
    .from('productos')
    .select('stock_actual')
    .eq('id', producto_id)
    .single<{ stock_actual: number }>()
  if (errProd) throw errProd

  const desde = new Date()
  desde.setDate(desde.getDate() - dias)
  desde.setHours(0, 0, 0, 0)

  // Movimientos del rango — necesitamos stock_anterior/nuevo y created_at
  const { data: movs, error: errMov } = await supabase
    .from('movimientos_stock')
    .select('cantidad, stock_anterior, stock_nuevo, created_at')
    .eq('producto_id', producto_id)
    .gte('created_at', desde.toISOString())
    .order('created_at', { ascending: true })

  if (errMov) throw errMov

  // Cambio neto agrupado por día (yyyy-MM-dd)
  const cambioPorDia = new Map<string, number>()
  for (const m of movs ?? []) {
    const clave = m.created_at.slice(0, 10)
    const delta = m.stock_nuevo - m.stock_anterior
    cambioPorDia.set(clave, (cambioPorDia.get(clave) ?? 0) + delta)
  }

  // Construir lista de fechas desde 'desde' hasta hoy
  const fechas: string[] = []
  const cursor = new Date(desde)
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  while (cursor <= hoy) {
    fechas.push(cursor.toISOString().slice(0, 10))
    cursor.setDate(cursor.getDate() + 1)
  }

  // Stock al cierre de cada día — retrocedemos desde hoy
  const stockPorFecha = new Map<string, number>()
  let stockAcumulado = producto.stock_actual

  for (let i = fechas.length - 1; i >= 0; i--) {
    const fecha = fechas[i]
    stockPorFecha.set(fecha, stockAcumulado)
    // El stock al cierre del día anterior es el actual MENOS los cambios de hoy
    const cambio = cambioPorDia.get(fecha) ?? 0
    stockAcumulado -= cambio
  }

  return fechas.map((fecha) => ({
    fecha,
    stock: stockPorFecha.get(fecha) ?? producto.stock_actual,
  }))
}
