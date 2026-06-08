import { PantallaInventario } from '@/components/inventario/PantallaInventario'

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
    <PantallaInventario tabInicial={tab === 'ranking' ? 'ranking' : 'stock'} />
  )
}
