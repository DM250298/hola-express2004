import { PantallaControl } from '@/components/inventario/PantallaControl'

export const metadata = {
  title: 'Control de stock — ¡Hola! Express',
}

export default async function PaginaControlStock({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  return <PantallaControl tabInicial={tab} />
}
