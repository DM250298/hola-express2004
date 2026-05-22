import { notFound } from 'next/navigation'
import { DetalleProducto } from '@/components/inventario/DetalleProducto'

export const metadata = {
  title: 'Detalle de producto — Inventario',
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function PaginaDetalleProducto({ params }: Props) {
  const { id } = await params
  const productoId = Number(id)
  if (!Number.isInteger(productoId) || productoId <= 0) {
    notFound()
  }
  return <DetalleProducto productoId={productoId} />
}
