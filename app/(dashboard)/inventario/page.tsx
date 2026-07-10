import { PantallaInventario } from '@/components/inventario/PantallaInventario'
import { NovedadesStock } from '@/components/shared/NovedadesStock'
import { BannerConteoActivo } from '@/components/conteo-fisico/BannerConteoActivo'

export const metadata = {
  title: 'Stock — ¡Hola! Express',
}

export default async function PaginaInventario({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  return (
    <>
      <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 sm:pt-6">
        <NovedadesStock />
        <BannerConteoActivo />
      </div>
      <PantallaInventario tabInicial={tab === 'ranking' ? 'ranking' : 'stock'} />
    </>
  )
}
