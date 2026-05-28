import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { PERMISOS_POR_ROL_LEGACY, rutaInicial } from '@/lib/permisos'

const RUTAS_PUBLICAS = ['/login', '/tienda', '/api/tienda']
/** Rutas que solo deben ver usuarios NO logueados (ej: login). */
const RUTAS_SOLO_ANON = ['/login']

/** Permiso → prefijos de ruta que habilita. */
const PERMISO_RUTA: Record<string, string[]> = {
  dashboard: ['/'],
  proyectos: ['/proyectos', '/agenda'],
  pos: ['/pos'],
  ventas: ['/ventas'],
  clientes: ['/clientes'],
  inventario: ['/inventario'],
  vencimientos: ['/vencimientos'],
  compras: ['/compras'],
  etiquetas: ['/etiquetas'],
  pedidos: ['/pedidos'],
  recepcion: ['/recepcion'],
  finanzas: ['/finanzas'],
  contabilidad: ['/contabilidad'],
  rrhh: ['/rrhh'],
  terminales: ['/terminales'],
  reportes: ['/reportes'],
  configuracion: ['/configuracion'],
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Redirigir a login si no hay sesión y la ruta no es pública
  if (!user && !RUTAS_PUBLICAS.some((r) => pathname.startsWith(r))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Redirigir al dashboard si ya tiene sesión y va al login (no aplica a tienda)
  if (user && RUTAS_SOLO_ANON.some((r) => pathname.startsWith(r))) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  // Las route handlers de /api gestionan su propia autorización; no se les
  // aplica el guard de rutas por permiso (devuelven JSON, no HTML).
  if (pathname.startsWith('/api')) {
    return supabaseResponse
  }

  // Las rutas públicas no pasan por el guard de permisos
  if (RUTAS_PUBLICAS.some((r) => pathname.startsWith(r))) {
    return supabaseResponse
  }

  // Control de acceso por permisos del rol (si hay usuario)
  if (user) {
    const { data: perfil } = await supabase
      .from('usuarios')
      .select('rol')
      .eq('id', user.id)
      .single()

    const rol = (perfil?.rol as string | undefined) ?? null
    if (rol) {
      // Permisos: tabla `roles` con fallback al mapeo de roles base.
      let permisos: string[] = PERMISOS_POR_ROL_LEGACY[rol] ?? []
      const { data: rolData } = await supabase
        .from('roles')
        .select('permisos')
        .eq('codigo', rol)
        .maybeSingle()
      if (rolData?.permisos) permisos = rolData.permisos as string[]

      // Quien no tiene permiso de dashboard (ej. el cajero) entra directo a
      // su área de trabajo — nunca al dashboard.
      if (pathname === '/' && !permisos.includes('dashboard')) {
        const destino = rutaInicial(permisos)
        if (destino !== '/') {
          const url = request.nextUrl.clone()
          url.pathname = destino
          return NextResponse.redirect(url)
        }
      }

      const rutasPermitidas = permisos.flatMap(
        (p) => PERMISO_RUTA[p] ?? []
      )

      const tieneAcceso = rutasPermitidas.some(
        (r) => pathname === r || pathname.startsWith(`${r}/`)
      )

      // El dashboard '/' siempre es accesible (evita bucles de redirección).
      if (!tieneAcceso && pathname !== '/') {
        const url = request.nextUrl.clone()
        url.pathname = '/'
        return NextResponse.redirect(url)
      }
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // Se excluyen también el service worker y el manifest PWA (FASE 2 —
    // POS offline): deben servirse tal cual, sin pasar por los guardas de auth.
    '/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|icono\\.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
