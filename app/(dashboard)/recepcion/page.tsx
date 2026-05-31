import { redirect } from 'next/navigation'

/** La recepción ahora vive dentro del módulo unificado /compras. */
export default function PaginaRecepcion() {
  redirect('/compras')
}
