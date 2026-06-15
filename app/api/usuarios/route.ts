import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase/server'

type ServerClient = Awaited<ReturnType<typeof createServerClient>>

/**
 * Verifica que quien llama esté logueado y sea admin.
 * Devuelve el `user` o, si no corresponde, una `NextResponse` ya armada.
 */
async function exigirAdmin(
  supabase: ServerClient
): Promise<{ user: User } | { error: NextResponse }> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: NextResponse.json({ error: 'No autenticado.' }, { status: 401 }) }
  }
  const { data: perfil } = await supabase
    .from('usuarios')
    .select('rol')
    .eq('id', user.id)
    .single<{ rol: string }>()
  if (perfil?.rol !== 'admin') {
    return {
      error: NextResponse.json(
        { error: 'Solo el administrador puede gestionar usuarios.' },
        { status: 403 }
      ),
    }
  }
  return { user }
}

/** Cliente con service role (bypassa RLS). `null` si falta la key. */
function clienteAdmin(): SupabaseClient | null {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return null
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * ¿El usuario ya tiene operaciones registradas? Si las tiene, borrarlo
 * rompería el historial (las FK a `usuarios` son RESTRICT), así que se debe
 * desactivar en lugar de borrar. Sirve para dar un mensaje claro de antemano;
 * el borrado real igual es atómico por la cascada de `auth.users`.
 */
async function tieneOperaciones(
  admin: SupabaseClient,
  usuarioId: string
): Promise<boolean> {
  const tablas = ['ventas', 'caja_turnos', 'movimientos_stock', 'egresos']
  for (const tabla of tablas) {
    const { count } = await admin
      .from(tabla)
      .select('id', { count: 'exact', head: true })
      .eq('usuario_id', usuarioId)
    if ((count ?? 0) > 0) return true
  }
  return false
}

/**
 * Crea un usuario nuevo (auth + perfil). Solo lo puede invocar el admin.
 * Usa la service role key para crear el usuario en Supabase Auth con el
 * email ya confirmado, sin tocar la sesión del admin.
 */
export async function POST(request: Request) {
  // 1. Verificar que quien llama sea admin
  const supabase = await createServerClient()
  const guard = await exigirAdmin(supabase)
  if ('error' in guard) return guard.error

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
  const admin = clienteAdmin()
  if (!admin) {
    return NextResponse.json(
      {
        error:
          'Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor (.env.local).',
      },
      { status: 500 }
    )
  }

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

/**
 * Borra un usuario (auth + perfil). Solo lo puede invocar el admin.
 *
 * Borra la fila de `auth.users`, que por la cascada (`usuarios.id references
 * auth.users(id) on delete cascade`) elimina también el perfil. Si el usuario
 * ya tiene operaciones (ventas, turnos, movimientos) las FK RESTRICT abortan
 * el borrado: en ese caso se debe desactivar el acceso, no borrar.
 *
 * El id del usuario va como query param: `DELETE /api/usuarios?id=<uuid>`.
 */
export async function DELETE(request: Request) {
  // 1. Verificar que quien llama sea admin
  const supabase = await createServerClient()
  const guard = await exigirAdmin(supabase)
  if ('error' in guard) return guard.error

  // 2. Id del objetivo
  const id = new URL(request.url).searchParams.get('id')?.trim()
  if (!id) {
    return NextResponse.json(
      { error: 'Falta el id del usuario a borrar.' },
      { status: 400 }
    )
  }
  if (id === guard.user.id) {
    return NextResponse.json(
      { error: 'No podés borrar tu propia cuenta.' },
      { status: 400 }
    )
  }

  // 3. Cliente con service role
  const admin = clienteAdmin()
  if (!admin) {
    return NextResponse.json(
      {
        error:
          'Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor (.env.local).',
      },
      { status: 500 }
    )
  }

  // 4. Existe y no es el último admin
  const { data: objetivo } = await admin
    .from('usuarios')
    .select('nombre, rol')
    .eq('id', id)
    .maybeSingle<{ nombre: string; rol: string }>()
  if (!objetivo) {
    return NextResponse.json({ error: 'El usuario no existe.' }, { status: 404 })
  }
  if (objetivo.rol === 'admin') {
    const { count } = await admin
      .from('usuarios')
      .select('id', { count: 'exact', head: true })
      .eq('rol', 'admin')
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: 'No se puede borrar al único administrador del sistema.' },
        { status: 400 }
      )
    }
  }

  // 5. Si ya operó, no se puede borrar sin romper el historial
  if (await tieneOperaciones(admin, id)) {
    return NextResponse.json(
      {
        error: `${objetivo.nombre} ya tiene operaciones registradas (ventas, turnos, etc.). Desactivá su acceso en lugar de borrarlo.`,
      },
      { status: 409 }
    )
  }

  // 6. Borrado real (cascada a public.usuarios)
  const { error: errBorrar } = await admin.auth.admin.deleteUser(id)
  if (errBorrar) {
    return NextResponse.json(
      {
        error: `No se pudo borrar a ${objetivo.nombre}. Probablemente ya tiene operaciones asociadas: desactivá su acceso en lugar de borrarlo.`,
      },
      { status: 409 }
    )
  }

  return NextResponse.json({ ok: true })
}
