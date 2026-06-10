import { PantallaProduccion } from '@/components/produccion/PantallaProduccion'

export const metadata = {
  title: 'Producción — ¡Hola! Express',
}

export default async function PaginaProduccion({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  return <PantallaProduccion tabInicial={tab} />
}
