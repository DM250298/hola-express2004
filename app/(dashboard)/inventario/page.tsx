import { PantallaInventario } from '@/components/inventario/PantallaInventario'
import { NovedadesStock } from '@/components/shared/NovedadesStock'
import { BannerConteoActivo } from '@/components/conteo-fisico/BannerConteoActivo'
import type {
  Orden,
  PropsAnalisisSku,
  Vista,
} from '@/components/inventario/TabAnalisisSku'
import type { DimensionTablero } from '@/lib/queries/tablero'
import type { ClavePeriodo } from '@/lib/utils/periodos'

export const metadata = {
  title: 'Stock — ¡Hola! Express',
}

type ParametrosBusqueda = Record<string, string | string[] | undefined>

const VISTAS: Vista[] = ['todos', 'con_venta', 'quiebres', 'sin_venta', 'margen_negativo']
const ORDENES: Orden[] = ['ingresos', 'margen', 'unidades', 'cobertura', 'perdida', 'sin_venta']
const DIMENSIONES: DimensionTablero[] = ['categoria', 'marca', 'proveedor', 'gondola', 'clase_abc']
const PERIODOS: ClavePeriodo[] = ['ultimos_7', 'mes_actual', 'mes_anterior', 'personalizado']
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/

function uno(valor: string | string[] | undefined): string | undefined {
  return typeof valor === 'string' ? valor : undefined
}

/**
 * Los parámetros del drill-down (tablero del dueño → Análisis) llegan por
 * URL: se validan contra listas cerradas y los inválidos se ignoran.
 */
function leerAnalisis(sp: ParametrosBusqueda): PropsAnalisisSku {
  const dim = uno(sp.dim)
  const valor = uno(sp.valor)
  const desde = uno(sp.desde)
  const hasta = uno(sp.hasta)
  const dimension = DIMENSIONES.find((d) => d === dim)
  return {
    vistaInicial: VISTAS.find((v) => v === uno(sp.vista)),
    ordenInicial: ORDENES.find((o) => o === uno(sp.orden)),
    periodoInicial: PERIODOS.find((p) => p === uno(sp.periodo)),
    desdeInicial: desde && FECHA_ISO.test(desde) ? desde : undefined,
    hastaInicial: hasta && FECHA_ISO.test(hasta) ? hasta : undefined,
    filtroDimension: dimension && valor ? { dimension, valor } : null,
  }
}

export default async function PaginaInventario({
  searchParams,
}: {
  searchParams: Promise<ParametrosBusqueda>
}) {
  const sp = await searchParams
  const tab = uno(sp.tab)
  const tabInicial = tab === 'ranking' ? 'ranking' : tab === 'analisis' ? 'analisis' : 'stock'
  return (
    <>
      <div className="px-4 pt-4 sm:px-6 sm:pt-6">
        <NovedadesStock />
        <BannerConteoActivo />
      </div>
      <PantallaInventario tabInicial={tabInicial} analisis={leerAnalisis(sp)} />
    </>
  )
}
