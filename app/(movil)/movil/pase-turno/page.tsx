import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createServerClient } from '@/lib/supabase/server'
import { getPermisosUsuario } from '@/lib/permisosServidor'
import { PantallaPaseTurnoEmpleado } from '@/components/rrhh/PantallaPaseTurnoEmpleado'

export const metadata = {
  title: 'Pase de turno — Móvil',
}

export default async function PaginaPaseTurnoMovil() {
  const { userId } = await getPermisosUsuario()
  if (!userId) redirect('/login')

  const supabase = await createServerClient()
  const { data: emp } = await supabase
    .from('empleados')
    .select('id, nombre, apellido')
    .eq('usuario_id', userId)
    .maybeSingle<{ id: number; nombre: string; apellido: string | null }>()

  return (
    <div className="pb-16">
      <div className="px-4 pt-3">
        <Link
          href="/movil"
          className="flex items-center gap-1 text-sm font-medium text-[#6f3a2a]"
        >
          <ChevronLeft className="h-4 w-4" /> Volver
        </Link>
      </div>

      {emp ? (
        <div className="mx-auto max-w-md px-4 pt-3">
          <PantallaPaseTurnoEmpleado
            empleadoId={emp.id}
            nombre={[emp.nombre, emp.apellido].filter(Boolean).join(' ')}
            compacto
          />
        </div>
      ) : (
        <div className="mx-auto mt-4 max-w-md px-4">
          <div className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-8 text-center shadow-sm">
            <p className="font-semibold text-[#391511]">
              Tu usuario no está vinculado a un legajo
            </p>
            <p className="mt-1 text-sm text-[#6f3a2a]">
              Pedile al encargado que vincule tu cuenta a tu ficha de empleado
              para entregar y recibir el pase de turno.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
