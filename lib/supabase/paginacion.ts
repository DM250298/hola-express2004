// Supabase REST API por default limita las queries a 1000 filas. Para listados
// que pueden superar ese límite (catálogo completo, mermas históricas, etc.)
// paginamos manualmente con `.range(desde, hasta)` hasta que devuelva menos
// que el tamaño de página, indicando que terminamos.

const PAGINA_DEFAULT = 1000

// El builder de Supabase es genérico complejo — tipamos como `unknown` y casteamos
// adentro. El llamador retiene el tipo de T en el genérico.
interface QueryConRange {
  range(
    desde: number,
    hasta: number
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>
}

/**
 * Itera una query de Supabase trayendo todas las filas en chunks de 1000.
 * Recibe una FÁBRICA de query porque cada `.range()` consume la builder,
 * así que se construye una nueva por iteración.
 *
 *   const filas = await traerTodo<MiTipo>(() =>
 *     supabase.from('productos').select('*').order('nombre')
 *   )
 */
export async function traerTodo<T>(
  construirQuery: () => QueryConRange,
  porPagina = PAGINA_DEFAULT
): Promise<T[]> {
  const acumulado: T[] = []
  let desde = 0

  while (true) {
    const hasta = desde + porPagina - 1
    const { data, error } = await construirQuery().range(desde, hasta)
    if (error) throw new Error(error.message)
    const lote = (data ?? []) as T[]
    acumulado.push(...lote)
    if (lote.length < porPagina) break
    desde += porPagina
    if (desde > 500_000) {
      throw new Error('Más de 500k filas — abortando para evitar loop infinito.')
    }
  }
  return acumulado
}
