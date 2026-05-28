'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from 'react'

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface ItemCarritoTienda {
  producto_id: number
  nombre: string
  precio_unitario: number
  cantidad: number
  stock_disponible: number
}

type Accion =
  | { tipo: 'AGREGAR'; producto: ItemCarritoTienda }
  | { tipo: 'QUITAR'; producto_id: number }
  | { tipo: 'CAMBIAR_CANTIDAD'; producto_id: number; cantidad: number }
  | { tipo: 'VACIAR' }
  | { tipo: 'CARGAR'; items: ItemCarritoTienda[] }

interface EstadoCarrito {
  items: ItemCarritoTienda[]
}

interface CarritoContexto {
  items: ItemCarritoTienda[]
  total: number
  cantidadTotal: number
  agregar: (producto: ItemCarritoTienda) => void
  quitar: (productoId: number) => void
  cambiarCantidad: (productoId: number, cantidad: number) => void
  vaciar: () => void
}

// ─── Reducer ────────────────────────────────────────────────────────────────

function reducer(estado: EstadoCarrito, accion: Accion): EstadoCarrito {
  switch (accion.tipo) {
    case 'AGREGAR': {
      const existente = estado.items.find(
        (i) => i.producto_id === accion.producto.producto_id
      )
      if (existente) {
        const nuevaCant = Math.min(
          existente.cantidad + accion.producto.cantidad,
          existente.stock_disponible
        )
        return {
          items: estado.items.map((i) =>
            i.producto_id === accion.producto.producto_id
              ? { ...i, cantidad: nuevaCant }
              : i
          ),
        }
      }
      return { items: [...estado.items, accion.producto] }
    }
    case 'QUITAR':
      return {
        items: estado.items.filter(
          (i) => i.producto_id !== accion.producto_id
        ),
      }
    case 'CAMBIAR_CANTIDAD': {
      if (accion.cantidad <= 0) {
        return {
          items: estado.items.filter(
            (i) => i.producto_id !== accion.producto_id
          ),
        }
      }
      return {
        items: estado.items.map((i) =>
          i.producto_id === accion.producto_id
            ? {
                ...i,
                cantidad: Math.min(accion.cantidad, i.stock_disponible),
              }
            : i
        ),
      }
    }
    case 'VACIAR':
      return { items: [] }
    case 'CARGAR':
      return { items: accion.items }
    default:
      return estado
  }
}

// ─── Context ────────────────────────────────────────────────────────────────

const LS_KEY = 'hola-tienda-carrito'

const Contexto = createContext<CarritoContexto | null>(null)

export function CarritoProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [estado, dispatch] = useReducer(reducer, { items: [] })

  // Cargar del localStorage al montar
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) {
        const items = JSON.parse(raw) as ItemCarritoTienda[]
        dispatch({ tipo: 'CARGAR', items })
      }
    } catch {
      // ignorar
    }
  }, [])

  // Persistir cada cambio
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(estado.items))
    } catch {
      // ignorar
    }
  }, [estado.items])

  const agregar = useCallback(
    (producto: ItemCarritoTienda) =>
      dispatch({ tipo: 'AGREGAR', producto }),
    []
  )
  const quitar = useCallback(
    (productoId: number) =>
      dispatch({ tipo: 'QUITAR', producto_id: productoId }),
    []
  )
  const cambiarCantidad = useCallback(
    (productoId: number, cantidad: number) =>
      dispatch({ tipo: 'CAMBIAR_CANTIDAD', producto_id: productoId, cantidad }),
    []
  )
  const vaciar = useCallback(() => dispatch({ tipo: 'VACIAR' }), [])

  const total = useMemo(
    () =>
      estado.items.reduce(
        (s, i) => s + i.precio_unitario * i.cantidad,
        0
      ),
    [estado.items]
  )

  const cantidadTotal = useMemo(
    () => estado.items.reduce((s, i) => s + i.cantidad, 0),
    [estado.items]
  )

  const valor: CarritoContexto = useMemo(
    () => ({
      items: estado.items,
      total,
      cantidadTotal,
      agregar,
      quitar,
      cambiarCantidad,
      vaciar,
    }),
    [estado.items, total, cantidadTotal, agregar, quitar, cambiarCantidad, vaciar]
  )

  return <Contexto value={valor}>{children}</Contexto>
}

export function useCarritoTienda(): CarritoContexto {
  const ctx = useContext(Contexto)
  if (!ctx) {
    throw new Error('useCarritoTienda debe usarse dentro de CarritoProvider')
  }
  return ctx
}
