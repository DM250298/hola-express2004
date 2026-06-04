import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/client'
import { parsearPrecio } from '@/lib/utils/parseo-excel'
import type {
  ExtractoBancarioRow,
  LineaExtractoRow,
  Json,
} from '@/types/database'

// ─── Parseo del archivo (CSV / Excel de Mercado Pago u otro banco) ───────────

export interface MapeoExtracto {
  fecha: number // índice de columna
  monto: number
  descripcion: number
  id_externo: number
}

export interface ArchivoParseado {
  headers: string[]
  filas: unknown[][]
  mapeoSugerido: MapeoExtracto
  filaInicio: number
}

const PATRONES: Record<keyof MapeoExtracto, RegExp[]> = {
  // Preferimos la fecha de liberación/acreditación sobre la de la operación
  fecha: [
    /fecha.*(liber|acredit|dispon)/i,
    /release.*date/i,
    /money_release/i,
    /^fecha/i,
    /date/i,
  ],
  // Preferimos el monto NETO (lo que realmente entra) sobre el bruto
  monto: [
    /(monto|importe).*(neto|net)/i,
    /net_.*amount/i,
    /settlement.*net/i,
    /^neto/i,
    /^valor/i,
    /^importe/i,
    /^monto/i,
    /amount/i,
  ],
  descripcion: [/detalle/i, /descrip/i, /concepto/i, /description/i, /motivo/i],
  id_externo: [
    /n[uú]mero.*operaci/i,
    /id.*operaci/i,
    /source_id/i,
    /operation_id/i,
    /^id$/i,
    /referencia/i,
  ],
}

function detectarMapeo(headers: string[]): MapeoExtracto {
  const limpios = headers.map((h) => String(h ?? '').trim())
  const buscar = (patrones: RegExp[]) =>
    limpios.findIndex((h) => patrones.some((re) => re.test(h)))
  return {
    fecha: buscar(PATRONES.fecha),
    monto: buscar(PATRONES.monto),
    descripcion: buscar(PATRONES.descripcion),
    id_externo: buscar(PATRONES.id_externo),
  }
}

/** Lee el archivo y detecta encabezados + mapeo sugerido de columnas. */
export async function parsearArchivoExtracto(
  file: File
): Promise<ArchivoParseado> {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    blankrows: false,
    defval: '',
  })

  // Buscar la fila de encabezados: la primera que tenga una celda con "fecha"
  let filaHeader = 0
  for (let i = 0; i < Math.min(aoa.length, 15); i++) {
    const fila = aoa[i] ?? []
    if (fila.some((c) => /fecha|date/i.test(String(c ?? '')))) {
      filaHeader = i
      break
    }
  }

  const headers = (aoa[filaHeader] ?? []).map((h) => String(h ?? '').trim())
  const filas = aoa.slice(filaHeader + 1)

  return {
    headers,
    filas,
    mapeoSugerido: detectarMapeo(headers),
    filaInicio: filaHeader + 2,
  }
}

// ─── Construcción de líneas normalizadas ──────────────────────────────────────

export interface LineaCruda {
  fila_origen: number
  fecha: string | null // ISO YYYY-MM-DD
  descripcion: string
  monto: number // con signo
  id_externo: string | null
}

function parsearFecha(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === '') return null
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return `${valor.getFullYear()}-${String(valor.getMonth() + 1).padStart(2, '0')}-${String(valor.getDate()).padStart(2, '0')}`
  }
  if (typeof valor === 'number') {
    // Serial de Excel
    const d = XLSX.SSF ? new Date(Math.round((valor - 25569) * 86400 * 1000)) : null
    if (d && !Number.isNaN(d.getTime())) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
  }
  const s = String(valor).trim().slice(0, 19)
  // dd/mm/yyyy o dd-mm-yyyy
  const m1 = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (m1) {
    return `${m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`
  }
  // yyyy-mm-dd o yyyy/mm/dd
  const m2 = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/)
  if (m2) {
    return `${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}`
  }
  return null
}

export function construirLineas(
  filas: unknown[][],
  mapeo: MapeoExtracto,
  filaInicio: number
): LineaCruda[] {
  const out: LineaCruda[] = []
  filas.forEach((fila, i) => {
    const montoRaw = mapeo.monto >= 0 ? fila[mapeo.monto] : ''
    const monto = parsearPrecio(montoRaw)
    // Saltar filas sin monto (totales, vacías)
    if (!monto || Number.isNaN(monto)) return

    out.push({
      fila_origen: filaInicio + i,
      fecha: mapeo.fecha >= 0 ? parsearFecha(fila[mapeo.fecha]) : null,
      descripcion:
        mapeo.descripcion >= 0
          ? String(fila[mapeo.descripcion] ?? '').trim()
          : '',
      monto,
      id_externo:
        mapeo.id_externo >= 0
          ? String(fila[mapeo.id_externo] ?? '').trim() || null
          : null,
    })
  })
  return out
}

// ─── Datos del sistema para cruzar ────────────────────────────────────────────

export interface AcredParaMatch {
  id: number
  monto_neto: number
  fecha_estimada: string
  medio_pago: string
  venta_id: number | null
}

export interface MovParaMatch {
  id: number
  monto: number
  tipo: string
  fecha: string
  descripcion: string
}

export async function getDatosParaMatch(cuentaId: number): Promise<{
  acreditaciones: AcredParaMatch[]
  movimientos: MovParaMatch[]
}> {
  const supabase = createClient()

  const [acredRes, movRes] = await Promise.all([
    supabase
      .from('acreditaciones')
      .select('id, monto_neto, fecha_estimada, medio_pago, venta_id')
      .eq('estado', 'pendiente')
      .eq('cuenta_id', cuentaId),
    supabase
      .from('movimientos_cuenta')
      .select('id, monto, tipo, fecha, descripcion')
      .eq('cuenta_id', cuentaId)
      .eq('conciliado', false),
  ])

  if (acredRes.error) throw acredRes.error
  if (movRes.error) throw movRes.error

  return {
    acreditaciones: (acredRes.data ?? []).map((a) => ({
      id: a.id,
      monto_neto: Number(a.monto_neto),
      fecha_estimada: a.fecha_estimada,
      medio_pago: a.medio_pago,
      venta_id: a.venta_id,
    })),
    movimientos: (movRes.data ?? []).map((m) => ({
      id: m.id,
      monto: Number(m.monto),
      tipo: m.tipo,
      fecha: m.fecha,
      descripcion: m.descripcion,
    })),
  }
}

// ─── Motor de cruce ───────────────────────────────────────────────────────────

export type AccionConciliacion =
  | 'acreditar'
  | 'conciliar_mov'
  | 'anomalia'
  | 'ignorar'

export interface LineaConciliacion extends LineaCruda {
  accion: AccionConciliacion
  ref_id: number | null
  match_label: string | null
}

function difDias(a: string | null, b: string): number {
  if (!a) return 999
  const da = new Date(`${a}T00:00:00`).getTime()
  const db = new Date(`${b}T00:00:00`).getTime()
  return Math.abs(da - db) / (1000 * 60 * 60 * 24)
}

/**
 * Cruza las líneas del extracto contra acreditaciones y movimientos.
 * Por cada línea de ingreso (monto > 0) busca primero una acreditación
 * pendiente (mismo neto ± centavos, fecha cercana); si no, un movimiento.
 * Las de egreso (monto < 0) sólo contra movimientos. Sin match → anomalía.
 */
export function cruzarLineas(
  lineas: LineaCruda[],
  acreditaciones: AcredParaMatch[],
  movimientos: MovParaMatch[],
  toleranciaDias = 5
): LineaConciliacion[] {
  const acredPool = [...acreditaciones]
  const movPool = [...movimientos]
  const TOL_MONTO = 0.5

  return lineas.map((l) => {
    const abs = Math.abs(l.monto)

    if (l.monto > 0) {
      // 1) Acreditaciones (ventas con tarjeta liberadas por MP)
      let mejor = -1
      let mejorDias = Infinity
      acredPool.forEach((a, idx) => {
        if (Math.abs(a.monto_neto - l.monto) <= TOL_MONTO) {
          const d = difDias(l.fecha, a.fecha_estimada)
          if (d <= toleranciaDias && d < mejorDias) {
            mejorDias = d
            mejor = idx
          }
        }
      })
      if (mejor >= 0) {
        const a = acredPool.splice(mejor, 1)[0]
        return {
          ...l,
          accion: 'acreditar',
          ref_id: a.id,
          match_label: `Venta #${a.venta_id ?? '—'} · ${a.medio_pago}`,
        }
      }
    }

    // 2) Movimientos de cuenta no conciliados (mismo signo)
    let mejorMov = -1
    let mejorDiasMov = Infinity
    movPool.forEach((m, idx) => {
      const mismoSigno =
        (l.monto > 0 && m.tipo === 'ingreso') ||
        (l.monto < 0 && m.tipo === 'egreso')
      if (mismoSigno && Math.abs(m.monto - abs) <= TOL_MONTO) {
        const d = difDias(l.fecha, m.fecha)
        if (d <= toleranciaDias && d < mejorDiasMov) {
          mejorDiasMov = d
          mejorMov = idx
        }
      }
    })
    if (mejorMov >= 0) {
      const m = movPool.splice(mejorMov, 1)[0]
      return {
        ...l,
        accion: 'conciliar_mov',
        ref_id: m.id,
        match_label: m.descripcion,
      }
    }

    return { ...l, accion: 'anomalia', ref_id: null, match_label: null }
  })
}

// ─── Aplicar la conciliación ──────────────────────────────────────────────────

export interface AplicarConciliacionPayload {
  usuario_id: string
  cuenta_id: number
  nombre_archivo: string | null
  lineas: LineaConciliacion[]
}

export async function aplicarConciliacion(
  payload: AplicarConciliacionPayload
) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_aplicar_conciliacion', {
    p_usuario_id: payload.usuario_id,
    p_cuenta_id: payload.cuenta_id,
    p_nombre_archivo: payload.nombre_archivo,
    p_lineas: payload.lineas.map((l) => ({
      fecha: l.fecha,
      descripcion: l.descripcion,
      monto: l.monto,
      id_externo: l.id_externo,
      accion: l.accion,
      ref_id: l.ref_id,
    })) as unknown as Json,
  })
  if (error) throw error
  return data
}

// ─── Historial ────────────────────────────────────────────────────────────────

export async function getExtractos(): Promise<ExtractoBancarioRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('extractos_bancarios')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data ?? []) as ExtractoBancarioRow[]
}

export async function getLineasExtracto(
  extractoId: number
): Promise<LineaExtractoRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('lineas_extracto')
    .select('*')
    .eq('extracto_id', extractoId)
    .order('fecha', { ascending: true })
  if (error) throw error
  return (data ?? []) as LineaExtractoRow[]
}
