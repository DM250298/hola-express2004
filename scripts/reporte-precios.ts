// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Reporte comparativo de precios — DRY RUN (no escribe nada)            ║
// ║                                                                        ║
// ║  Recalcula el precio de venta de cada producto con el motor nuevo      ║
// ║  (lib/pricing) y lo compara contra el precio actual. Genera un CSV y   ║
// ║  un resumen en consola para revisar ANTES de aplicar los cambios.      ║
// ║                                                                        ║
// ║  Uso (Node 24 corre TS nativo):                                        ║
// ║    node scripts/reporte-precios.ts              → DRY RUN (default)     ║
// ║    node scripts/reporte-precios.ts --margen=40  → objetivo plano 40%    ║
// ║    node scripts/reporte-precios.ts --aplicar    → ESCRIBE los precios   ║
// ║    --excluir-menores=100 → no toca productos con precio actual < $100  ║
// ║      (ítems baratos tipo golosinas sueltas, donde el techo a $50 los   ║
// ║      distorsiona; se definen a mano)                                   ║
// ║                                                                        ║
// ║  Lee las credenciales de .env.local (URL + SERVICE_ROLE_KEY). Usa la   ║
// ║  service role para leer costos_producto (gateada por RLS). Sin         ║
// ║  --aplicar NO modifica nada: solo lee y reporta a CSV + consola. Con   ║
// ║  --aplicar exige la migración 108 corrida y escribe precio_venta +     ║
// ║  margen (el markup asegurado) + pendiente_precio=false por producto.   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { calcularPrecio, seleccionarPeorTasa } from '../lib/pricing/motor.ts'
import type { RegimenFiscal } from '../lib/pricing/tipos.ts'

// ── Credenciales desde .env.local ────────────────────────────────────────
function cargarEnv(ruta: string): Record<string, string> {
  const out: Record<string, string> = {}
  let contenido: string
  try {
    contenido = readFileSync(ruta, 'utf8')
  } catch {
    return out
  }
  for (const linea of contenido.split(/\r?\n/)) {
    const limpia = linea.trim()
    if (!limpia || limpia.startsWith('#')) continue
    const i = limpia.indexOf('=')
    if (i === -1) continue
    const clave = limpia.slice(0, i).trim()
    let valor = limpia.slice(i + 1).trim()
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1)
    }
    out[clave] = valor
  }
  return out
}

const env = { ...cargarEnv('.env.local'), ...process.env }
const url = env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error(
    'Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local'
  )
  process.exit(1)
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const r2 = (n: number) => Math.round(n * 100) / 100

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  // 1. Config del motor (config_fiscal + medios_pago), igual que la UI.
  const { data: fiscal, error: eF } = await supabase
    .from('config_fiscal')
    .select('*')
    .eq('id', 1)
    .single()
  if (eF || !fiscal) throw eF ?? new Error('No hay config_fiscal.')

  // Si todavía no se corrió la migración 108, esas columnas no existen: se usa
  // el default de la spec (1.2% y $50) para poder previsualizar el reporte.
  const debcredPct = fiscal.impuesto_deb_cred_alicuota
  const redondeo = fiscal.redondeo_multiplo
  const faltaMig108 = debcredPct == null || redondeo == null
  if (faltaMig108) {
    console.warn(
      '⚠ config_fiscal no tiene impuesto_deb_cred_alicuota / redondeo_multiplo ' +
        '(falta correr la migración 108). Usando defaults de la spec: 1.20% y $50.\n'
    )
  }

  const { data: medios, error: eM } = await supabase
    .from('medios_pago')
    .select('comision_porcentaje, mp_payment_type, mp_channel')
  if (eM) throw eM

  const iva = Number(fiscal.iva_alicuota_general) / 100
  const tasasSinIva = (medios ?? [])
    .filter((m) => m.mp_payment_type != null || m.mp_channel != null)
    .map((m) => Number(m.comision_porcentaje))
    .filter((c) => Number.isFinite(c) && c > 0)
    .map((c) => c / 100 / (1 + iva))
  const tasaMp = tasasSinIva.length > 0 ? seleccionarPeorTasa(tasasSinIva) : 0

  const config = {
    iva,
    iibb: Number(fiscal.iibb_alicuota) / 100,
    debcred: (debcredPct != null ? Number(debcredPct) : 1.2) / 100,
    tasaMp,
    redondeoMultiplo: redondeo != null ? Number(redondeo) : 50,
  }
  const regimen: RegimenFiscal =
    fiscal.condicion_iva === 'monotributista'
      ? 'monotributista'
      : 'responsable_inscripto'

  console.log('── Config del motor (desde la DB) ──')
  console.log(`  régimen:            ${regimen}`)
  console.log(`  IVA:                ${(config.iva * 100).toFixed(2)}%`)
  console.log(`  IIBB:               ${(config.iibb * 100).toFixed(2)}%`)
  console.log(`  imp. créd/déb:      ${(config.debcred * 100).toFixed(2)}%`)
  console.log(
    `  comisión MP (peor): ${(config.tasaMp * 100).toFixed(4)}% sin IVA` +
      ` → ${(config.tasaMp * (1 + config.iva) * 100).toFixed(4)}% efectiva`
  )
  console.log(`  redondeo múltiplo:  $${config.redondeoMultiplo}`)
  console.log('')

  // 2. Productos activos con su costo (embed gateado, visible con service role).
  type ProdRow = {
    id: number
    nombre: string
    precio_venta: number
    margen: number
    iva_compra: number
    costos_producto: { precio_costo: number } | { precio_costo: number }[] | null
  }
  const productos: ProdRow[] = []
  const pageSize = 1000
  for (let desde = 0; ; desde += pageSize) {
    const { data, error } = await supabase
      .from('productos')
      .select('id, nombre, precio_venta, margen, iva_compra, costos_producto(precio_costo)')
      .eq('activo', true)
      .order('id', { ascending: true })
      .range(desde, desde + pageSize - 1)
    if (error) throw error
    const filas = (data ?? []) as unknown as ProdRow[]
    productos.push(...filas)
    if (filas.length < pageSize) break
  }

  const costoDe = (p: ProdRow): number => {
    const c = p.costos_producto
    if (!c) return 0
    const fila = Array.isArray(c) ? c[0] : c
    return Number(fila?.precio_costo ?? 0)
  }

  // 3. Recalcular y comparar.
  //
  // Como casi ningún producto tiene un `margen` guardado, el margen objetivo se
  // INFIERE del precio actual: el markup bruto que ya está metido en el precio
  // (precio neto / costo − 1). Re-priceamos para que ESE mismo margen quede
  // asegurado NETO de cargas. Con `--margen=40` se puede forzar un objetivo
  // plano para todos en lugar de inferirlo.
  const argMargen = process.argv.find((a) => a.startsWith('--margen='))
  const margenFlat = argMargen ? Number(argMargen.split('=')[1]) : null
  if (margenFlat != null && !(margenFlat > 0)) {
    throw new Error(`--margen debe ser > 0 (recibido: ${argMargen})`)
  }

  const comEf = config.tasaMp * (1 + config.iva)
  const cargas = config.iibb + config.debcred + comEf

  /** Ganancia neta y margen % que un precio final DEJA hoy, tras las cargas. */
  function margenNetoActual(precioFinal: number, costo: number) {
    const base =
      regimen === 'monotributista' ? precioFinal : precioFinal / (1 + config.iva)
    const ganancia = base - costo - precioFinal * cargas
    return { ganancia, margenPct: costo > 0 ? (ganancia / costo) * 100 : 0 }
  }

  interface Fila {
    id: number
    nombre: string
    costo: number
    /** Margen bruto (markup) embebido en el precio actual, %. */
    margenBrutoActual: number
    /** Margen NETO que el precio actual deja hoy tras las cargas, %. */
    margenNetoActual: number
    /** Margen objetivo que se asegura con el motor (inferido o plano), %. */
    margenObjetivo: number
    precioViejo: number
    precioNuevoExacto: number
    precioNuevo: number
    deltaAbs: number
    deltaPct: number | null
  }
  const filas: Fila[] = []
  const saltados: { id: number; nombre: string; motivo: string }[] = []
  let bajoAgua = 0 // productos cuyo precio actual da margen neto < 0 (pérdida)

  for (const p of productos) {
    const costoNeto = costoDe(p)
    if (!(costoNeto > 0)) {
      saltados.push({ id: p.id, nombre: p.nombre, motivo: 'sin costo' })
      continue
    }
    const costo =
      regimen === 'monotributista'
        ? costoNeto * (1 + Number(p.iva_compra ?? 21) / 100)
        : costoNeto

    const precioViejo = Number(p.precio_venta)
    if (!(precioViejo > 0)) {
      saltados.push({ id: p.id, nombre: p.nombre, motivo: 'sin precio actual' })
      continue
    }

    const netoViejo =
      regimen === 'monotributista' ? precioViejo : precioViejo / (1 + config.iva)
    const margenBruto = (netoViejo / costo - 1) * 100
    const neto = margenNetoActual(precioViejo, costo)
    if (neto.margenPct < 0) bajoAgua++

    const objetivo = margenFlat != null ? margenFlat : margenBruto
    if (!(objetivo > 0)) {
      saltados.push({
        id: p.id,
        nombre: p.nombre,
        motivo: 'margen implícito ≤ 0 (precio actual ≤ costo)',
      })
      continue
    }

    try {
      const d = calcularPrecio({ regimen, costo, margen: objetivo / 100 }, config)
      filas.push({
        id: p.id,
        nombre: p.nombre,
        costo: r2(costoNeto),
        margenBrutoActual: r2(margenBruto),
        margenNetoActual: r2(neto.margenPct),
        margenObjetivo: r2(objetivo),
        precioViejo: r2(precioViejo),
        precioNuevoExacto: r2(d.precioFinalExacto),
        precioNuevo: d.precioRedondeado,
        deltaAbs: r2(d.precioRedondeado - precioViejo),
        deltaPct: r2(((d.precioRedondeado - precioViejo) / precioViejo) * 100),
      })
    } catch (e) {
      saltados.push({
        id: p.id,
        nombre: p.nombre,
        motivo: e instanceof Error ? e.message : 'error de cálculo',
      })
    }
  }

  // 4. CSV.
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`
  const encabezado = [
    'id',
    'nombre',
    'costo_neto',
    'margen_bruto_actual_%',
    'margen_neto_actual_%',
    'margen_objetivo_%',
    'precio_viejo',
    'precio_nuevo_exacto',
    'precio_nuevo_redondeado',
    'delta_$',
    'delta_%',
  ].join(',')
  const cuerpo = filas
    .map((f) =>
      [
        f.id,
        esc(f.nombre),
        f.costo,
        f.margenBrutoActual,
        f.margenNetoActual,
        f.margenObjetivo,
        f.precioViejo,
        f.precioNuevoExacto,
        f.precioNuevo,
        f.deltaAbs,
        f.deltaPct ?? '',
      ].join(',')
    )
    .join('\n')
  const rutaCsv = 'reporte-precios.csv'
  writeFileSync(rutaCsv, `${encabezado}\n${cuerpo}\n`, 'utf8')

  // 5. Resumen en consola.
  const prom = (sel: (f: Fila) => number) =>
    filas.length > 0 ? filas.reduce((s, f) => s + sel(f), 0) / filas.length : 0
  const suben = filas.filter((f) => f.deltaAbs > 0.005)
  const bajan = filas.filter((f) => f.deltaAbs < -0.005)
  const igual = filas.length - suben.length - bajan.length

  console.log('── Resumen ──')
  console.log(`  base del margen objetivo: ${margenFlat != null ? `plano ${margenFlat}%` : 'inferido del precio actual'}`)
  console.log(`  productos recalculados:   ${filas.length}`)
  console.log(`  saltados:                 ${saltados.length}`)
  console.log(`    · sin costo:            ${saltados.filter((s) => s.motivo === 'sin costo').length}`)
  console.log(`    · sin precio actual:    ${saltados.filter((s) => s.motivo === 'sin precio actual').length}`)
  console.log(`    · precio ≤ costo:       ${saltados.filter((s) => s.motivo.startsWith('margen implícito')).length}`)
  console.log('')
  console.log(`  margen NETO promedio HOY (tras cargas): ${prom((f) => f.margenNetoActual).toFixed(2)}%`)
  console.log(`  margen bruto promedio (markup actual):  ${prom((f) => f.margenBrutoActual).toFixed(2)}%`)
  console.log(`  productos EN PÉRDIDA hoy (neto < 0):     ${bajoAgua}`)
  console.log('')
  console.log(`  con el motor → suben: ${suben.length}   bajan: ${bajan.length}   igual: ${igual}`)
  console.log(`  variación de precio promedio: ${prom((f) => f.deltaPct ?? 0) >= 0 ? '+' : ''}${prom((f) => f.deltaPct ?? 0).toFixed(2)}%`)
  console.log('')

  const mayores = [...filas]
    .sort((a, b) => Math.abs(b.deltaPct ?? 0) - Math.abs(a.deltaPct ?? 0))
    .slice(0, 15)
  console.log('── Mayores variaciones (top 15) ──')
  console.log('  id     m.neto hoy   precio viejo →  precio nuevo    Δ$        Δ%     producto')
  for (const f of mayores) {
    console.log(
      `  ${String(f.id).padEnd(6)} ${`${f.margenNetoActual}%`.padStart(9)}   ` +
        `${String(f.precioViejo).padStart(11)} → ${String(f.precioNuevo).padStart(11)}  ` +
        `${String(f.deltaAbs).padStart(9)}  ${(f.deltaPct ?? 0).toFixed(1).padStart(6)}%  ` +
        `${f.nombre.slice(0, 34)}`
    )
  }
  console.log('')
  console.log(`CSV completo escrito en: ${rutaCsv}`)

  // 6. Aplicación (solo con --aplicar y migración 108 corrida).
  const aplicar = process.argv.includes('--aplicar')
  if (!aplicar) {
    console.log('Esto es un DRY RUN: no se modificó ningún precio.')
    console.log('Para aplicar: node scripts/reporte-precios.ts --aplicar')
    return
  }

  if (faltaMig108) {
    throw new Error(
      'No se puede aplicar sin la migración 108 (config_fiscal.impuesto_deb_cred_alicuota / ' +
        'redondeo_multiplo). Corré 108_pricing_config.sql en Supabase primero para que ' +
        'el motor use la config real y no los defaults.'
    )
  }

  // Exclusión de ítems baratos: el techo a $50 distorsiona los precios chicos
  // (una gomita suelta de $5.83 no puede pasar a $50). Se dejan como están
  // para definirlos a mano (bolsita / venta por peso / precio manual).
  const argExcluir = process.argv.find((a) => a.startsWith('--excluir-menores='))
  const umbralExcluir = argExcluir ? Number(argExcluir.split('=')[1]) : null
  let aAplicar = filas
  if (umbralExcluir != null) {
    if (!(umbralExcluir > 0)) {
      throw new Error(`--excluir-menores debe ser > 0 (recibido: ${argExcluir})`)
    }
    const excluidos = filas.filter((f) => f.precioViejo < umbralExcluir)
    aAplicar = filas.filter((f) => f.precioViejo >= umbralExcluir)
    console.log('')
    console.log(
      `── Excluidos por precio actual < $${umbralExcluir} (${excluidos.length}, quedan como están) ──`
    )
    for (const f of excluidos) {
      console.log(
        `  #${String(f.id).padEnd(5)} $${String(f.precioViejo).padStart(7)}  ${f.nombre.slice(0, 50)}`
      )
    }
  }

  console.log('')
  console.log(`⏳ Aplicando ${aAplicar.length} precios nuevos (precio_venta + margen)…`)
  const ahora = new Date().toISOString()
  let ok = 0
  let err = 0
  const primerosErrores: string[] = []
  const lote = 40
  for (let i = 0; i < aAplicar.length; i += lote) {
    const bloque = aAplicar.slice(i, i + lote)
    const res = await Promise.all(
      bloque.map((f) =>
        supabase
          .from('productos')
          .update({
            precio_venta: f.precioNuevo,
            margen: f.margenObjetivo,
            pendiente_precio: false,
            updated_at: ahora,
          })
          .eq('id', f.id)
      )
    )
    res.forEach((r, j) => {
      if (r.error) {
        err++
        if (primerosErrores.length < 5) {
          primerosErrores.push(`  id ${bloque[j].id}: ${r.error.message}`)
        }
      } else {
        ok++
      }
    })
    process.stdout.write(`\r  ${Math.min(i + lote, aAplicar.length)}/${aAplicar.length}`)
  }
  console.log('')
  console.log(`✔ actualizados: ${ok}   errores: ${err}`)
  if (primerosErrores.length > 0) {
    console.log('Primeros errores:')
    primerosErrores.forEach((e) => console.log(e))
  }
  console.log(
    'El CSV con los precios viejos queda como respaldo (columna precio_viejo).'
  )
}

main().catch((e) => {
  console.error('Error:', e instanceof Error ? e.message : e)
  process.exit(1)
})
