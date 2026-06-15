import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, type NextRequest } from 'next/server'

interface ItemPedido {
  producto_id: number
  nombre: string
  precio_unitario: number
  cantidad: number
}

interface BodyPedido {
  cliente_nombre: string
  cliente_telefono: string
  cliente_email?: string
  cliente_direccion?: string
  cliente_notas?: string
  metodo_entrega: 'retiro' | 'delivery'
  items: ItemPedido[]
}

/**
 * POST /api/tienda/pedido
 * Crea un pedido desde la tienda online.
 * No requiere auth — los clientes no tienen cuenta.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as BodyPedido

    // Validaciones básicas
    if (!body.cliente_nombre?.trim()) {
      return NextResponse.json(
        { error: 'El nombre es obligatorio.' },
        { status: 400 }
      )
    }
    if (!body.cliente_telefono?.trim()) {
      return NextResponse.json(
        { error: 'El teléfono es obligatorio.' },
        { status: 400 }
      )
    }
    if (!body.items || body.items.length === 0) {
      return NextResponse.json(
        { error: 'El pedido debe tener al menos un producto.' },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Validar stock de cada producto
    const productoIds = body.items.map((i) => i.producto_id)
    const { data: productos, error: errProd } = await supabase
      .from('productos')
      .select('id, nombre, precio_venta, stock_actual, pendiente_precio')
      .in('id', productoIds)
      .eq('activo', true)

    if (errProd) {
      return NextResponse.json({ error: errProd.message }, { status: 500 })
    }

    const mapaProd = new Map(
      (productos ?? []).map((p) => [p.id, p])
    )

    // Verificar cada item
    for (const item of body.items) {
      const prod = mapaProd.get(item.producto_id)
      if (!prod || prod.pendiente_precio) {
        return NextResponse.json(
          { error: `El producto "${item.nombre}" ya no está disponible.` },
          { status: 400 }
        )
      }
      if (prod.stock_actual < item.cantidad) {
        return NextResponse.json(
          {
            error: `No hay suficiente stock de "${prod.nombre}". Disponible: ${prod.stock_actual}`,
          },
          { status: 400 }
        )
      }
    }

    // Calcular totales con precios del servidor (no confiar en el cliente)
    const itemsValidados = body.items.map((item) => {
      const prod = mapaProd.get(item.producto_id)!
      const subtotal = prod.precio_venta * item.cantidad
      return {
        producto_id: item.producto_id,
        nombre: prod.nombre,
        precio_unitario: prod.precio_venta,
        cantidad: item.cantidad,
        subtotal,
      }
    })

    const total = itemsValidados.reduce((s, i) => s + i.subtotal, 0)
    const cantidadItems = itemsValidados.reduce((s, i) => s + i.cantidad, 0)

    // Generar código único del pedido basado en timestamp + random
    const ahora = Date.now()
    const rand = Math.floor(Math.random() * 1000)
    const codigo = `HE-${String(ahora).slice(-6)}${String(rand).padStart(3, '0')}`

    // Crear pedido
    const { data: pedido, error: errPedido } = await supabase
      .from('pedidos_tienda')
      .insert({
        codigo,
        estado: 'pendiente',
        metodo_entrega: body.metodo_entrega ?? 'retiro',
        cliente_nombre: body.cliente_nombre.trim(),
        cliente_telefono: body.cliente_telefono.trim(),
        cliente_email: body.cliente_email?.trim() || null,
        cliente_direccion: body.cliente_direccion?.trim() || null,
        cliente_notas: body.cliente_notas?.trim() || null,
        total,
        cantidad_items: cantidadItems,
      })
      .select()
      .single()

    if (errPedido) {
      return NextResponse.json({ error: errPedido.message }, { status: 500 })
    }

    // Crear items del pedido
    const itemsInsert = itemsValidados.map((item) => ({
      pedido_id: pedido.id,
      producto_id: item.producto_id,
      nombre: item.nombre,
      precio_unitario: item.precio_unitario,
      cantidad: item.cantidad,
      subtotal: item.subtotal,
    }))

    const { error: errItems } = await supabase
      .from('items_pedido_tienda')
      .insert(itemsInsert)

    if (errItems) {
      return NextResponse.json({ error: errItems.message }, { status: 500 })
    }

    return NextResponse.json({
      pedido: {
        id: pedido.id,
        codigo: pedido.codigo,
        total,
        cantidad_items: cantidadItems,
        metodo_entrega: pedido.metodo_entrega,
      },
    })
  } catch {
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
