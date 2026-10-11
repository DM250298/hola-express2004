import { redirect } from 'next/navigation'

/** La gestión de tareas ahora es la pestaña "Tareas" del hub Personal. */
export default function PaginaTareas() {
  redirect('/rrhh?tab=tareas')
}
