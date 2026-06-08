import { PantallaCompras } from '@/components/compras/PantallaCompras'

export const metadata = {
  title: 'Compras — ¡Hola! Express',
}

export default async function PaginaCompras({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  return <PantallaCompras tabInicial={tab} />
}
