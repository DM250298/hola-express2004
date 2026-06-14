import { notFound } from 'next/navigation'
import { RecepcionMovil } from '@/components/movil/RecepcionMovil'

export const metadata = {
  title: 'Recibir pedido — Móvil',
}

export default async function PaginaRecepcionDetalleMovil({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const pedidoId = Number(id)
  if (!Number.isInteger(pedidoId) || pedidoId <= 0) notFound()

  return <RecepcionMovil pedidoId={pedidoId} />
}
