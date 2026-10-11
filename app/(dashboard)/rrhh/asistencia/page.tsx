import { redirect } from 'next/navigation'

/** La grilla de turnos ahora es la pestaña "Cronograma" del hub Personal. */
export default function PaginaAsistencia() {
  redirect('/rrhh?tab=cronograma')
}
