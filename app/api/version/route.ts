import { NextResponse } from 'next/server'

/**
 * Versión publicada (commit que deployó Vercel). La consulta AvisoVersion
 * para pedirle a las pestañas viejas que recarguen. Sin Vercel (dev) es null.
 */
export function GET() {
  return NextResponse.json(
    { version: process.env.VERCEL_GIT_COMMIT_SHA || null },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
