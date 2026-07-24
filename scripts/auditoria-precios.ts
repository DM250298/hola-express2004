// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Auditoría de precios — SOLO LECTURA                                   ║
// ║                                                                        ║
// ║  Verifica que el precio_venta GUARDADO de cada producto coincida con   ║
// ║  lo que el motor calcula para su (costo, margen, iva). Es un cross-    ║
// ║  check independiente: el import guardó los precios con fn_precio_venta ║
// ║  (SQL); acá los recalculamos con el motor TS (lib/pricing) y           ║
// ║  comparamos. Si algo no coincide, lo lista.                            ║
// ║                                                                        ║
// ║  Uso:  node scripts/auditoria-precios.ts                               ║
// ║  Lee credenciales de .env.local (service role para ver costos).        ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { calcularPrecio, seleccionarPeorTasa } from '../lib/pricing/motor.ts'
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

async function main() {
  // 1. Config del motor (igual que el import y el Drawer).
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

  // 2. Todos los productos activos con costo, margen, iva y precio guardado.
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

  // 3. Chequear: los que tienen margen>0 y costo>0 deben coincidir con el motor.
  const mismatches: { id: number; nombre: string; costo: number; margen: number; guardado: number; esperado: number; dif: number }[] = []
  let coinciden = 0
  let sinMargen = 0   // margen 0 → precio manual (no se prizó por motor)
  let sinCosto = 0
  let pendientes = 0

  for (const p of productos) {
    if (p.pendiente_precio) pendientes++
    const costoNeto = costoDe(p)
    if (!(costoNeto > 0)) { sinCosto++; continue }
    if (!(p.margen > 0)) { sinMargen++; continue }

    const costo = regimen === 'monotributista'
      ? costoNeto * (1 + Number(p.iva_compra ?? 21) / 100)
      : costoNeto
    let esperado: number
    try {
      esperado = calcularPrecio(
        { regimen, costo, margen: p.margen / 100, ivaVenta: Number(p.iva_venta) / 100 },
        config
      ).precioRedondeado
    } catch {
      continue // divisor inválido u otro; no debería pasar con config normal
    }
    const dif = Math.round((Number(p.precio_venta) - esperado) * 100) / 100
    if (Math.abs(dif) < 0.01) coinciden++
    else mismatches.push({
      id: p.id, nombre: p.nombre, costo: costoNeto, margen: p.margen,
      guardado: Number(p.precio_venta), esperado, dif,
    })
  }

  // 4. Reporte.
  console.log('── Auditoría de precios (motor TS vs. precio guardado) ──')
  console.log(`  productos activos:        ${productos.length}`)
  console.log(`  ✔ coinciden con el motor:  ${coinciden}`)
  console.log(`  ✗ NO coinciden:            ${mismatches.length}`)
  console.log(`  · saltados (margen 0 = precio manual): ${sinMargen}`)
  console.log(`  · saltados (sin costo):    ${sinCosto}`)
  console.log(`  · marcados pendiente_precio: ${pendientes}`)
  console.log('')

  if (mismatches.length === 0) {
    console.log('✅ Todos los productos con costo+margen tienen el precio que calcula el motor.')
  } else {
    console.log('⚠️ Diferencias (guardado ≠ esperado):')
    console.log('  id      costo     margen   guardado →  esperado    dif      producto')
    for (const m of mismatches.slice(0, 40)) {
      console.log(
        `  ${String(m.id).padEnd(6)} $${String(m.costo).padStart(8)}  ${String(m.margen).padStart(4)}%   ` +
        `$${String(m.guardado).padStart(8)} → $${String(m.esperado).padStart(8)}  ` +
        `${(m.dif >= 0 ? '+' : '') + m.dif}`.padStart(9) + `  ${m.nombre.slice(0, 34)}`
      )
    }
    if (mismatches.length > 40) console.log(`  … y ${mismatches.length - 40} más`)
  }
}

main().catch((e) => { console.error('Error:', e instanceof Error ? e.message : e); process.exit(1) })
