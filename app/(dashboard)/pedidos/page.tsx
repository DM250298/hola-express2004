import { redirect } from 'next/navigation'

/** Las órdenes de compra ahora viven dentro del módulo unificado /compras. */
export default function PaginaPedidos() {
  redirect('/compras')
}
