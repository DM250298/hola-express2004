// Motor de importación genérico. Toda la mecánica común a cualquier entidad:
// leer el .xlsx, detectar columnas por encabezado (tolerante), procesar filas,
// calcular el preview y ejecutar la escritura (RPC en chunks o upsert directo).

import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/client'
import type {
  DefinicionEntidad,
  FilaProcesadaGen,
  ResultadoImport,
  ResumenImport,
} from './tipos'

const CHUNK_RPC = 500
const CHUNK_LOOKUP = 100

/** Mapa campo → índice de columna en el encabezado (o -1 si no se detectó). */
export type MapeoColumnas = Record<string, number>

/**
 * Detecta el índice de cada columna. Cada campo toma el primer header que
 * matchee alguno de sus alias y que NO haya sido tomado por un campo anterior
 * (por eso el orden de `columnas` importa: las más específicas van primero).
 * Devuelve null si falta algún header requerido.
 */
export function detectarColumnas(
  headers: unknown[],
  def: DefinicionEntidad
): MapeoColumnas | null {
  const limpios = headers.map((h) => String(h ?? '').replace(/\s+/g, ' ').trim())
  const usados = new Set<number>()
  const mapeo: MapeoColumnas = {}

  for (const col of def.columnas) {
    const idx = limpios.findIndex(
      (h, i) => !usados.has(i) && h !== '' && col.aliases.some((re) => re.test(h))
    )
    mapeo[col.campo] = idx
    if (idx >= 0) usados.add(idx)
  }

  for (const campo of def.requeridasHeader) {
    if ((mapeo[campo] ?? -1) < 0) return null
  }
  return mapeo
}

/** Procesa las filas de datos aplicando el parser y las validaciones de cada columna. */
export function procesarFilas(
  filas: unknown[][],
  mapeo: MapeoColumnas,
  def: DefinicionEntidad,
  filaInicio: number
): FilaProcesadaGen[] {
  const resultado: FilaProcesadaGen[] = []
  const campoNombre = def.requeridasHeader[0]

  filas.forEach((fila, i) => {
    const filaOrigen = filaInicio + i
    const datos: Record<string, unknown> = {}
    const errores: string[] = []

    for (const col of def.columnas) {
      const idx = mapeo[col.campo] ?? -1
      const crudo = idx >= 0 ? fila[idx] : undefined
      datos[col.campo] = col.parser(crudo)
    }

    // Fila sin valor en el primer campo requerido (ej. nombre) → se ignora.
    const primero = datos[campoNombre]
    if (primero === null || primero === undefined || String(primero).trim() === '') {
      return
    }

    // Derivaciones que dependen de varios campos
    def.posProcesar?.(datos)

    for (const col of def.columnas) {
      if (col.validar) {
        const msg = col.validar(datos[col.campo], datos)
        if (msg) errores.push(msg)
      }
    }

    resultado.push({ fila_origen: filaOrigen, datos, errores })
  })

  return resultado
}

/** Lee un File .xlsx/.csv, detecta el encabezado en las primeras 3 filas y procesa. */
export async function leerArchivo(
  file: File,
  def: DefinicionEntidad
): Promise<{ filas: FilaProcesadaGen[]; mapeo: MapeoColumnas; error?: string }> {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  // Preferimos una hoja que coincida con la clave de la entidad (ej. "productos")
  const nombreHoja =
    wb.SheetNames.find((n) => n.toLowerCase() === def.clave) ?? wb.SheetNames[0]
  const ws = wb.Sheets[nombreHoja]
  if (!ws) return { filas: [], mapeo: {}, error: 'El archivo no tiene hojas.' }

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: false,
    blankrows: false,
  })

  let mapeo: MapeoColumnas | null = null
  let filaInicio = 2
  for (let i = 0; i < Math.min(3, aoa.length); i++) {
    const candidato = detectarColumnas(aoa[i] ?? [], def)
    if (candidato) {
      mapeo = candidato
      filaInicio = i + 2
      break
    }
  }

  if (!mapeo) {
    const reqs = def.requeridasHeader.join(', ')
    return {
      filas: [],
      mapeo: {},
      error: `No se encontraron las columnas obligatorias (${reqs}). Revisá el encabezado.`,
    }
  }

  // filaInicio es la fila (1-indexed) donde empiezan los DATOS; aoa es
  // 0-indexed, así que el primer dato está en aoa[filaInicio - 1]. (Antes
  // restaba 2 y colaba la fila de encabezados como primer dato.)
  const filas = procesarFilas(aoa.slice(filaInicio - 1), mapeo, def, filaInicio)
  return { filas, mapeo }
}

/** Lee de la base las claves ya existentes (chunked por límite de URL). */
async function buscarExistentes(
  def: DefinicionEntidad,
  claves: string[]
): Promise<Set<string>> {
  const supabase = createClient()
  const set = new Set<string>()
  for (let i = 0; i < claves.length; i += CHUNK_LOOKUP) {
    const chunk = claves.slice(i, i + CHUNK_LOOKUP)
    const { data, error } = await supabase
      .from(def.claveUnica.tabla)
      .select(def.claveUnica.columna)
      .in(def.claveUnica.columna, chunk)
    if (error) throw error
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
      const v = r[def.claveUnica.columna]
      if (v != null) set.add(String(v))
    }
  }
  return set
}

/** Calcula el preview SIN escribir nada. */
export async function calcularResumen(
  filas: FilaProcesadaGen[],
  def: DefinicionEntidad
): Promise<ResumenImport> {
  const validas = filas.filter((f) => f.errores.length === 0)
  const campoClave = def.claveUnica.campo

  // Claves presentes en el archivo (las vacías siempre cuentan como "a crear")
  const clavesArchivo = validas
    .map((f) => f.datos[campoClave])
    .filter((v): v is string => v != null && String(v).trim() !== '')
    .map((v) => String(v).trim())

  const existentes =
    clavesArchivo.length > 0 ? await buscarExistentes(def, clavesArchivo) : new Set<string>()

  // Duplicados dentro del archivo
  const vistos = new Set<string>()
  const duplicados = new Set<string>()
  for (const c of clavesArchivo) {
    if (vistos.has(c)) duplicados.add(c)
    else vistos.add(c)
  }

  let aCrear = 0
  let aActualizar = 0
  for (const f of validas) {
    const clave = f.datos[campoClave]
    const claveStr = clave != null ? String(clave).trim() : ''
    if (claveStr !== '' && existentes.has(claveStr)) aActualizar++
    else aCrear++
  }

  return {
    total_filas: filas.length,
    validas: validas.length,
    con_errores: filas.filter((f) => f.errores.length > 0).length,
    a_crear: aCrear,
    a_actualizar: aActualizar,
    duplicados_archivo: [...duplicados],
    columnas_no_detectadas: [],
  }
}

/** Ejecuta la importación llamando al RPC de la entidad en chunks. */
export async function ejecutar(
  filas: FilaProcesadaGen[],
  def: DefinicionEntidad
): Promise<ResultadoImport> {
  const supabase = createClient()
  const validas = filas.filter((f) => f.errores.length === 0)
  const errores: ResultadoImport['errores'] = []
  let creados = 0
  let actualizados = 0

  const rpc = def.escritura.nombre
  for (let i = 0; i < validas.length; i += CHUNK_RPC) {
    const lote = validas
      .slice(i, i + CHUNK_RPC)
      .map((f) => ({ ...f.datos, fila_origen: f.fila_origen }))
    const { data, error } = await supabase.rpc(
      rpc as 'fn_importar_productos',
      { p_filas: lote }
    )
    if (error) {
      for (const f of validas.slice(i, i + CHUNK_RPC)) {
        errores.push({
          fila: f.fila_origen,
          codigo: String(f.datos[def.claveUnica.campo] ?? ''),
          mensaje: error.message,
        })
      }
      continue
    }
    const r = (data ?? {}) as unknown as ResultadoImport
    creados += r.creados ?? 0
    actualizados += r.actualizados ?? 0
    for (const e of r.errores ?? []) errores.push(e)
  }

  return { creados, actualizados, errores }
}
