import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
import { getTotalRemesado } from '@/lib/queries/posicionCaja'
import { getCuentaCajaFuerte } from '@/lib/queries/cuentas'
import { fechaLocal } from '@/lib/utils/periodos'
import type {
  ArqueoTesoreriaRow,
  MovimientoCajaFuerteRow,
  RemesaRow,
  SangriaRow,
  TipoMovimientoCajaFuerte,
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
  en_buzon: number // sangrías sin arquear — NO entra al saldo (se muestra aparte)
  arqueado: number // total contado y validado en arqueos (informativo)
  ingresos_manuales: number // Σ movimientos manuales tipo 'ingreso' (informativo)
  egresos_manuales: number // Σ movimientos manuales tipo 'egreso' (informativo)
  remesado: number // total depositado al banco (informativo; suele ser 0)
  saldo: number // saldo REAL de la cuenta bóveda ("Caja Efectivo")
  /** saldo − (arqueado + ingresos − egresos − remesado). Debe ser 0; ≠0 = descuadre a revisar. */
  descuadre: number
}

/**
 * Saldo de la caja fuerte = `cuentas."Caja Efectivo".saldo_actual` — FUENTE
 * ÚNICA desde el candado (migración 118): la cuenta se acredita SOLO al
 * validar el arqueo (control administrativo), con los movimientos manuales y
 * las remesas; la venta ya no la toca. Es el mismo número que ven el Tablero
 * y Cuentas. El desglose (arqueado/manuales/remesado) es informativo, y
 * `descuadre` compara la cuenta contra el circuito como semáforo de control.
 * El buzón (`en_buzon`) queda aparte: sobres declarados sin contar todavía.
 */
export async function getSaldoCajaFuerte(): Promise<SaldoCajaFuerte> {
  const supabase = createClient()

  // Arqueos, movimientos manuales y remesas son históricos completos: paginados
  // para esquivar el Max Rows (~1000 filas) que truncaría las sumas en silencio.
  const [buzonRes, arqueosData, movManual, remesado, cuentaBoveda] =
    await Promise.all([
      supabase.from('sangrias').select('monto').eq('estado', 'en_buzon'),
      traerTodo<{ monto_fisico: number }>(() =>
        supabase.from('arqueos_tesoreria').select('monto_fisico').order('id')
      ),
      traerTodo<{ tipo: string; monto: number }>(() =>
        supabase.from('movimientos_caja_fuerte').select('tipo, monto').order('id')
      ),
      getTotalRemesado(),
      getCuentaCajaFuerte(),
    ])

  if (buzonRes.error) throw buzonRes.error

  const en_buzon = (buzonRes.data ?? []).reduce(
    (a, s) => a + Number(s.monto),
    0
  )
  const arqueado = arqueosData.reduce((a, s) => a + Number(s.monto_fisico), 0)

  let ingresos_manuales = 0
  let egresos_manuales = 0
  for (const m of movManual) {
    if (m.tipo === 'ingreso') ingresos_manuales += Number(m.monto)
    else if (m.tipo === 'egreso') egresos_manuales += Number(m.monto)
  }

  const saldo = Number(cuentaBoveda.saldo_actual)
  const circuito = arqueado + ingresos_manuales - egresos_manuales - remesado
  const descuadre = Math.round((saldo - circuito) * 100) / 100

  return {
    en_buzon,
    arqueado,
    ingresos_manuales,
    egresos_manuales,
    remesado,
    saldo,
    descuadre,
  }
}

// ─── Movimientos manuales de la caja fuerte ───────────────────────────────────

export interface MovimientoCajaFuerteConUsuario extends MovimientoCajaFuerteRow {
  usuario_nombre: string | null
}

/** Movimientos manuales recientes (para la card de historial). */
export async function getMovimientosCajaFuerte(
  limite = 50
): Promise<MovimientoCajaFuerteConUsuario[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('movimientos_caja_fuerte')
    .select('*, usuarios(nombre)')
    .order('created_at', { ascending: false })
    .limit(limite)
  if (error) throw error

  type Fila = MovimientoCajaFuerteRow & { usuarios: { nombre: string } | null }
  return ((data ?? []) as unknown as Fila[]).map(({ usuarios, ...resto }) => ({
    ...resto,
    usuario_nombre: usuarios?.nombre ?? null,
  }))
}

export interface RegistrarMovimientoCajaFuertePayload {
  usuario_id: string
  tipo: TipoMovimientoCajaFuerte
  monto: number
  nota: string
}

/** Registra un ingreso/egreso manual de la caja fuerte (RPC atómico + auditoría). */
export async function registrarMovimientoCajaFuerte(
  payload: RegistrarMovimientoCajaFuertePayload
) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_registrar_mov_caja_fuerte', {
    p_usuario_id: payload.usuario_id,
    p_tipo: payload.tipo,
    p_monto: payload.monto,
    p_nota: payload.nota,
  })
  if (error) throw error
  return data
}

// ─── Control de diferencias ───────────────────────────────────────────────────

export interface TurnoDiferenciaDetalle {
  turno_id: number
  fecha_cierre: string | null
  esperado: number
  contado: number
  diferencia: number
}

export interface DiferenciaCierreEmpleado {
  usuario_id: string
  usuario_nombre: string | null
  turnos: number // cantidad de turnos cerrados en el período
  sobrantes: number // Σ diferencias > 0
  faltantes: number // Σ |diferencias < 0| (positivo)
  neto: number // Σ diferencias con signo (negativo = faltó plata)
  detalle: TurnoDiferenciaDetalle[] // cada turno, para el expandible (recientes primero)
}

/**
 * Diferencias de CIERRE DE CAJA agrupadas por cajero, con el detalle de cada
 * turno para poder ver diferencia por diferencia. Es la diferencia atribuible a
 * cada empleado (lo que declaró vs. lo esperado por ventas).
 * `caja_turnos.fecha_cierre` es TIMESTAMPTZ → se filtra con el ISO completo del
 * rango (NO `fechaLocal`, que recortaría a medianoche y perdería turnos del
 * último día). Paginado por si hay muchos turnos en rangos largos.
 */
export async function getDiferenciasCierrePorEmpleado(
  desde: string,
  hasta: string
): Promise<DiferenciaCierreEmpleado[]> {
  const supabase = createClient()
  const filas = await traerTodo<{
    id: number
    usuario_id: string
    fecha_cierre: string | null
    monto_cierre_esperado: number | null
    monto_cierre_real: number | null
    diferencia: number | null
    usuarios: { nombre: string } | null
  }>(() =>
    supabase
      .from('caja_turnos')
      .select(
        'id, usuario_id, fecha_cierre, monto_cierre_esperado, monto_cierre_real, diferencia, usuarios(nombre)'
      )
      .eq('estado', 'cerrado')
      .gte('fecha_cierre', desde)
      .lte('fecha_cierre', hasta)
      .order('fecha_cierre', { ascending: false })
  )

  const porEmpleado = new Map<string, DiferenciaCierreEmpleado>()
  for (const t of filas) {
    const dif = Number(t.diferencia ?? 0)
    const prev = porEmpleado.get(t.usuario_id) ?? {
      usuario_id: t.usuario_id,
      usuario_nombre: t.usuarios?.nombre ?? null,
      turnos: 0,
      sobrantes: 0,
      faltantes: 0,
      neto: 0,
      detalle: [],
    }
    prev.turnos += 1
    prev.neto += dif
    if (dif > 0) prev.sobrantes += dif
    else if (dif < 0) prev.faltantes += -dif
    prev.detalle.push({
      turno_id: t.id,
      fecha_cierre: t.fecha_cierre,
      esperado: Number(t.monto_cierre_esperado ?? 0),
      contado: Number(t.monto_cierre_real ?? 0),
      diferencia: dif,
    })
    porEmpleado.set(t.usuario_id, prev)
  }
  // Peores primero (neto más negativo = más faltante acumulado).
  return [...porEmpleado.values()].sort((a, b) => a.neto - b.neto)
}

export interface ArqueosPeriodo {
  arqueos: ArqueoTesoreriaRow[]
  totalEsperado: number
  totalFisico: number
  totalDiferencia: number
  conDiferencia: number // cantidad de arqueos con diferencia ≠ 0
}

/**
 * Arqueos del período — control del buzón (lo que el responsable contó vs. lo
 * que declaró el cajero). NO se agrupa por cajero: `arqueos_tesoreria.usuario_id`
 * es el responsable que contó y un arqueo puede agrupar sobres de varios
 * cajeros. `fecha` es columna DATE → se filtra con `fechaLocal`.
 */
export async function getArqueosPeriodo(
  desde: string,
  hasta: string
): Promise<ArqueosPeriodo> {
  const supabase = createClient()
  const arqueos = await traerTodo<ArqueoTesoreriaRow>(() =>
    supabase
      .from('arqueos_tesoreria')
      .select('*')
      .gte('fecha', fechaLocal(desde))
      .lte('fecha', fechaLocal(hasta))
      .order('fecha', { ascending: false })
  )

  let totalEsperado = 0
  let totalFisico = 0
  let totalDiferencia = 0
  let conDiferencia = 0
  for (const a of arqueos) {
    totalEsperado += Number(a.monto_esperado)
    totalFisico += Number(a.monto_fisico)
    totalDiferencia += Number(a.diferencia)
    if (Number(a.diferencia) !== 0) conDiferencia += 1
  }
  return { arqueos, totalEsperado, totalFisico, totalDiferencia, conDiferencia }
}
