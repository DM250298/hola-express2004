import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
import type {
  MovimientoStockRow,
  ProductoRow,
  TipoMovimiento,
} from '@/types/database'

export type EstadoStock = 'normal' | 'bajo' | 'critico'

export interface ProductoConStock {
  id: number
  nombre: string
  codigo_barras: string | null
  categoria_id: number | null
  proveedor_id: number | null
  precio_venta: number
  stock_actual: number
  stock_minimo: number
  activo: boolean
  categoria_nombre: string | null
  proveedor_nombre: string | null
  estado_stock: EstadoStock
}

export interface FiltrosInventario {
  busqueda?: string
  categoria_id?: number | null
  proveedor_id?: number | null
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
    categoria_id: number | null
    proveedor_id: number | null
    precio_venta: number
    stock_actual: number
    stock_minimo: number
    activo: boolean
    categorias: { nombre: string } | null
    proveedores: { nombre: string } | null
  }

  // Paginamos para soportar catálogos > 1000 productos
  const data = await traerTodo<FilaCruda>(() => {
    let q = supabase
      .from('productos')
      .select(
        'id, nombre, codigo_barras, categoria_id, proveedor_id, precio_venta, stock_actual, stock_minimo, activo, categorias(nombre), proveedores(nombre)'
      )
    if (filtros.solo_activos !== false) q = q.eq('activo', true)
    if (patron) q = q.or(`nombre.ilike.${patron},codigo_barras.ilike.${patron}`)
    if (filtros.categoria_id != null) q = q.eq('categoria_id', filtros.categoria_id)
    if (filtros.proveedor_id != null) q = q.eq('proveedor_id', filtros.proveedor_id)
    return q
  })

  const productos: ProductoConStock[] = data.map(
    (p) => ({
      id: p.id,
      nombre: p.nombre,
      codigo_barras: p.codigo_barras,
      categoria_id: p.categoria_id,
      proveedor_id: p.proveedor_id,
      precio_venta: p.precio_venta,
      stock_actual: p.stock_actual,
      stock_minimo: p.stock_minimo,
      activo: p.activo,
      categoria_nombre: p.categorias?.nombre ?? null,
      proveedor_nombre: p.proveedores?.nombre ?? null,
      estado_stock: calcularEstadoStock(p.stock_actual, p.stock_minimo),
    })
  )

  // Filtro por estado se hace en memoria (depende del cálculo)
  let filtrados = productos
  if (filtros.estado_stock) {
    filtrados = productos.filter((p) => p.estado_stock === filtros.estado_stock)
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
 * Aplica un ajuste manual de stock y registra el movimiento.
 *
 * Para tipo:
 * - 'entrada': stock_nuevo = stock_actual + cantidad
 * - 'salida': stock_nuevo = stock_actual - cantidad (rechaza si dejaría negativo)
 * - 'ajuste': cantidad ES el nuevo stock total; se registra la diferencia absoluta
 *
 * Nota técnica: idealmente debería ser una stored procedure transaccional.
 * Si falla el INSERT de movimientos_stock después del UPDATE de stock_actual,
 * el stock queda actualizado sin registro de auditoría — el admin puede
 * corregir manualmente.
 */
export async function ajustarStock(
  payload: AjusteStockPayload
): Promise<{ stock_anterior: number; stock_nuevo: number }> {
  const supabase = createClient()

  // 1. Obtener stock actual
  const { data: producto, error: errProducto } = await supabase
    .from('productos')
    .select('stock_actual')
    .eq('id', payload.producto_id)
    .single<{ stock_actual: number }>()

  if (errProducto) throw errProducto

  const stockAnterior = producto.stock_actual
  let stockNuevo: number
  let cantidadMovimiento: number

  switch (payload.tipo) {
    case 'entrada':
      stockNuevo = stockAnterior + payload.cantidad
      cantidadMovimiento = payload.cantidad
      break
    case 'salida':
      if (payload.cantidad > stockAnterior) {
        throw new Error(
          `No hay stock suficiente: querés sacar ${payload.cantidad} pero hay ${stockAnterior}.`
        )
      }
      stockNuevo = stockAnterior - payload.cantidad
      cantidadMovimiento = payload.cantidad
      break
    case 'ajuste':
      if (payload.cantidad < 0) {
        throw new Error('El nuevo stock no puede ser negativo.')
      }
      stockNuevo = payload.cantidad
      cantidadMovimiento = Math.abs(stockNuevo - stockAnterior)
      if (cantidadMovimiento === 0) {
        throw new Error('El nuevo stock es igual al actual: no hay nada que ajustar.')
      }
      break
  }

  // 2. UPDATE productos
  const ahora = new Date().toISOString()
  const { error: errUpdate } = await supabase
    .from('productos')
    .update({ stock_actual: stockNuevo, updated_at: ahora })
    .eq('id', payload.producto_id)

  if (errUpdate) throw errUpdate

  // 3. INSERT movimientos_stock
  const { error: errMov } = await supabase.from('movimientos_stock').insert({
    producto_id: payload.producto_id,
    tipo: payload.tipo,
    cantidad: cantidadMovimiento,
    stock_anterior: stockAnterior,
    stock_nuevo: stockNuevo,
    usuario_id: payload.usuario_id,
    nota: payload.nota,
  })

  if (errMov) {
    throw new Error(
      `Stock actualizado pero falló registrar el movimiento: ${errMov.message}`
    )
  }

  return { stock_anterior: stockAnterior, stock_nuevo: stockNuevo }
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
    .select('*, categorias(nombre), proveedores(nombre)')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  type FilaCruda = ProductoRow & {
    categorias: { nombre: string } | null
    proveedores: { nombre: string } | null
  }
  const fila = data as unknown as FilaCruda
  return {
    ...fila,
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
