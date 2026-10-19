import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { PortalFacturas } from '@/components/facturas/PortalFacturas'
import { PERMISOS_POR_ROL_LEGACY } from '@/lib/permisos'

export const metadata = {
  title: 'Facturas de proveedores — ¡Hola! Express',
}

/**
 * Portal único de facturas de proveedores (Compras › Facturas de proveedores).
 * El middleware deja pasar a /compras con compras/pedidos/recepcion, pero las
 * deudas y las facturas están gateadas por RLS a `finanzas`: acá se exige.
 */
export default async function PaginaFacturasProveedores({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>
}) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: perfil } = await supabase
    .from('usuarios')
    .select('rol')
    .eq('id', user.id)
    .single<{ rol: string }>()
  const rol = perfil?.rol ?? 'cajero'

  let permisos: string[] = PERMISOS_POR_ROL_LEGACY[rol] ?? []
  const { data: rolData } = await supabase
    .from('roles')
    .select('permisos')
    .eq('codigo', rol)
    .maybeSingle<{ permisos: string[] }>()
  if (rolData?.permisos) permisos = rolData.permisos

  if (rol !== 'admin' && !permisos.includes('finanzas')) redirect('/compras')

  const { estado } = await searchParams
  return <PortalFacturas estadoInicial={estado} />
}
