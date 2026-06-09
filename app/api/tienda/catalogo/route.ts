import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * GET /api/tienda/catalogo
 * Devuelve productos activos con stock > 0 agrupados por categoría.
 * Es público (no requiere auth) — la tienda es para clientes.
 */
export async function GET() {
  try {
    const supabase = await createServerClient()

    // Productos activos con stock
    const { data: productos, error: errProd } = await supabase
      .from('productos')
      .select('id, nombre, codigo_barras, precio_venta, stock_actual, categoria_id, imagen_url, categorias(id, nombre)')
      .eq('activo', true)
      .eq('visible_tienda', true)
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
