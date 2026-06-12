import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getPermisosUsuario } from '@/lib/permisosServidor'
import { PanelEmpleado } from '@/components/rrhh/PanelEmpleado'

export const metadata = {
  title: 'Mi panel — RRHH',
}

export default async function PaginaMiPanel() {
  const { userId } = await getPermisosUsuario()
  if (!userId) redirect('/login')

  const supabase = await createServerClient()
  const { data: emp } = await supabase
    .from('empleados')
    .select('id, nombre, apellido')
    .eq('usuario_id', userId)
    .maybeSingle<{ id: number; nombre: string; apellido: string | null }>()

  if (!emp) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm p-8 text-center">
          <p className="text-[#391511] font-semibold">Tu usuario no está vinculado a un legajo</p>
          <p className="text-[#6f3a2a] text-sm mt-1">
            Pedile al encargado que vincule tu cuenta a tu ficha de empleado para ver
            tu asistencia.
          </p>
        </div>
      </div>
    )
  }

  return (
    <PanelEmpleado
      empleadoId={emp.id}
      nombre={[emp.nombre, emp.apellido].filter(Boolean).join(' ')}
    />
  )
}
