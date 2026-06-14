import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getPermisosUsuario } from '@/lib/permisosServidor'
import { HubMovil } from '@/components/movil/HubMovil'

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
  const nombre = emp
    ? [emp.nombre, emp.apellido].filter(Boolean).join(' ')
    : resPerfil.data?.nombre ?? 'Encargado'

  return (
    <div className="mx-auto max-w-md px-4 pb-24 pt-5">
      <HubMovil
        nombre={nombre}
        permisos={permisos}
        pedidosPendientes={resPedidos.count ?? 0}
        tienePanel={!!emp}
      />
    </div>
  )
}
