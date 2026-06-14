import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getPermisosUsuario } from '@/lib/permisosServidor'
import { HubMovil } from '@/components/movil/HubMovil'
import { PanelEmpleado } from '@/components/rrhh/PanelEmpleado'

export const metadata = {
  title: 'Modo móvil — Hola Express',
}

export default async function PaginaMovil() {
  const { userId, permisos } = await getPermisosUsuario()
  if (!userId) redirect('/login')

  const supabase = await createServerClient()

  const [resEmp, resPedidos, resPerfil] = await Promise.all([
    supabase
      .from('empleados')
      .select('id, nombre, apellido')
      .eq('usuario_id', userId)
      .maybeSingle<{ id: number; nombre: string; apellido: string | null }>(),
    supabase
      .from('pedidos')
      .select('id', { count: 'exact', head: true })
      .in('estado', ['enviado', 'recepcion_parcial']),
    supabase
      .from('usuarios')
      .select('nombre')
      .eq('id', userId)
      .maybeSingle<{ nombre: string }>(),
  ])

  const emp = resEmp.data
  const pedidosPendientes = resPedidos.count ?? 0
  const nombre = emp
    ? [emp.nombre, emp.apellido].filter(Boolean).join(' ')
    : resPerfil.data?.nombre ?? 'Encargado'

  return (
    <div className="pb-24">
      <div className="mx-auto max-w-md px-4 pt-5">
        <HubMovil
          nombre={nombre}
          permisos={permisos}
          pedidosPendientes={pedidosPendientes}
        />
      </div>

      {emp && (
        <div className="mt-2">
          <PanelEmpleado
            empleadoId={emp.id}
            nombre={[emp.nombre, emp.apellido].filter(Boolean).join(' ')}
          />
        </div>
      )}
    </div>
  )
}
