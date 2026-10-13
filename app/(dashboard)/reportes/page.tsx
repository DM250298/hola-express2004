import { PantallaReportes } from '@/components/reportes/PantallaReportes'

export const metadata = {
  title: 'Reportes — ¡Hola! Express',
}

export default async function PaginaReportes({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  return <PantallaReportes tabInicial={tab} />
}
