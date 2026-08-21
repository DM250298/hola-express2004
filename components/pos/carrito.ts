// Reducer y tipos del carrito del POS. Se mantiene en estado local del orquestador
// (PantallaPOS) — no necesita persistencia entre páginas porque una sesión de
// venta se completa de inmediato.

import type { ListaPrecio } from '@/types/database'

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
  /** Ambos precios viajan con el ítem para repricear al cambiar de lista sin
   *  re-consultar el catálogo (funciona offline). Mig 153. */
  precio_minorista: number
  precio_mayorista: number | null
  /** Lista realmente aplicada: 'minorista' también en venta mayorista si el
   *  producto no tiene precio mayorista definido (fallback). */
  lista_aplicada: ListaPrecio
}

export type AccionCarrito =
  | {
      tipo: 'AGREGAR_PRODUCTO'
      producto: {
        producto_id: number
        nombre: string
        codigo_barras: string | null
        precio_venta: number
        precio_mayorista: number | null
        stock_actual: number
        venta_por_peso: boolean
        /** Para productos por peso, la cantidad en kg a agregar. */
        cantidad_kg?: number
      }
      /** Lista activa de la orden: decide con qué precio entra el ítem. */
      lista: ListaPrecio
      /** Si es true, se permite agregar/superar aunque no haya stock (venta en negativo). */
      permitir_sin_stock?: boolean
    }
  | {
      tipo: 'CAMBIAR_CANTIDAD'
      producto_id: number
      cantidad: number
      /** Si es true, no se clampea la cantidad al stock disponible. */
      permitir_sin_stock?: boolean
    }
  | { tipo: 'ELIMINAR'; producto_id: number }
  | { tipo: 'VACIAR' }
  | { tipo: 'CAMBIAR_LISTA'; lista: ListaPrecio }

/**
 * Precio y lista aplicada según la lista pedida. Mayorista sin precio
 * definido (null o 0) cae a minorista — y el ítem queda marcado así.
 */
function resolverPrecio(
  lista: ListaPrecio,
  precioMinorista: number,
  precioMayorista: number | null
): { precio: number; lista_aplicada: ListaPrecio } {
  if (lista === 'mayorista' && (precioMayorista ?? 0) > 0) {
    return { precio: precioMayorista as number, lista_aplicada: 'mayorista' }
  }
  return { precio: precioMinorista, lista_aplicada: 'minorista' }
}

export function reducerCarrito(
  estado: ItemCarrito[],
  accion: AccionCarrito
): ItemCarrito[] {
  switch (accion.tipo) {
    case 'AGREGAR_PRODUCTO': {
      const { producto, lista, permitir_sin_stock } = accion
      if (!permitir_sin_stock && producto.stock_actual <= 0) return estado

      const existente = estado.find((it) => it.producto_id === producto.producto_id)
      const { precio, lista_aplicada } = resolverPrecio(
        lista,
        producto.precio_venta,
        producto.precio_mayorista
      )

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
            precio_unitario: precio,
            cantidad: kg,
            stock_disponible: producto.stock_actual,
            venta_por_peso: true,
            precio_minorista: producto.precio_venta,
            precio_mayorista: producto.precio_mayorista,
            lista_aplicada,
          },
        ]
      }

      // Por unidad: incrementa
      if (existente) {
        if (!permitir_sin_stock && existente.cantidad >= producto.stock_actual)
          return estado
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
          precio_unitario: precio,
          cantidad: 1,
          stock_disponible: producto.stock_actual,
          venta_por_peso: false,
          precio_minorista: producto.precio_venta,
          precio_mayorista: producto.precio_mayorista,
          lista_aplicada,
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
              cantidad:
                it.venta_por_peso || accion.permitir_sin_stock
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
    case 'CAMBIAR_LISTA': {
      // Repriceo completo del carrito con los precios que ya viajan en cada
      // ítem (kg y cantidades se conservan; solo cambia el precio unitario).
      return estado.map((it) => {
        const { precio, lista_aplicada } = resolverPrecio(
          accion.lista,
          it.precio_minorista,
          it.precio_mayorista
        )
        return { ...it, precio_unitario: precio, lista_aplicada }
      })
    }
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
