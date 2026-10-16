import { PantallaTerminales } from '@/components/terminales/PantallaTerminales'

export const metadata = {
  title: 'Cobros con posnet — ¡Hola! Express',
}

export default async function PaginaTerminales({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  return <PantallaTerminales tabInicial={tab} />
}
