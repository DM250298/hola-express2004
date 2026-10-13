import { PantallaVencimientos } from '@/components/vencimientos/PantallaVencimientos'

export const metadata = {
  title: 'Vencimientos — ¡Hola! Express',
}

export default async function PaginaVencimientos({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  return <PantallaVencimientos tabInicial={tab} />
}
