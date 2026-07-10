import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getPermisosUsuario } from '@/lib/permisosServidor'
import { HubMovil } from '@/components/movil/HubMovil'
import { NovedadesStock } from '@/components/shared/NovedadesStock'

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

  // Conteo físico en curso: la RLS ya limita las zonas a las asignadas al
  // usuario (o las libres, para reclamar). Si no hay sesión viva o el usuario
  // no tiene zonas, la tarjeta no aparece.
  let conteoFisico: {
    nombre: string
    zonas: { id: number; nombre: string; estado: string }[]
  } | null = null
  const { data: sesionConteo } = await supabase
    .from('conteo_sesiones')
    .select('id, nombre')
    .neq('estado', 'cerrada')
    .maybeSingle<{ id: number; nombre: string }>()
  if (sesionConteo) {
    const { data: zonas } = await supabase
      .from('conteo_zonas')
      .select('id, nombre, estado, orden')
      .eq('sesion_id', sesionConteo.id)
      .order('orden', { ascending: true })
    if (zonas && zonas.length > 0) {
      conteoFisico = {
        nombre: sesionConteo.nombre,
        zonas: zonas.map((z) => ({ id: z.id, nombre: z.nombre, estado: z.estado })),
      }
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 pb-24 pt-5">
      <HubMovil
        nombre={nombre}
        permisos={permisos}
        pedidosPendientes={resPedidos.count ?? 0}
        tienePanel={!!emp}
        conteoFisico={conteoFisico}
      />

      <NovedadesStock className="mt-4" />
    </div>
  )
}
