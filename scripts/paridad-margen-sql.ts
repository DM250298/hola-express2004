// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Paridad del motor INVERSO: SQL (fn_margen_desde_precio) vs TS         ║
// ║  (lib/pricing/motor.ts calcularDesdePrecio)                            ║
// ║                                                                        ║
// ║  El modo inverso (precio → margen neto) vive en dos lugares: TS (el    ║
// ║  Drawer de productos, modo "por precio") y SQL (fn_margen_desde_precio,║
// ║  usado por fn_importar_productos v3 cuando una fila trae precio + costo║
// ║  sin margen — migración 125). Este script verifica que AMBOS deduzcan  ║
// ║  el MISMO margen sobre una grilla de inputs (incluye precios por debajo║
// ║  del costo → margen negativo), leyendo la misma config viva            ║
// ║  (config_fiscal + medios_pago).                                        ║
// ║                                                                        ║
// ║  Complemento de paridad-precio-sql.ts (que cubre el sentido directo).  ║
// ║                                                                        ║
// ║  Uso (después de correr la migración 125):                             ║
// ║    node scripts/paridad-margen-sql.ts                                  ║
// ║                                                                        ║
// ║  Solo lectura. Sale con código 1 si hay CUALQUIER divergencia.         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { calcularDesdePrecio, seleccionarPeorTasa } from '../lib/pricing/motor.ts'
import type { ConfigPricing, RegimenFiscal } from '../lib/pricing/tipos.ts'

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
    let valor = limpia.slice(i + 1).trim()
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1)
    }
    out[limpia.slice(0, i).trim()] = valor
  }
  return out
}

const env = { ...cargarEnv('.env.local'), ...process.env }
const url = env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local')
  process.exit(1)
}
const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const r2 = (n: number) => Math.round(n * 100) / 100

async function main() {
  // Config viva, igual que el motor TS y fn_margen_desde_precio.
  const { data: fiscal, error: eF } = await supabase
    .from('config_fiscal').select('*').eq('id', 1).single()
  if (eF || !fiscal) throw eF ?? new Error('No hay config_fiscal.')
  const { data: medios, error: eM } = await supabase
    .from('medios_pago').select('comision_porcentaje, mp_payment_type, mp_channel')
  if (eM) throw eM

  const iva = Number(fiscal.iva_alicuota_general) / 100
  const tasas = (medios ?? [])
    .filter((m) => m.mp_payment_type != null || m.mp_channel != null)
    .map((m) => Number(m.comision_porcentaje))
    .filter((c) => Number.isFinite(c) && c > 0)
    .map((c) => c / 100 / (1 + iva))
  const config: ConfigPricing = {
    iva,
    iibb: Number(fiscal.iibb_alicuota) / 100,
    debcred: Number(fiscal.impuesto_deb_cred_alicuota) / 100,
    tasaMp: tasas.length ? seleccionarPeorTasa(tasas) : 0,
    redondeoMultiplo: Number(fiscal.redondeo_multiplo),
  }
  const regimen: RegimenFiscal =
    fiscal.condicion_iva === 'monotributista' ? 'monotributista' : 'responsable_inscripto'

  // Grilla: costos × factores de precio (incluye por debajo del costo) × IVAs.
  const costos = [100, 250, 500, 785.71, 1000, 1500, 2000, 3500, 5000, 12000]
  const factores = [0.8, 1.0, 1.3, 1.7, 2.0, 2.5, 3.0]
  const ivas = [21, 10.5]
  const casos: { costo: number; precio: number; ivaPct: number }[] = []
  for (const costo of costos)
    for (const f of factores)
      for (const ivaPct of ivas)
        casos.push({ costo, precio: r2(costo * f), ivaPct })

  let ok = 0
  let peor = 0
  const fallos: string[] = []
  const lote = 25
  for (let i = 0; i < casos.length; i += lote) {
    const bloque = casos.slice(i, i + lote)
    const res = await Promise.all(
      bloque.map((c) =>
        supabase.rpc('fn_margen_desde_precio', {
          p_costo: c.costo, p_precio_final: c.precio, p_iva_venta_pct: c.ivaPct,
        })
      )
    )
    res.forEach((r, j) => {
      const c = bloque[j]
      if (r.error) {
        fallos.push(`RPC error (${c.costo}/${c.precio}/${c.ivaPct}): ${r.error.message}`)
        return
      }
      const sql = Number(r.data)
      const ts = r2(
        (calcularDesdePrecio(
          c.precio, { regimen, costo: c.costo, ivaVenta: c.ivaPct / 100 }, config
        ).margen ?? 0) * 100
      )
      const dif = Math.abs(sql - ts)
      peor = Math.max(peor, dif)
      if (dif < 0.01) ok++
      else if (fallos.length < 12)
        fallos.push(`  costo ${c.costo} precio ${c.precio} iva ${c.ivaPct}%: SQL ${sql}% vs TS ${ts}%  (dif ${dif.toFixed(3)})`)
    })
  }

  console.log('── Paridad fn_margen_desde_precio (SQL) vs calcularDesdePrecio (TS) ──')
  console.log(`  casos:           ${casos.length}`)
  console.log(`  ✔ coinciden:     ${ok}`)
  console.log(`  ✗ difieren:      ${casos.length - ok}`)
  console.log(`  peor diferencia: ${peor.toFixed(4)} puntos de %`)
  if (fallos.length) {
    console.log('\n  Detalle:')
    fallos.forEach((f) => console.log(f))
  }
  console.log('')

  if (ok !== casos.length) {
    console.error('⚠️ Hay divergencias entre el SQL y el TS.')
    process.exit(1)
  }
  console.log('✅ Paridad total: el importador deduce el mismo margen que el drawer, al centavo.')
}

main().catch((e) => {
  console.error('Error:', e instanceof Error ? e.message : e)
  process.exit(1)
})
