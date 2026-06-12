import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createServerClient } from '@/lib/supabase/server'

/**
 * Parser server-side del export .xls del reloj biométrico (formato CDFV2, estilo
 * ZKTeco). Sólo se lee la hoja `Entr` (marcaciones crudas); el resto son cálculos
 * del reloj que ignoramos — HEX recalcula todo desde las marcaciones.
 *
 * Estructura de `Entr` (sin headers, leer como matriz):
 *   · Fila ~1: período "2026/03/01 ~ 03/07" (en alguna celda).
 *   · Fila ~2: No | Nom. | Depart. | 1 | 2 | 3 …  (desde col 3 = días).
 *   · Fila ~3: día de semana abreviado (validación, no se usa).
 *   · Filas 4+: por empleado. col0 = N° reloj, col1 = nombre, col2 = depart.
 *     Cada celda de día tiene las marcaciones apiladas con \n: "07:05\n15:05\n".
 *
 * Devuelve la previsualización + el array plano de marcaciones para confirmar
 * con fn_importar_fichajes. El matching es SIEMPRE por reloj_id.
 */

const RE_PERIODO =
  /(\d{4})\/(\d{2})\/(\d{2})\s*~\s*(?:(\d{4})\/)?(\d{2})\/(\d{2})/

interface FilaPreview {
  reloj_id: number
  nombre_reloj: string
  empleado_id: number | null
  nombre_empleado: string | null
  total: number
  dias_impares: number
  por_dia: Record<string, string[]>
}

/** Suma días a una fecha YYYY-MM-DD sin corrimiento por zona horaria. */
function sumarDias(fechaIso: string, dias: number): string {
  const [a, m, d] = fechaIso.split('-').map(Number)
  const t = Date.UTC(a, m - 1, d) + dias * 86_400_000
  const dt = new Date(t)
  const y = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${mm}-${dd}`
}

function diffDias(desde: string, hasta: string): number {
  const [a1, m1, d1] = desde.split('-').map(Number)
  const [a2, m2, d2] = hasta.split('-').map(Number)
  return Math.round(
    (Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000
  )
}

export async function POST(request: Request) {
  // 1. Auth + permiso operativo de RRHH (admin/encargado).
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
  if (!perfil || !['admin', 'encargado'].includes(perfil.rol)) {
    return NextResponse.json(
      { error: 'Solo admin o encargado puede importar fichajes.' },
      { status: 403 }
    )
  }

  // 2. Archivo.
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'No se pudo leer el formulario.' }, { status: 400 })
  }
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Falta el archivo.' }, { status: 400 })
  }
  if (!/\.(xls|xlsx)$/i.test(file.name)) {
    return NextResponse.json({ error: 'El archivo debe ser .xls o .xlsx.' }, { status: 400 })
  }
  if (file.size > 8 * 1024 * 1024) {
    return NextResponse.json({ error: 'El archivo supera los 8 MB.' }, { status: 413 })
  }

  // 3. Leer la hoja `Entr`.
  let aoa: unknown[][]
  try {
    const buffer = await file.arrayBuffer()
    const wb = XLSX.read(buffer, { type: 'array' })
    const nombreHoja = wb.SheetNames.find((n) => n.trim().toLowerCase() === 'entr')
    if (!nombreHoja) {
      return NextResponse.json(
        { error: 'El archivo no tiene la hoja "Entr" del reloj.' },
        { status: 400 }
      )
    }
    aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nombreHoja], {
      header: 1,
      raw: false,
      blankrows: false,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudo leer el archivo.' },
      { status: 400 }
    )
  }

  // 4. Período (buscar la celda con el patrón en las primeras filas).
  let periodoDesde = ''
  let periodoHasta = ''
  for (const fila of aoa.slice(0, 5)) {
    for (const celda of fila ?? []) {
      const m = String(celda ?? '').match(RE_PERIODO)
      if (m) {
        const [, y1, m1, d1, y2, m2, d2] = m
        periodoDesde = `${y1}-${m1}-${d1}`
        // Si el fin no trae año y el mes "retrocede", cruzó de año.
        const anioFin = y2 ?? (Number(m2) < Number(m1) ? String(Number(y1) + 1) : y1)
        periodoHasta = `${anioFin}-${m2}-${d2}`
        break
      }
    }
    if (periodoDesde) break
  }
  if (!periodoDesde || !periodoHasta) {
    return NextResponse.json(
      { error: 'No se pudo detectar el período (ej: 2026/03/01 ~ 03/07).' },
      { status: 400 }
    )
  }

  const totalDias = diffDias(periodoDesde, periodoHasta) + 1
  if (totalDias < 1 || totalDias > 60) {
    return NextResponse.json(
      { error: `Período inválido: ${periodoDesde} a ${periodoHasta}.` },
      { status: 400 }
    )
  }
  const dias = Array.from({ length: totalDias }, (_, i) => sumarDias(periodoDesde, i))

  // 5. Filas de empleado: col0 = N° reloj (entero), col1 = nombre. Las columnas
  //    de día arrancan en el índice 3 y mapean consecutivamente desde periodoDesde.
  const COL_DIA_INICIO = 3
  const filas: FilaPreview[] = []
  const marcaciones: { reloj_id: number; momento: string }[] = []

  for (const fila of aoa) {
    const rawId = String((fila ?? [])[0] ?? '').trim()
    const nombre = String((fila ?? [])[1] ?? '').trim()
    if (!/^\d+$/.test(rawId) || !nombre) continue // header, weekday, título…
    const relojId = Number(rawId)

    const porDia: Record<string, string[]> = {}
    let total = 0
    let diasImpares = 0

    for (let c = COL_DIA_INICIO; c < (fila?.length ?? 0); c++) {
      const offset = c - COL_DIA_INICIO
      if (offset >= dias.length) break
      const fecha = dias[offset]
      const celda = String((fila ?? [])[c] ?? '')
      const horasRaw = celda.match(/(\d{1,2}):(\d{2})/g) ?? []
      const norm: string[] = []
      for (const h of horasRaw) {
        const [hhRaw, mm] = h.split(':')
        const hh = Number(hhRaw)
        const min = Number(mm)
        if (hh > 23 || min > 59) continue // descarta valores corruptos (29:99…)
        norm.push(`${String(hh).padStart(2, '0')}:${mm}`)
      }
      if (norm.length === 0) continue
      porDia[fecha] = norm
      total += norm.length
      if (norm.length % 2 === 1) diasImpares += 1
      for (const h of norm) {
        marcaciones.push({ reloj_id: relojId, momento: `${fecha}T${h}:00-03:00` })
      }
    }

    filas.push({
      reloj_id: relojId,
      nombre_reloj: nombre,
      empleado_id: null,
      nombre_empleado: null,
      total,
      dias_impares: diasImpares,
      por_dia: porDia,
    })
  }

  if (marcaciones.length > 50_000) {
    return NextResponse.json(
      { error: 'El archivo excede el máximo de marcaciones procesables.' },
      { status: 413 }
    )
  }
  if (filas.length === 0) {
    return NextResponse.json(
      { error: 'No se encontraron filas de empleados con marcaciones.' },
      { status: 400 }
    )
  }

  // 6. Matchear reloj_id contra empleados (para marcar los "sin vincular").
  const relojIds = [...new Set(filas.map((f) => f.reloj_id))]
  const { data: empleados } = await supabase
    .from('empleados')
    .select('id, reloj_id, nombre, apellido')
    .in('reloj_id', relojIds)
  const mapa = new Map<number, { id: number; nombre: string }>()
  for (const e of (empleados ?? []) as {
    id: number
    reloj_id: number
    nombre: string
    apellido: string | null
  }[]) {
    mapa.set(e.reloj_id, {
      id: e.id,
      nombre: [e.nombre, e.apellido].filter(Boolean).join(' '),
    })
  }
  let sinMatch = 0
  for (const f of filas) {
    const e = mapa.get(f.reloj_id)
    if (e) {
      f.empleado_id = e.id
      f.nombre_empleado = e.nombre
    } else {
      sinMatch += 1
    }
  }

  return NextResponse.json({
    archivo_nombre: file.name,
    periodo_desde: periodoDesde,
    periodo_hasta: periodoHasta,
    dias,
    filas,
    marcaciones,
    resumen: {
      total_marcaciones: marcaciones.length,
      empleados: filas.length,
      sin_match: sinMatch,
    },
  })
}
