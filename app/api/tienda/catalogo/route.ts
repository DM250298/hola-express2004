import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

/**
 * GET /api/tienda/catalogo
 * Devuelve productos activos, visibles en tienda y con stock > 0.
 * Es público (no requiere auth) — la tienda es para clientes. Usa el cliente
 * service-role: la lectura ya está acotada por los filtros y no expone costo.
 */
export async function GET() {
  try {
    const supabase = createAdminClient()

    // Productos activos con stock. Se excluyen los "pendientes de precio"
    // (alta al vuelo sin precio): no deben ofrecerse hasta tener precio cargado.
    const { data: productos, error: errProd } = await supabase
      .from('productos')
      .select('id, nombre, codigo_barras, precio_venta, stock_actual, categoria_id, imagen_url, categorias(id, nombre)')
      .eq('activo', true)
      .eq('visible_tienda', true)
      .eq('pendiente_precio', false)
      .gt('stock_actual', 0)
      .order('nombre')

    if (errProd) {
      return NextResponse.json({ error: errProd.message }, { status: 500 })
    }

    // Categorías
    const { data: categorias, error: errCat } = await supabase
      .from('categorias')
      .select('id, nombre')
      .order('nombre')

    if (errCat) {
      return NextResponse.json({ error: errCat.message }, { status: 500 })
    }

    return NextResponse.json({
      productos: productos ?? [],
      categorias: categorias ?? [],
    })
  } catch (e) {
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
