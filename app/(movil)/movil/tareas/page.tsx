import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createServerClient } from '@/lib/supabase/server'
import { getPermisosUsuario } from '@/lib/permisosServidor'
import { MisTareas } from '@/components/rrhh/MisTareas'

export const metadata = {
  title: 'Mis tareas — Móvil',
}

/**
 * Tareas del día del empleado desde el celular. Reusa el componente MisTareas
 * (ya mobile-first) dentro del shell (movil). Las tareas propias las filtra la
 * RLS; acá sólo se resuelve el legajo. El acceso a /movil lo controla el
 * middleware.
 */
export default async function PaginaTareasMovil() {
  const { userId } = await getPermisosUsuario()
  if (!userId) redirect('/login')

  const supabase = await createServerClient()
  const { data: emp } = await supabase
    .from('empleados')
    .select('id, nombre')
    .eq('usuario_id', userId)
    .maybeSingle<{ id: number; nombre: string }>()

  return (
    <div className="pb-16">
      <div className="px-4 pt-3">
        <Link
          href="/movil"
          className="inline-flex items-center gap-1 text-sm font-medium text-[#6f3a2a]"
        >
          <ChevronLeft className="h-4 w-4" /> Volver
        </Link>
      </div>

      {emp ? (
        <MisTareas empleadoId={emp.id} nombre={emp.nombre} />
      ) : (
        <div className="mx-auto mt-4 max-w-md px-4">
          <div className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-8 text-center shadow-sm">
            <p className="font-semibold text-[#391511]">
              Tu usuario no está vinculado a un legajo
            </p>
            <p className="mt-1 text-sm text-[#6f3a2a]">
              Pedile al administrador que vincule tu cuenta a tu ficha de
              empleado para ver tus tareas.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
