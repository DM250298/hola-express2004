import { PantallaZonaConteo } from '@/components/conteo-fisico/PantallaZonaConteo'

export const metadata = {
  title: 'Conteo de zona — ¡Hola! Express',
}

export default async function PaginaZonaConteo({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <PantallaZonaConteo zonaId={Number(id)} />
}
