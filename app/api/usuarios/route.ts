import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase/server'

/**
 * Crea un usuario nuevo (auth + perfil). Solo lo puede invocar el admin.
 * Usa la service role key para crear el usuario en Supabase Auth con el
 * email ya confirmado, sin tocar la sesión del admin.
 */
export async function POST(request: Request) {
  // 1. Verificar que quien llama esté logueado y sea admin
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  }

  const { data: perfil } = await supabase
    .from('usuarios')
    .select('rol')
    .eq('id', user.id)
    .single<{ rol: string }>()
  if (perfil?.rol !== 'admin') {
    return NextResponse.json(
      { error: 'Solo el administrador puede crear usuarios.' },
      { status: 403 }
    )
  }

  // 2. Validar datos
  let body: {
    nombre?: string
    email?: string
    password?: string
    rol?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  const nombre = (body.nombre ?? '').trim()
  const email = (body.email ?? '').trim().toLowerCase()
  const password = body.password ?? ''
  const rol = (body.rol ?? '').trim()

  if (!nombre || !email || !password || !rol) {
    return NextResponse.json(
      { error: 'Faltan datos obligatorios.' },
      { status: 400 }
    )
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: 'La contraseña debe tener al menos 6 caracteres.' },
      { status: 400 }
    )
  }

  // 3. Cliente con service role
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    return NextResponse.json(
      {
        error:
          'Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor (.env.local).',
      },
      { status: 500 }
    )
  }
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  // 4. Crear el usuario en Auth (email ya confirmado)
  const { data: creado, error: errCrear } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (errCrear || !creado?.user) {
    return NextResponse.json(
      { error: errCrear?.message ?? 'No se pudo crear el usuario.' },
      { status: 400 }
    )
  }

  // 5. Crear / completar el perfil en public.usuarios
  const { error: errPerfil } = await admin
    .from('usuarios')
    .upsert(
      { id: creado.user.id, email, nombre, rol, activo: true },
      { onConflict: 'id' }
    )
  if (errPerfil) {
    // Rollback: eliminar el usuario de Auth para no dejar basura
    await admin.auth.admin.deleteUser(creado.user.id)
    return NextResponse.json(
      { error: `No se pudo crear el perfil: ${errPerfil.message}` },
      { status: 400 }
    )
  }

  return NextResponse.json({ ok: true })
}
