import { redirect } from 'next/navigation'

/** El tablero ahora es la pestaña "Hoy" del hub Personal. */
export default function PaginaTableroRrhh() {
  redirect('/rrhh?tab=hoy')
}
