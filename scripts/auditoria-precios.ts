// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Auditoría de precios — SOLO LECTURA                                   ║
// ║                                                                        ║
// ║  Verifica que cada producto sea CONSISTENTE con el motor de pricing,   ║
// ║  contemplando los DOS modos de carga:                                  ║
// ║    · directo (costo+margen → precio): el precio guardado debe ser el   ║
// ║      redondeado que calcula el motor para ese (costo, margen).         ║
// ║    · inverso (precio → margen): el margen guardado debe ser el que el  ║
// ║      motor DEDUCE del precio guardado (el precio queda tal cual se     ║
// ║      cargó, sin redondear a la grilla de $50).                         ║
// ║  Un producto está OK si cumple CUALQUIERA de los dos (así lo dejó su   ║
// ║  forma de carga). Solo se listan los que fallan LOS DOS.               ║
// ║                                                                        ║
// ║  Uso:  node scripts/auditoria-precios.ts                               ║
// ║  Lee credenciales de .env.local (service role para ver costos).        ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { calcularDesdePrecio, calcularPrecio, seleccionarPeorTasa } from '../lib/pricing/motor.ts'
import type { RegimenFiscal } from '../lib/pricing/tipos.ts'

function cargarEnv(ruta: string): Record<string, string> {
  const out: Record<string, string> = {}
  let contenido: string
  try { contenido = readFileSync(ruta, 'utf8') } catch { return out }
  for (const linea of contenido.split(/\r?\n/)) {
    const s = linea.trim()
    if (!s || s.startsWith('#')) continue
    const i = s.indexOf('=')
    if (i === -1) continue
    let v = s.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[s.slice(0, i).trim()] = v
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
const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const r2 = (n: number) => Math.round(n * 100) / 100

async function main() {
  const { data: fiscal, error: eF } = await supabase.from('config_fiscal').select('*').eq('id', 1).single()
  if (eF || !fiscal) throw eF ?? new Error('No hay config_fiscal.')
  const { data: medios, error: eM } = await supabase
    .from('medios_pago').select('comision_porcentaje, mp_payment_type, mp_channel')
  if (eM) throw eM

  const iva = Number(fiscal.iva_alicuota_general) / 100
  const tasasSinIva = (medios ?? [])
    .filter((m) => m.mp_payment_type != null || m.mp_channel != null)
    .map((m) => Number(m.comision_porcentaje))
    .filter((c) => Number.isFinite(c) && c > 0)
    .map((c) => c / 100 / (1 + iva))
  const config = {
    iva,
    iibb: Number(fiscal.iibb_alicuota) / 100,
    debcred: (fiscal.impuesto_deb_cred_alicuota != null ? Number(fiscal.impuesto_deb_cred_alicuota) : 1.2) / 100,
    tasaMp: tasasSinIva.length > 0 ? seleccionarPeorTasa(tasasSinIva) : 0,
    redondeoMultiplo: fiscal.redondeo_multiplo != null ? Number(fiscal.redondeo_multiplo) : 50,
  }
  const regimen: RegimenFiscal =
    fiscal.condicion_iva === 'monotributista' ? 'monotributista' : 'responsable_inscripto'

  type Prod = {
    id: number; nombre: string; precio_venta: number; margen: number; iva_venta: number
    iva_compra: number; pendiente_precio: boolean
    costos_producto: { precio_costo: number } | { precio_costo: number }[] | null
  }
  const productos: Prod[] = []
  const pageSize = 1000
  for (let desde = 0; ; desde += pageSize) {
    const { data, error } = await supabase
      .from('productos')
      .select('id, nombre, precio_venta, margen, iva_venta, iva_compra, pendiente_precio, costos_producto(precio_costo)')
      .eq('activo', true)
      .order('id', { ascending: true })
      .range(desde, desde + pageSize - 1)
    if (error) throw error
    const filas = (data ?? []) as unknown as Prod[]
    productos.push(...filas)
    if (filas.length < pageSize) break
  }
  const costoDe = (p: Prod): number => {
    const c = p.costos_producto
    if (!c) return 0
    const f = Array.isArray(c) ? c[0] : c
    return Number(f?.precio_costo ?? 0)
  }

  const inconsistentes: {
    id: number; nombre: string; costo: number; margen: number; precio: number
    precioDirecto: number; margenInverso: number
  }[] = []
  let porDirecto = 0
  let porInverso = 0
  let sinMargen = 0
  let sinCosto = 0

  for (const p of productos) {
    const costoNeto = costoDe(p)
    if (!(costoNeto > 0)) { sinCosto++; continue }
    if (!(p.margen > 0)) { sinMargen++; continue }

    const costo = regimen === 'monotributista'
      ? costoNeto * (1 + Number(p.iva_compra ?? 21) / 100)
      : costoNeto
    const ivaVenta = Number(p.iva_venta) / 100
    const precio = Number(p.precio_venta)

    let precioDirecto = NaN
    let margenInverso = NaN
    try {
      // Modo DIRECTO: el precio debe ser el redondeado del motor para (costo, margen).
      precioDirecto = calcularPrecio({ regimen, costo, margen: p.margen / 100, ivaVenta }, config).precioRedondeado
      // Modo INVERSO: el margen debe ser el que el motor deduce del precio guardado.
      margenInverso = r2(calcularDesdePrecio(precio, { regimen, costo, ivaVenta }, config).margen * 100)
    } catch {
      continue
    }

    const okDirecto = Math.abs(precio - precioDirecto) < 0.5
    const okInverso = Math.abs(margenInverso - p.margen) < 0.02

    if (okDirecto) porDirecto++
    else if (okInverso) porInverso++
    else
      inconsistentes.push({
        id: p.id, nombre: p.nombre, costo: costoNeto, margen: p.margen, precio,
        precioDirecto, margenInverso,
      })
  }

  const consistentes = porDirecto + porInverso
  console.log('── Auditoría de precios (motor · directo o inverso) ──')
  console.log(`  productos activos:         ${productos.length}`)
  console.log(`  ✔ consistentes:            ${consistentes}`)
  console.log(`      · por modo directo (costo+margen→precio):  ${porDirecto}`)
  console.log(`      · por modo inverso (precio→margen):        ${porInverso}`)
  console.log(`  ✗ INCONSISTENTES (fallan los dos): ${inconsistentes.length}`)
  console.log(`  · saltados (margen 0 = precio manual): ${sinMargen}`)
  console.log(`  · saltados (sin costo):    ${sinCosto}`)
  console.log('')

  if (inconsistentes.length === 0) {
    console.log('✅ Todo el catálogo con costo+margen es consistente con el motor (por directo o inverso).')
  } else {
    console.log('⚠️ Inconsistentes (ni el precio sale del margen, ni el margen del precio):')
    console.log('  id      costo      margen   precio guard.   precio directo   margen inverso   producto')
    for (const m of inconsistentes.slice(0, 50)) {
      console.log(
        `  ${String(m.id).padEnd(6)} $${String(r2(m.costo)).padStart(9)}  ${String(m.margen).padStart(6)}%  ` +
        `$${String(r2(m.precio)).padStart(10)}   $${String(r2(m.precioDirecto)).padStart(10)}   ${String(r2(m.margenInverso)).padStart(7)}%   ` +
        `${m.nombre.slice(0, 30)}`
      )
    }
    if (inconsistentes.length > 50) console.log(`  … y ${inconsistentes.length - 50} más`)
  }
}

main().catch((e) => { console.error('Error:', e instanceof Error ? e.message : e); process.exit(1) })
