import { notFound } from 'next/navigation'
import { DetallePedido } from '@/components/pedidos/DetallePedido'

export const metadata = {
  title: 'Detalle de pedido — Pedidos',
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function PaginaDetallePedido({ params }: Props) {
  const { id } = await params
  const pedidoId = Number(id)
  if (!Number.isInteger(pedidoId) || pedidoId <= 0) {
    notFound()
  }
  return <DetallePedido pedidoId={pedidoId} />
}
