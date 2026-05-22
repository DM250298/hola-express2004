// Reducer y tipos del carrito del POS. Se mantiene en estado local del orquestador
// (PantallaPOS) — no necesita persistencia entre páginas porque una sesión de
// venta se completa de inmediato.

export interface ItemCarrito {
  producto_id: number
  nombre: string
  codigo_barras: string | null
  precio_unitario: number
  cantidad: number
  stock_disponible: number
}

export type AccionCarrito =
  | {
      tipo: 'AGREGAR_PRODUCTO'
      producto: {
        producto_id: number
        nombre: string
        codigo_barras: string | null
        precio_venta: number
        stock_actual: number
      }
    }
  | { tipo: 'CAMBIAR_CANTIDAD'; producto_id: number; cantidad: number }
  | { tipo: 'ELIMINAR'; producto_id: number }
  | { tipo: 'VACIAR' }

export function reducerCarrito(
  estado: ItemCarrito[],
  accion: AccionCarrito
): ItemCarrito[] {
  switch (accion.tipo) {
    case 'AGREGAR_PRODUCTO': {
      const { producto } = accion
      if (producto.stock_actual <= 0) return estado // sin stock, ignorar
      const existente = estado.find((it) => it.producto_id === producto.producto_id)
      if (existente) {
        if (existente.cantidad >= producto.stock_actual) return estado
        return estado.map((it) =>
          it.producto_id === producto.producto_id
            ? { ...it, cantidad: it.cantidad + 1 }
            : it
        )
      }
      return [
        ...estado,
        {
          producto_id: producto.producto_id,
          nombre: producto.nombre,
          codigo_barras: producto.codigo_barras,
          precio_unitario: producto.precio_venta,
          cantidad: 1,
          stock_disponible: producto.stock_actual,
        },
      ]
    }
    case 'CAMBIAR_CANTIDAD': {
      if (accion.cantidad <= 0) {
        return estado.filter((it) => it.producto_id !== accion.producto_id)
      }
      return estado.map((it) =>
        it.producto_id === accion.producto_id
          ? {
              ...it,
              cantidad: Math.min(accion.cantidad, it.stock_disponible),
            }
          : it
      )
    }
    case 'ELIMINAR':
      return estado.filter((it) => it.producto_id !== accion.producto_id)
    case 'VACIAR':
      return []
  }
}

export function calcularTotal(items: ItemCarrito[]): number {
  return items.reduce((acc, it) => acc + it.precio_unitario * it.cantidad, 0)
}

export function contarUnidades(items: ItemCarrito[]): number {
  return items.reduce((acc, it) => acc + it.cantidad, 0)
}
