import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getPermisosUsuario } from '@/lib/permisosServidor'
import { MiCuentaEmpleado } from '@/components/rrhh/MiCuentaEmpleado'

export const metadata = {
  title: 'Mi cuenta — ¡Hola! Express',
}

export default async function PaginaMiCuenta() {
  const { userId } = await getPermisosUsuario()
  if (!userId) redirect('/login')

  const supabase = await createServerClient()
  const { data: emp } = await supabase
    .from('empleados')
    .select('id')
    .eq('usuario_id', userId)
    .maybeSingle<{ id: number }>()

  if (!emp) {
    return (
      <div className="mx-auto mt-10 max-w-md px-4">
        <div className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-8 text-center shadow-sm">
          <p className="font-semibold text-[#391511]">
            Tu usuario no está vinculado a un legajo
          </p>
          <p className="mt-1 text-sm text-[#6f3a2a]">
            Pedile al administrador que vincule tu cuenta a tu ficha de
            empleado para ver tu cuenta corriente.
          </p>
        </div>
      </div>
    )
  }

  return <MiCuentaEmpleado />
}
