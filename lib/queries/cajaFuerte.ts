import { createClient } from '@/lib/supabase/client'
import type {
  ArqueoTesoreriaRow,
  RemesaRow,
  SangriaRow,
} from '@/types/database'

// ─── Sangrías ─────────────────────────────────────────────────────────────────

export interface SangriaConUsuario extends SangriaRow {
  usuario_nombre: string | null
}

/** Registra una sangría (retiro de efectivo de la caja al buzón). */
export async function registrarSangria(payload: {
  turno_id: number
  usuario_id: string
  monto: number
  nota: string | null
}): Promise<SangriaRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('sangrias')
    .insert({
      turno_id: payload.turno_id,
      usuario_id: payload.usuario_id,
      monto: payload.monto,
      nota: payload.nota,
      estado: 'en_buzon',
    })
    .select()
    .single<SangriaRow>()
  if (error) throw error
  return data
}

/** Sangrías que están en el buzón (pendientes de arqueo). */
export async function getSangriasEnBuzon(): Promise<SangriaConUsuario[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('sangrias')
    .select('*, usuarios(nombre)')
    .eq('estado', 'en_buzon')
    .order('created_at', { ascending: true })
  if (error) throw error

  type Fila = SangriaRow & { usuarios: { nombre: string } | null }
  return ((data ?? []) as unknown as Fila[]).map(({ usuarios, ...resto }) => ({
    ...resto,
    usuario_nombre: usuarios?.nombre ?? null,
  }))
}

/** Total de las sangrías del turno (para mostrar en el POS). */
export async function getTotalSangriasTurno(turnoId: number): Promise<number> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('sangrias')
    .select('monto')
    .eq('turno_id', turnoId)
  if (error) throw error
  return (data ?? []).reduce((acc, s) => acc + Number(s.monto), 0)
}

// ─── Arqueos ──────────────────────────────────────────────────────────────────

export async function getArqueos(limite = 50): Promise<ArqueoTesoreriaRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('arqueos_tesoreria')
    .select('*')
    .order('fecha', { ascending: false })
    .limit(limite)
  if (error) throw error
  return (data ?? []) as ArqueoTesoreriaRow[]
}

export interface ValidarArqueoPayload {
  usuario_id: string
  sangria_ids: number[]
  monto_fisico: number
  nota: string | null
}

export async function validarArqueo(payload: ValidarArqueoPayload) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_validar_arqueo', {
    p_usuario_id: payload.usuario_id,
    p_sangria_ids: payload.sangria_ids,
    p_monto_fisico: payload.monto_fisico,
    p_nota: payload.nota,
  })
  if (error) throw error
  return data
}

// ─── Remesas ──────────────────────────────────────────────────────────────────

export interface RemesaConCuenta extends RemesaRow {
  cuenta_nombre: string | null
}

export async function getRemesas(limite = 50): Promise<RemesaConCuenta[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('remesas')
    .select('*, cuentas(nombre)')
    .order('fecha', { ascending: false })
    .limit(limite)
  if (error) throw error

  type Fila = RemesaRow & { cuentas: { nombre: string } | null }
  return ((data ?? []) as unknown as Fila[]).map(({ cuentas, ...resto }) => ({
    ...resto,
    cuenta_nombre: cuentas?.nombre ?? null,
  }))
}

export interface GenerarRemesaPayload {
  usuario_id: string
  cuenta_id: number
  monto: number
  comprobante: string | null
  nota: string | null
}

export async function generarRemesa(payload: GenerarRemesaPayload) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_generar_remesa', {
    p_usuario_id: payload.usuario_id,
    p_cuenta_id: payload.cuenta_id,
    p_monto: payload.monto,
    p_comprobante: payload.comprobante,
    p_nota: payload.nota,
  })
  if (error) throw error
  return data
}

// ─── Saldo de la caja fuerte ──────────────────────────────────────────────────

export interface SaldoCajaFuerte {
  en_buzon: number // sangrías sin arquear
  arqueado: number // total contado en arqueos
  remesado: number // total depositado al banco
  saldo: number // arqueado - remesado (efectivo en la caja fuerte)
}

export async function getSaldoCajaFuerte(): Promise<SaldoCajaFuerte> {
  const supabase = createClient()

  const [buzonRes, arqueosRes, remesasRes] = await Promise.all([
    supabase.from('sangrias').select('monto').eq('estado', 'en_buzon'),
    supabase.from('arqueos_tesoreria').select('monto_fisico'),
    supabase.from('remesas').select('monto'),
  ])

  if (buzonRes.error) throw buzonRes.error
  if (arqueosRes.error) throw arqueosRes.error
  if (remesasRes.error) throw remesasRes.error

  const en_buzon = (buzonRes.data ?? []).reduce(
    (a, s) => a + Number(s.monto),
    0
  )
  const arqueado = (arqueosRes.data ?? []).reduce(
    (a, s) => a + Number(s.monto_fisico),
    0
  )
  const remesado = (remesasRes.data ?? []).reduce(
    (a, s) => a + Number(s.monto),
    0
  )

  return { en_buzon, arqueado, remesado, saldo: arqueado - remesado }
}
