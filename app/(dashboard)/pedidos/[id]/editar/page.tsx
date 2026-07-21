import { notFound } from 'next/navigation'
import { FormularioNuevoPedido } from '@/components/pedidos/FormularioNuevoPedido'

export const metadata = {
  title: 'Editar orden — Pedidos',
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function PaginaEditarPedido({ params }: Props) {
  const { id } = await params
  const pedidoId = Number(id)
  if (!Number.isInteger(pedidoId) || pedidoId <= 0) {
    notFound()
  }
  return <FormularioNuevoPedido pedidoId={pedidoId} />
}
