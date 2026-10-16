import { PantallaContabilidad } from '@/components/contabilidad/PantallaContabilidad'

export const metadata = {
  title: 'Contabilidad — ¡Hola! Express',
}

export default async function PaginaContabilidad({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  return <PantallaContabilidad tabInicial={tab} />
}
