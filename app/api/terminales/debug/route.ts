import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

/**
 * Endpoint TEMPORAL de diagnóstico — confirma qué Access Token de Mercado Pago
 * está cargado en el servidor y a qué cuenta corresponde. Devuelve sólo info
 * no sensible (longitud, prefijo, user_id que MP reporta). Eliminar cuando se
 * resuelva la integración.
 */
export async function GET() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  }

  const token = process.env.MP_ACCESS_TOKEN ?? ''
  const tokenInfo = {
    presente: token.length > 0,
    longitud: token.length,
    prefijo: token.slice(0, 12),
    sufijoUltimos4: token.length > 0 ? token.slice(-4) : null,
    tieneEspacios: /\s/.test(token),
    empiezaConAPPUSR: token.startsWith('APP_USR-'),
  }

  // Probar contra MP /users/me
  let respuestaMP: unknown = null
  let estadoMP: number | null = null
  if (token.length > 0) {
    try {
      const res = await fetch('https://api.mercadopago.com/users/me', {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      })
      estadoMP = res.status
      const texto = await res.text()
      try {
        const data = JSON.parse(texto) as Record<string, unknown>
        respuestaMP = {
          id: data.id,
          nickname: data.nickname,
          email: data.email,
          country_id: data.country_id,
          tags: data.tags,
          user_type: data.user_type,
        }
      } catch {
        respuestaMP = texto.slice(0, 200)
      }
    } catch (e) {
      respuestaMP = e instanceof Error ? e.message : 'fetch error'
    }
  }

  return NextResponse.json({ tokenInfo, estadoMP, respuestaMP })
}
