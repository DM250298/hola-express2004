// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Paridad del motor de precios: SQL (fn_precio_venta) vs TS            ║
// ║  (lib/pricing/motor.ts)                                                ║
// ║                                                                        ║
// ║  El motor vive en dos lugares: TS (previews de UI, reportes) y SQL     ║
// ║  (fn_precio_venta, usado por fn_guardar_factura_compra al cargar       ║
// ║  facturas — migración 109). Este script verifica que AMBOS den el      ║
// ║  MISMO precio redondeado sobre una grilla de inputs, leyendo la        ║
// ║  misma config viva (config_fiscal + medios_pago).                      ║
// ║                                                                        ║
// ║  Uso (después de correr la migración 109):                             ║
// ║    node scripts/paridad-precio-sql.ts                                  ║
// ║                                                                        ║
// ║  Solo lectura. Sale con código 1 si hay CUALQUIER divergencia.         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { calcularPrecio } from '../lib/pricing/motor.ts'
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
    out[limpia.slice(0, i).trim()] = limpia.slice(i + 1).trim()
  }
  return out
}

const env = { ...cargarEnv('.env.local'), ...process.env }
const url = env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Faltan credenciales de Supabase en .env.local')
  process.exit(1)
}
const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main() {
  // Config viva, armada igual que lib/pricing/config.ts y que fn_precio_venta.
  const { data: fiscal, error: eF } = await supabase
    .from('config_fiscal')
    .select('*')
    .eq('id', 1)
    .single()
  if (eF || !fiscal) throw eF ?? new Error('No hay config_fiscal.')
  if (fiscal.impuesto_deb_cred_alicuota == null || fiscal.redondeo_multiplo == null) {
    throw new Error('Falta la migración 108 (columnas de pricing en config_fiscal).')
  }

  const { data: medios, error: eM } = await supabase
    .from('medios_pago')
    .select('comision_porcentaje, mp_payment_type, mp_channel')
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
    tasaMp: tasas.length > 0 ? Math.max(...tasas) : 0,
    redondeoMultiplo: Number(fiscal.redondeo_multiplo),
  }
  const regimen: RegimenFiscal =
    fiscal.condicion_iva === 'monotributista'
      ? 'monotributista'
      : 'responsable_inscripto'

  // Grilla determinística: costos reales del negocio + bordes.
  const COSTOS = [0.5, 10, 99.99, 649.35, 1852.87, 10000, 123456.78]
  const MARGENES = [0, 5, 28.7, 30, 40, 56.94, 100, 200]
  const IVAS_VENTA: (number | null)[] = [null, 0, 10.5, 21, 27]

  interface Caso {
    costo: number
    margen: number
    ivaVenta: number | null
  }
  const casos: Caso[] = []
  for (const costo of COSTOS)
    for (const margen of MARGENES)
      for (const ivaVenta of IVAS_VENTA) casos.push({ costo, margen, ivaVenta })

  console.log(
    `Comparando ${casos.length} casos · régimen ${regimen} · ` +
      `comisión MP peor caso ${(config.tasaMp * (1 + iva) * 100).toFixed(4)}% efectiva · ` +
      `múltiplo $${config.redondeoMultiplo}`
  )

  let ok = 0
  const divergencias: string[] = []
  const lote = 40
  for (let i = 0; i < casos.length; i += lote) {
    const bloque = casos.slice(i, i + lote)
    const res = await Promise.all(
      bloque.map((c) =>
        supabase.rpc('fn_precio_venta', {
          p_costo: c.costo,
          p_margen_pct: c.margen,
          ...(c.ivaVenta != null ? { p_iva_venta_pct: c.ivaVenta } : {}),
        })
      )
    )
    res.forEach((r, j) => {
      const c = bloque[j]
      if (r.error) {
        divergencias.push(
          `costo=${c.costo} margen=${c.margen}% iva=${c.ivaVenta ?? 'gral'}: ERROR SQL ${r.error.message}`
        )
        return
      }
      const sql = Number(r.data)
      const ts = calcularPrecio(
        {
          regimen,
          costo: c.costo,
          margen: c.margen / 100,
          ivaVenta: c.ivaVenta != null ? c.ivaVenta / 100 : undefined,
        },
        config
      ).precioRedondeado
      if (Math.abs(sql - ts) < 0.005) {
        ok++
      } else {
        divergencias.push(
          `costo=${c.costo} margen=${c.margen}% iva=${c.ivaVenta ?? 'gral'}: SQL=${sql} vs TS=${ts}`
        )
      }
    })
    process.stdout.write(`\r  ${Math.min(i + lote, casos.length)}/${casos.length}`)
  }
  console.log('')
  console.log(`✔ coinciden: ${ok}/${casos.length}`)
  if (divergencias.length > 0) {
    console.error(`✘ divergencias: ${divergencias.length}`)
    divergencias.slice(0, 20).forEach((d) => console.error(`  ${d}`))
    process.exit(1)
  }
  console.log('Paridad SQL ↔ TS confirmada.')
}

main().catch((e) => {
  console.error('Error:', e instanceof Error ? e.message : e)
  process.exit(1)
})
