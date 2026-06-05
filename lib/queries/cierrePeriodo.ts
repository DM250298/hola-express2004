import { createClient } from '@/lib/supabase/client'
import type { AuditoriaRow, EstadoPeriodo } from '@/types/database'

export interface PeriodoMes {
  anio: number
  mes: number
  estado: EstadoPeriodo
  fecha_cierre: string | null
}

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

export function nombreMes(mes: number): string {
  return MESES[mes - 1] ?? String(mes)
}

/** Últimos N meses (incluyendo el actual) con su estado de cierre. */
export async function getPeriodos(cantidad = 12): Promise<PeriodoMes[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('periodos_contables')
    .select('anio, mes, estado, fecha_cierre')
  if (error) throw error

  const cerrados = new Map<string, { estado: EstadoPeriodo; fecha_cierre: string | null }>()
  for (const p of data ?? []) {
    cerrados.set(`${p.anio}-${p.mes}`, {
      estado: p.estado as EstadoPeriodo,
      fecha_cierre: p.fecha_cierre,
    })
  }

  const hoy = new Date()
  const lista: PeriodoMes[] = []
  for (let i = 0; i < cantidad; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1)
    const anio = d.getFullYear()
    const mes = d.getMonth() + 1
    const c = cerrados.get(`${anio}-${mes}`)
    lista.push({
      anio,
      mes,
      estado: c?.estado ?? 'abierto',
      fecha_cierre: c?.fecha_cierre ?? null,
    })
  }
  return lista
}

export async function cerrarPeriodo(
  usuarioId: string,
  anio: number,
  mes: number
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_cerrar_periodo', {
    p_usuario_id: usuarioId,
    p_anio: anio,
    p_mes: mes,
  })
  if (error) throw error
}

export async function reabrirPeriodo(
  usuarioId: string,
  anio: number,
  mes: number
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_reabrir_periodo', {
    p_usuario_id: usuarioId,
    p_anio: anio,
    p_mes: mes,
  })
  if (error) throw error
}

// ─── Auditoría ──────────────────────────────────────────────────────────────

export interface AuditoriaConUsuario extends AuditoriaRow {
  usuario_nombre: string | null
}

export async function getAuditoria(limite = 100): Promise<AuditoriaConUsuario[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('auditoria')
    .select('*, usuarios(nombre)')
    .order('created_at', { ascending: false })
    .limit(limite)
  if (error) throw error

  type Fila = AuditoriaRow & { usuarios: { nombre: string } | null }
  return ((data ?? []) as unknown as Fila[]).map(({ usuarios, ...resto }) => ({
    ...resto,
    usuario_nombre: usuarios?.nombre ?? null,
  }))
}
