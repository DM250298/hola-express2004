import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { listarDispositivos } from '@/lib/mercadopago/point'

/**
 * Lista los dispositivos Point asociados a la cuenta de Mercado Pago.
 * El Access Token vive sólo en el servidor.
 */
export async function GET() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  }

  try {
    const dispositivos = await listarDispositivos()
    return NextResponse.json({ dispositivos })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'No se pudieron obtener los dispositivos.',
      },
      { status: 502 }
    )
  }
}
