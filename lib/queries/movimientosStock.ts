import { createClient } from '@/lib/supabase/client'
import type { MovimientoStockRow, TipoMovimiento } from '@/types/database'

// ─── Tipos ──────────────────────────────────────────────────────────────────

export type Turno = 'mañana' | 'tarde' | 'noche'

export interface MovimientoCompleto extends MovimientoStockRow {
  producto_nombre: string
  producto_codigo_barras: string | null
  categoria_nombre: string | null
  usuario_nombre: string | null
  turno: Turno
  origen_label: string
}

export interface FiltrosMovimientos {
  busqueda?: string
  tipos?: TipoMovimiento[]
  turno?: Turno | null
  usuario_id?: string | null
  categoria_id?: number | null
  fecha_desde?: string | null
  fecha_hasta?: string | null
}

export interface MovimientosPaginados {
  movimientos: MovimientoCompleto[]
  total: number
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Infiere el turno del día basado en la hora.
 * Mañana: 06:00–13:59 / Tarde: 14:00–21:59 / Noche: 22:00–05:59
 */
export function inferirTurno(fechaISO: string): Turno {
  const hora = new Date(fechaISO).getHours()
  if (hora >= 6 && hora < 14) return 'mañana'
  if (hora >= 14 && hora < 22) return 'tarde'
  return 'noche'
}

/**
 * Genera una etiqueta legible del origen del movimiento
 * a partir de la nota almacenada en la BD.
 */
function etiquetaOrigen(nota: string | null, tipo: TipoMovimiento): string {
  if (!nota) {
    switch (tipo) {
      case 'venta':
        return 'Venta'
      case 'entrada':
        return 'Entrada'
      case 'salida':
        return 'Salida'
      case 'ajuste':
        return 'Ajuste'
      case 'merma':
        return 'Merma'
      default:
        return tipo
    }
  }
  return nota
}

// ─── Query principal ────────────────────────────────────────────────────────

export async function getMovimientosStock(
  filtros: FiltrosMovimientos = {},
  pagina = 0,
  porPagina = 50
): Promise<MovimientosPaginados> {
  const supabase = createClient()
  const desde = pagina * porPagina
  const hasta = desde + porPagina - 1

  let query = supabase
    .from('movimientos_stock')
    .select(
      '*, productos(nombre, codigo_barras, categoria_id, categorias(nombre)), usuarios(nombre)',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })

  // Filtro por tipos de movimiento
  if (filtros.tipos && filtros.tipos.length > 0) {
    query = query.in('tipo', filtros.tipos)
  }

  // Filtro por usuario
  if (filtros.usuario_id) {
    query = query.eq('usuario_id', filtros.usuario_id)
  }

  // Filtro por rango de fechas
  if (filtros.fecha_desde) {
    query = query.gte('created_at', filtros.fecha_desde)
  }
  if (filtros.fecha_hasta) {
    // Sumar 1 día para incluir el día completo
    const hasta = new Date(filtros.fecha_hasta)
    hasta.setDate(hasta.getDate() + 1)
    query = query.lt('created_at', hasta.toISOString())
  }

  // Paginación
  query = query.range(desde, hasta)

  const { data, error, count } = await query

  if (error) throw new Error(error.message)

  type FilaCruda = MovimientoStockRow & {
    productos: {
      nombre: string
      codigo_barras: string | null
      categoria_id: number | null
      categorias: { nombre: string } | null
    } | null
    usuarios: { nombre: string } | null
  }

  const filas = (data ?? []) as unknown as FilaCruda[]

  // Filtros en memoria (búsqueda y categoría — no se pueden hacer en la query directamente)
  let movimientos: MovimientoCompleto[] = filas.map((f) => ({
    ...f,
    producto_nombre: f.productos?.nombre ?? 'Producto eliminado',
    producto_codigo_barras: f.productos?.codigo_barras ?? null,
    categoria_nombre: f.productos?.categorias?.nombre ?? null,
    usuario_nombre: f.usuarios?.nombre ?? null,
    turno: inferirTurno(f.created_at),
    origen_label: etiquetaOrigen(f.nota, f.tipo),
    // Limpiar las relaciones del spread
    productos: undefined as never,
    usuarios: undefined as never,
  }))

  // Filtro por búsqueda de producto
  if (filtros.busqueda?.trim()) {
    const q = filtros.busqueda.trim().toLowerCase()
    movimientos = movimientos.filter(
      (m) =>
        m.producto_nombre.toLowerCase().includes(q) ||
        (m.producto_codigo_barras &&
          m.producto_codigo_barras.toLowerCase().includes(q))
    )
  }

  // Filtro por categoría
  if (filtros.categoria_id != null) {
    // Necesitamos el categoria_id original
    const catId = filtros.categoria_id
    const filasConCat = filas.filter(
      (f) => f.productos?.categoria_id === catId
    )
    const idsProducto = new Set(filasConCat.map((f) => f.producto_id))
    movimientos = movimientos.filter((m) =>
      idsProducto.has(m.producto_id)
    )
  }

  // Filtro por turno
  if (filtros.turno) {
    movimientos = movimientos.filter((m) => m.turno === filtros.turno)
  }

  return {
    movimientos,
    total: count ?? 0,
  }
}

// ─── Usuarios que tienen movimientos (para filtro) ──────────────────────────

export interface UsuarioMovimiento {
  id: string
  nombre: string
}

export async function getUsuariosConMovimientos(): Promise<
  UsuarioMovimiento[]
> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('usuarios')
    .select('id, nombre')
    .eq('activo', true)
    .order('nombre')

  if (error) throw new Error(error.message)
  return (data ?? []) as UsuarioMovimiento[]
}
