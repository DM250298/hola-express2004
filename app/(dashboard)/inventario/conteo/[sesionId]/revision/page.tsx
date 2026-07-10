import { PantallaRevision } from '@/components/conteo-fisico/PantallaRevision'

export const metadata = {
  title: 'Revisión de conteo — ¡Hola! Express',
}

export default async function PaginaRevisionConteo({
  params,
}: {
  params: Promise<{ sesionId: string }>
}) {
  const { sesionId } = await params
  return <PantallaRevision sesionId={Number(sesionId)} />
}
