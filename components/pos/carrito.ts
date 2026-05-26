// Reducer y tipos del carrito del POS. Se mantiene en estado local del orquestador
// (PantallaPOS) — no necesita persistencia entre páginas porque una sesión de
// venta se completa de inmediato.

export interface ItemCarrito {
  producto_id: number
  nombre: string
  codigo_barras: string | null
  precio_unitario: number
  /** Para productos por unidad: cantidad entera. Para productos por peso: kg (ej: 0.350). */
  cantidad: number
  stock_disponible: number
  /** true = se vende por kg. precio_unitario = precio por 1 kg. */
  venta_por_peso: boolean
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
        venta_por_peso: boolean
        /** Para productos por peso, la cantidad en kg a agregar. */
        cantidad_kg?: number
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
      if (producto.stock_actual <= 0) return estado

      const existente = estado.find((it) => it.producto_id === producto.producto_id)

      if (producto.venta_por_peso) {
        // Por peso: siempre REEMPLAZA la cantidad (re-pesar)
        const kg = producto.cantidad_kg ?? 0
        if (kg <= 0) return estado
        if (existente) {
          return estado.map((it) =>
            it.producto_id === producto.producto_id
              ? { ...it, cantidad: kg }
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
            cantidad: kg,
            stock_disponible: producto.stock_actual,
            venta_por_peso: true,
          },
        ]
      }

      // Por unidad: incrementa
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
          venta_por_peso: false,
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
              cantidad: it.venta_por_peso
                ? accion.cantidad
                : Math.min(accion.cantidad, it.stock_disponible),
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
  return items.reduce((acc, it) => acc + (it.venta_por_peso ? 1 : it.cantidad), 0)
}

/** Formatea la cantidad de un ítem del carrito para mostrar en UI. */
export function formatearCantidadItem(item: ItemCarrito): string {
  if (!item.venta_por_peso) return String(item.cantidad)
  const gramos = Math.round(item.cantidad * 1000)
  if (gramos >= 1000) {
    return `${(item.cantidad).toFixed(3).replace('.', ',')} kg`
  }
  return `${gramos} g`
}
