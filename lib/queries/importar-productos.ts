import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
import type { FilaProcesada } from '@/lib/utils/parseo-excel'

// Supabase limita la URL del query a ~2KB. Con códigos EAN-13 (13 chars),
// caben ~120 por `.in(...)`. Bajamos a 100 para tener margen.
const CHUNK_LOOKUP_CODIGOS = 100

/**
 * Hace `select where codigo_barras in (...)` en chunks para evitar exceder el
 * límite de URL con listas grandes de códigos.
 */
async function buscarCodigosExistentes(
  supabase: ReturnType<typeof createClient>,
  codigos: string[]
): Promise<Set<string>> {
  const encontrados = new Set<string>()
  for (let i = 0; i < codigos.length; i += CHUNK_LOOKUP_CODIGOS) {
    const chunk = codigos.slice(i, i + CHUNK_LOOKUP_CODIGOS)
    const { data, error } = await supabase
      .from('productos')
      .select('codigo_barras')
      .in('codigo_barras', chunk)
    if (error) throw error
    for (const p of data ?? []) {
      if (p.codigo_barras) encontrados.add(p.codigo_barras)
    }
  }
  return encontrados
}

export interface ResumenImportacion {
  total_filas: number
  validas: number
  saltadas_combo: number
  con_errores: number
  productos_a_crear: number
  productos_a_actualizar: number
  categorias_nuevas: string[]
  proveedores_nuevos: string[]
}

export interface ResultadoImportacion {
  productos_creados: number
  productos_actualizados: number
  categorias_creadas: number
  proveedores_creados: number
  errores: Array<{ fila: number; producto: string; mensaje: string }>
}

function normalizar(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

/**
 * Calcula qué se va a crear/actualizar/saltar SIN escribir nada. Para mostrar
 * preview antes de confirmar.
 */
export async function calcularResumenImportacion(
  filas: FilaProcesada[]
): Promise<ResumenImportacion> {
  const supabase = createClient()

  const filasValidas = filas.filter((f) => !f.saltada && f.errores.length === 0)

  // Categorías y proveedores únicos del Excel (normalizados)
  const categoriasExcel = new Map<string, string>() // norm → original
  const proveedoresExcel = new Map<string, string>()
  for (const f of filasValidas) {
    if (f.categoria) categoriasExcel.set(normalizar(f.categoria), f.categoria)
    if (f.proveedor) proveedoresExcel.set(normalizar(f.proveedor), f.proveedor)
  }

  // Existentes (paginadas para soportar > 1000)
  const [catsExistentes, provsExistentes] = await Promise.all([
    traerTodo<{ nombre: string }>(() =>
      supabase.from('categorias').select('nombre')
    ),
    traerTodo<{ nombre: string }>(() =>
      supabase.from('proveedores').select('nombre')
    ),
  ])

  const setCats = new Set(catsExistentes.map((c) => normalizar(c.nombre)))
  const setProvs = new Set(provsExistentes.map((p) => normalizar(p.nombre)))

  const categorias_nuevas = [...categoriasExcel.entries()]
    .filter(([norm]) => !setCats.has(norm))
    .map(([, nombre]) => nombre)

  const proveedores_nuevos = [...proveedoresExcel.entries()]
    .filter(([norm]) => !setProvs.has(norm))
    .map(([, nombre]) => nombre)

  // Productos a crear vs actualizar (por código de barras) — lookup chunkeado
  const codigos = filasValidas
    .map((f) => f.codigo_barras)
    .filter((c): c is string => c !== null)

  const setCodigos = codigos.length > 0
    ? await buscarCodigosExistentes(supabase, codigos)
    : new Set<string>()

  let productos_a_crear = 0
  let productos_a_actualizar = 0
  for (const f of filasValidas) {
    if (f.codigo_barras && setCodigos.has(f.codigo_barras)) {
      productos_a_actualizar++
    } else {
      productos_a_crear++
    }
  }

  return {
    total_filas: filas.length,
    validas: filasValidas.length,
    saltadas_combo: filas.filter((f) => f.saltada).length,
    con_errores: filas.filter((f) => f.errores.length > 0).length,
    productos_a_crear,
    productos_a_actualizar,
    categorias_nuevas,
    proveedores_nuevos,
  }
}

/**
 * Ejecuta la importación:
 * 1. Crea categorías y proveedores que no existen
 * 2. Upsert de productos por codigo_barras (o INSERT si no tiene código)
 *
 * Los productos sin código de barras se insertan SIEMPRE como nuevos —
 * sin código no hay manera de detectar duplicados, queda en manos del usuario.
 */
export async function ejecutarImportacion(
  filas: FilaProcesada[]
): Promise<ResultadoImportacion> {
  const supabase = createClient()
  const errores: ResultadoImportacion['errores'] = []
  const filasValidas = filas.filter((f) => !f.saltada && f.errores.length === 0)

  // 1. Asegurar categorías
  const categoriasMap = new Map<string, string>() // norm → original
  for (const f of filasValidas) {
    if (f.categoria) categoriasMap.set(normalizar(f.categoria), f.categoria)
  }

  const catsExistentes = await traerTodo<{ id: number; nombre: string }>(() =>
    supabase.from('categorias').select('id, nombre')
  )

  const catNombreAId = new Map<string, number>()
  for (const c of catsExistentes) {
    catNombreAId.set(normalizar(c.nombre), c.id)
  }

  const categoriasACrear = [...categoriasMap.entries()]
    .filter(([norm]) => !catNombreAId.has(norm))
    .map(([, nombre]) => ({ nombre }))

  let categorias_creadas = 0
  if (categoriasACrear.length > 0) {
    const { data: insertadas, error } = await supabase
      .from('categorias')
      .insert(categoriasACrear)
      .select('id, nombre')

    if (error) throw error
    categorias_creadas = (insertadas ?? []).length
    for (const c of insertadas ?? []) {
      catNombreAId.set(normalizar(c.nombre), c.id)
    }
  }

  // 2. Asegurar proveedores
  const proveedoresMap = new Map<string, string>()
  for (const f of filasValidas) {
    if (f.proveedor) proveedoresMap.set(normalizar(f.proveedor), f.proveedor)
  }

  const provsExistentes = await traerTodo<{ id: number; nombre: string }>(() =>
    supabase.from('proveedores').select('id, nombre')
  )

  const provNombreAId = new Map<string, number>()
  for (const p of provsExistentes) {
    provNombreAId.set(normalizar(p.nombre), p.id)
  }

  const proveedoresACrear = [...proveedoresMap.entries()]
    .filter(([norm]) => !provNombreAId.has(norm))
    .map(([, nombre]) => ({ nombre }))

  let proveedores_creados = 0
  if (proveedoresACrear.length > 0) {
    const { data: insertados, error } = await supabase
      .from('proveedores')
      .insert(proveedoresACrear)
      .select('id, nombre')

    if (error) throw error
    proveedores_creados = (insertados ?? []).length
    for (const p of insertados ?? []) {
      provNombreAId.set(normalizar(p.nombre), p.id)
    }
  }

  // 3. Separar filas con y sin código de barras
  const conCodigo = filasValidas.filter((f) => f.codigo_barras !== null)
  const sinCodigo = filasValidas.filter((f) => f.codigo_barras === null)

  const armarPayload = (f: FilaProcesada) => ({
    nombre: f.producto,
    codigo_barras: f.codigo_barras,
    categoria_id: f.categoria ? catNombreAId.get(normalizar(f.categoria)) ?? null : null,
    proveedor_id: f.proveedor ? provNombreAId.get(normalizar(f.proveedor)) ?? null : null,
    precio_venta: f.precio_venta,
    precio_costo: f.precio_costo,
    stock_actual: f.stock_actual,
    stock_minimo: 5,
    tipo: f.tipo ?? 'simple',
    unidad: f.unidad ?? 'unidad',
    activo: true,
  })

  // 3a. Upsert (con códigos) — Supabase resuelve insert vs update por conflict
  let productos_actualizados = 0
  let productos_creados = 0

  if (conCodigo.length > 0) {
    // Para distinguir creados vs actualizados, primero consultamos cuáles ya existen
    // (chunkeado para evitar exceder el límite de URL)
    const codigos = conCodigo.map((f) => f.codigo_barras!) // ya filtrado
    const setExistentes = await buscarCodigosExistentes(supabase, codigos)

    // Procesar en chunks para no exceder límites de Supabase
    const CHUNK = 100
    for (let i = 0; i < conCodigo.length; i += CHUNK) {
      const chunk = conCodigo.slice(i, i + CHUNK).map(armarPayload)
      const { error } = await supabase
        .from('productos')
        .upsert(chunk, { onConflict: 'codigo_barras' })

      if (error) {
        for (const f of conCodigo.slice(i, i + CHUNK)) {
          errores.push({
            fila: f.fila_origen,
            producto: f.producto,
            mensaje: error.message,
          })
        }
      } else {
        for (const f of conCodigo.slice(i, i + CHUNK)) {
          if (f.codigo_barras && setExistentes.has(f.codigo_barras)) {
            productos_actualizados++
          } else {
            productos_creados++
          }
        }
      }
    }
  }

  // 3b. INSERT (sin códigos) — siempre crean nuevo
  if (sinCodigo.length > 0) {
    const CHUNK = 100
    for (let i = 0; i < sinCodigo.length; i += CHUNK) {
      const chunk = sinCodigo.slice(i, i + CHUNK).map(armarPayload)
      const { error } = await supabase.from('productos').insert(chunk)

      if (error) {
        for (const f of sinCodigo.slice(i, i + CHUNK)) {
          errores.push({
            fila: f.fila_origen,
            producto: f.producto,
            mensaje: error.message,
          })
        }
      } else {
        productos_creados += chunk.length
      }
    }
  }

  return {
    productos_creados,
    productos_actualizados,
    categorias_creadas,
    proveedores_creados,
    errores,
  }
}
