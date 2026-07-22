import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
import { getCuentas } from '@/lib/queries/cuentas'
import { getCuentasAPagar } from '@/lib/queries/finanzas'
import { getAcreditaciones } from '@/lib/queries/acreditaciones'
import { getConfigFiscal, getResumenFiscal } from '@/lib/queries/fiscal'

const r2 = (n: number) => Math.round(n * 100) / 100

export interface SemanaFlujo {
  indice: number
  /** Inicio de la semana (ISO local YYYY-MM-DD). */
  desde: string
  /** Fin exclusivo de la semana (ISO local). */
  hasta: string
  ingresos_ventas: number
  ingresos_cobranzas: number
  egresos_proveedores: number
  egresos_impuestos: number
  egresos_sueldos: number
  ingresos_total: number
  egresos_total: number
  neto: number
  /** Saldo proyectado al CIERRE de la semana. */
  saldo_acumulado: number
  /** true si el saldo proyectado queda en negativo (quiebre de caja). */
  quiebre: boolean
}

export interface FlujoProyectado {
  saldo_inicial: number
  ventas_promedio_semanal: number
  semanas: SemanaFlujo[]
  saldo_minimo: number
  primer_quiebre: SemanaFlujo | null
}

export interface OpcionesFlujo {
  horizonteSemanas?: number
  sueldosMensuales?: number
  diaPagoSueldos?: number
}

// ─── Helpers de fecha (todo en hora local, a medianoche) ─────────────

function aMedianoche(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parseIso(iso: string): Date {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(a, m - 1, d)
}

function sumarDias(d: Date, dias: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + dias)
  return r
}

const MS_DIA = 86_400_000

/**
 * Proyección de caja semana a semana. Junta lo que el comercio ya tiene
 * comprometido (deudas, impuestos, sueldos) contra lo que va a entrar
 * (ventas estimadas + cobranzas de tarjeta), para anticipar faltantes.
 *
 * Supuestos (v1):
 *  · Ventas futuras = promedio semanal de las últimas 8 semanas.
 *  · Impuestos = IVA (posición) + IIBB (a pagar) del mes en curso, en su
 *    fecha de vencimiento (config fiscal).
 *  · Sueldos = monto mensual fijo (parámetro), el día de pago de cada mes.
 *  · Lo vencido/atrasado se imputa a la semana 0 (hay que afrontarlo ya).
 */
export async function getFlujoProyectado(
  opciones: OpcionesFlujo = {}
): Promise<FlujoProyectado> {
  const horizonte = Math.max(1, Math.min(opciones.horizonteSemanas ?? 8, 26))
  const sueldosMensuales = Math.max(0, opciones.sueldosMensuales ?? 0)
  const diaPago = Math.min(Math.max(opciones.diaPagoSueldos ?? 5, 1), 28)

  const supabase = createClient()
  const hoy = aMedianoche(new Date())
  const finHorizonte = sumarDias(hoy, horizonte * 7)

  // Bucket semanal de una fecha; null si cae fuera del horizonte.
  // Lo anterior a hoy se imputa a la semana 0.
  function bucket(fecha: Date): number | null {
    if (fecha >= finHorizonte) return null
    if (fecha < hoy) return 0
    const dias = Math.floor((fecha.getTime() - hoy.getTime()) / MS_DIA)
    return Math.floor(dias / 7)
  }

  // Período del mes en curso (para impuestos)
  const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
  const primerDiaMesSig = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1)

  const [cuentas, cuentasPagar, acreditaciones, cfg] = await Promise.all([
    getCuentas(true),
    getCuentasAPagar('abiertas'),
    getAcreditaciones({ estado: 'pendiente' }),
    getConfigFiscal().catch(() => null),
  ])

  // Saldo inicial = liquidez disponible en todas las cuentas activas. Desde el
  // candado (mig 118) "Caja Efectivo" es la caja fuerte con saldo real (las
  // remesas la debitan de verdad) → no hay que restar lo remesado.
  const saldoInicial = cuentas.reduce((s, c) => s + Number(c.saldo_actual), 0)

  // Ventas de las últimas 8 semanas → promedio semanal
  const desdeVentas = isoLocal(sumarDias(hoy, -56))
  const hoyIso = isoLocal(hoy)
  const ventas = await traerTodo<{ total: number }>(() =>
    supabase
      .from('ventas')
      .select('total')
      .eq('estado', 'completada')
      .gte('fecha', desdeVentas)
      .lt('fecha', hoyIso)
  )
  const ventasTotal = ventas.reduce((s, v) => s + Number(v.total), 0)
  const ventasPromedioSemanal = r2(ventasTotal / 8)

  // Impuestos del mes en curso
  let ivaAPagar = 0
  let iibbAPagar = 0
  if (cfg) {
    try {
      const fiscal = await getResumenFiscal(
        isoLocal(primerDiaMes),
        isoLocal(primerDiaMesSig),
        cfg.iibb_alicuota,
        cfg.iibb_jurisdiccion,
        cfg.iva_alicuota_general
      )
      ivaAPagar = Math.max(0, fiscal.iva.posicion)
      iibbAPagar = fiscal.iibb.a_pagar
    } catch {
      // si falla la liquidación, seguimos sin impuestos en la proyección
    }
  }

  // ─── Inicializar semanas ───────────────────────────────────────────
  const semanas: SemanaFlujo[] = Array.from({ length: horizonte }, (_, i) => {
    const desde = sumarDias(hoy, i * 7)
    const hasta = sumarDias(hoy, (i + 1) * 7)
    return {
      indice: i,
      desde: isoLocal(desde),
      hasta: isoLocal(hasta),
      ingresos_ventas: ventasPromedioSemanal,
      ingresos_cobranzas: 0,
      egresos_proveedores: 0,
      egresos_impuestos: 0,
      egresos_sueldos: 0,
      ingresos_total: 0,
      egresos_total: 0,
      neto: 0,
      saldo_acumulado: 0,
      quiebre: false,
    }
  })

  // Cobranzas (acreditaciones pendientes) por fecha estimada. El monto_neto es
  // bruto − comisión, pero al acreditarse fn_acreditar_pago retiene además el
  // IIBB de la cuenta destino: se proyecta esa retención para no sobreestimar
  // (mismo redondeo que el RPC: round(bruto × pct) / 100).
  const iibbPorCuenta = new Map(
    cuentas.map((c) => [c.id, Number(c.retencion_iibb_porcentaje ?? 0)])
  )
  for (const a of acreditaciones) {
    if (!a.fecha_estimada) continue
    const b = bucket(parseIso(a.fecha_estimada))
    if (b === null) continue
    const pct = a.cuenta_id !== null ? (iibbPorCuenta.get(a.cuenta_id) ?? 0) : 0
    const iibbRetenido = Math.round(Number(a.monto_bruto) * pct) / 100
    semanas[b].ingresos_cobranzas += Number(a.monto_neto) - iibbRetenido
  }

  // Cuentas a pagar pendientes por vencimiento
  for (const c of cuentasPagar) {
    if (c.estado === 'pagada') continue
    const b = bucket(parseIso(c.fecha_vencimiento))
    if (b === null) continue
    semanas[b].egresos_proveedores += Number(c.saldo_pendiente)
  }

  // Impuestos: vencen el mes siguiente al período, día de config fiscal
  if (cfg && (ivaAPagar > 0 || iibbAPagar > 0)) {
    const anio = primerDiaMesSig.getFullYear()
    const mes = primerDiaMesSig.getMonth()
    if (ivaAPagar > 0) {
      const b = bucket(new Date(anio, mes, cfg.iva_dia_vencimiento))
      if (b !== null) semanas[b].egresos_impuestos += ivaAPagar
    }
    if (iibbAPagar > 0) {
      const b = bucket(new Date(anio, mes, cfg.iibb_dia_vencimiento))
      if (b !== null) semanas[b].egresos_impuestos += iibbAPagar
    }
  }

  // Sueldos: monto mensual en el día de pago de cada mes del horizonte
  if (sueldosMensuales > 0) {
    const cursor = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
    while (cursor < finHorizonte) {
      const fechaPago = new Date(cursor.getFullYear(), cursor.getMonth(), diaPago)
      const b = bucket(fechaPago)
      if (b !== null) semanas[b].egresos_sueldos += sueldosMensuales
      cursor.setMonth(cursor.getMonth() + 1)
    }
  }

  // ─── Totales + saldo acumulado ─────────────────────────────────────
  let saldo = saldoInicial
  let saldoMinimo = saldoInicial
  let primerQuiebre: SemanaFlujo | null = null

  for (const s of semanas) {
    s.ingresos_ventas = r2(s.ingresos_ventas)
    s.ingresos_cobranzas = r2(s.ingresos_cobranzas)
    s.egresos_proveedores = r2(s.egresos_proveedores)
    s.egresos_impuestos = r2(s.egresos_impuestos)
    s.egresos_sueldos = r2(s.egresos_sueldos)
    s.ingresos_total = r2(s.ingresos_ventas + s.ingresos_cobranzas)
    s.egresos_total = r2(
      s.egresos_proveedores + s.egresos_impuestos + s.egresos_sueldos
    )
    s.neto = r2(s.ingresos_total - s.egresos_total)
    saldo = r2(saldo + s.neto)
    s.saldo_acumulado = saldo
    s.quiebre = saldo < 0
    if (saldo < saldoMinimo) saldoMinimo = saldo
    if (s.quiebre && primerQuiebre === null) primerQuiebre = s
  }

  return {
    saldo_inicial: r2(saldoInicial),
    ventas_promedio_semanal: ventasPromedioSemanal,
    semanas,
    saldo_minimo: r2(saldoMinimo),
    primer_quiebre: primerQuiebre,
  }
}
