/**
 * Etiquetas visibles de `productos.tipo`.
 *
 * El VALOR en la base de datos no cambia nunca ('insumo', 'semi_elaborado',
 * 'elaborado', …): recetas, RPCs y filtros dependen de él. Lo que se muestra
 * al usuario se define acá, en un solo lugar — para renombrar un tipo basta
 * con tocar este archivo.
 */

export interface TipoProducto {
  valor: string
  etiqueta: string
  /** Aclaración corta que se muestra entre paréntesis en el selector. */
  ayuda: string
}

/** Tipos elegibles al crear/editar un producto (en este orden). */
export const TIPOS_PRODUCTO: TipoProducto[] = [
  { valor: 'reventa', etiqueta: 'Reventa', ayuda: 'compra-venta' },
  { valor: 'combo', etiqueta: 'Combo / Pack', ayuda: 'agrupa productos' },
  {
    valor: 'insumo',
    etiqueta: 'Uso interno',
    ayuda: 'ingredientes, limpieza; no se vende',
  },
  {
    valor: 'semi_elaborado',
    etiqueta: 'Preparación intermedia',
    ayuda: 'base para recetas',
  },
  {
    valor: 'elaborado',
    etiqueta: 'Elaboración propia',
    ayuda: 'se hace acá y se vende',
  },
]

export const ETIQUETAS_TIPO: Record<string, string> = {
  ...Object.fromEntries(TIPOS_PRODUCTO.map((t) => [t.valor, t.etiqueta])),
  // Valores legacy del importador de Excel.
  simple: 'Reventa',
  variante: 'Variante',
}

/** Etiqueta visible de un tipo; si no está mapeado, devuelve el valor crudo. */
export function etiquetaTipo(tipo: string | null | undefined): string {
  if (!tipo) return '—'
  return ETIQUETAS_TIPO[tipo] ?? tipo
}
