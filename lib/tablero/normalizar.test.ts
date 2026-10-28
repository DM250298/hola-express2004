// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Tests de la normalización del JSON del tablero (mig 318, v3)          ║
// ║                                                                        ║
// ║  Runner: node --test (Node 24 corre TS nativo por type-stripping).     ║
// ║    node --test lib/tablero/normalizar.test.ts                          ║
// ║                                                                        ║
// ║  Dos contratos conviven: el JSON viejo (sin las claves del margen      ║
// ║  neto) tiene que llegar a la pantalla con `null` y régimen RI, y el   ║
// ║  JSON v3 tiene que pasar intacto.                                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizarTablero } from './normalizar.ts'

const BASE = {
  generado_at: '2026-10-28T12:00:00Z',
  hoy: '2026-10-28',
  periodo: {
    desde: '2026-10-01',
    hasta: '2026-10-28',
    dias: 28,
    anterior_desde: '2026-09-03',
    anterior_hasta: '2026-09-30',
  },
  puede_ver_costos: true,
  ventas: {
    hoy: 1000,
    hoy_tickets: 10,
    ayer: 2000,
    ayer_semana_anterior: 1800,
    semana: 14000,
    semana_anterior: 13000,
    mes: 50000,
    mes_anterior_mismo_tramo: 48000,
    periodo: 50000,
    periodo_tickets: 500,
    ticket_promedio: 100,
    periodo_anterior: 48000,
  },
  inventario: {
    valorizado: 90000,
    inmovilizado: 5000,
    skus_inmovilizados: 12,
    dias_inventario: 30,
  },
  quiebres: {
    activos: 2,
    criticos_activos: 1,
    eventos_periodo: 5,
    horas_periodo: 40,
    perdida_periodo: 3000,
  },
  concentracion: { skus_80: 40, skus_total: 300, criterio: 'margen' },
  mapeo: { productos_activos: 300, ubicados: 200 },
  lotes_por_vencer: 3,
  situaciones: {
    criticos_sin_stock: { cantidad: 1, por_categoria: [{ categoria: 'Lácteos', cantidad: 1 }] },
    a_por_quebrar: { cantidad: 0, por_categoria: [] },
    margen_negativo: { cantidad: 2 },
  },
  ultimo_snapshot: '2026-10-27',
}

test('JSON viejo (sin la 318): claves nuevas en null y régimen RI', () => {
  const viejo = {
    ...BASE,
    margen: {
      ingresos: 50000,
      costo: 30000,
      margen: 20000,
      margen_pct: 40,
      anterior_margen: 19000,
      anterior_margen_pct: 39.5,
      estimado: false,
    },
    serie: [
      { fecha: '2026-10-01', ventas: 1000, tickets: 10, ingresos: 1000, margen: 400 },
      { fecha: '2026-10-02', ventas: 1200, tickets: 12, ingresos: 1200, margen: null },
    ],
    top_skus: [
      {
        producto_id: 1,
        nombre: 'Coca 1.5',
        valor: 500,
        ingresos: 1500,
        margen_pesos: 500,
        margen_pct: 33.3,
        participacion: 2.5,
      },
    ],
    gondolas: [
      {
        nombre: 'Góndola 1',
        skus: 20,
        ingresos: 9000,
        margen: 3000,
        margen_pct: 33.3,
        stock_valorizado: 20000,
        quiebres: 1,
        sin_movimiento: 2,
      },
    ],
  }

  const t = normalizarTablero(viejo)

  assert.equal(t.margen.ingresos_netos, null)
  assert.equal(t.margen.iva, null)
  assert.equal(t.margen.devoluciones, null)
  assert.equal(t.margen.anterior_ingresos_netos, null)
  assert.equal(t.margen.regimen, 'responsable_inscripto')
  // Lo viejo se respeta.
  assert.equal(t.margen.ingresos, 50000)
  assert.equal(t.margen.margen, 20000)
  assert.equal(t.margen.margen_pct, 40)
  assert.equal(t.margen.estimado, false)

  assert.equal(t.serie.length, 2)
  for (const p of t.serie) {
    assert.equal(p.ingresos_netos, null)
    assert.equal(p.devoluciones, null)
  }
  assert.equal(t.serie[0].margen, 400)
  assert.equal(t.serie[1].margen, null)

  assert.equal(t.top_skus[0].ingresos_netos, null)
  assert.equal(t.top_skus[0].valor, 500)
  assert.equal(t.gondolas[0].ingresos_netos, null)
  assert.equal(t.gondolas[0].margen_pct, 33.3)

  // El resto del tablero pasa sin tocar.
  assert.equal(t.puede_ver_costos, true)
  assert.equal(t.ventas.periodo, 50000)
  assert.deepEqual(t.concentracion, { skus_80: 40, skus_total: 300, criterio: 'margen' })
  assert.equal(t.ultimo_snapshot, '2026-10-27')
})

test('JSON v3 (con la 318): se respeta todo, incluido el régimen', () => {
  const v3 = {
    ...BASE,
    margen: {
      version: 3,
      regimen: 'monotributista',
      ingresos: 50000,
      ingresos_netos: 49000,
      iva: 0,
      devoluciones: 1000,
      costo: 30000,
      margen: 19000,
      margen_pct: 38.8,
      anterior_margen: 18000,
      anterior_margen_pct: 38,
      anterior_ingresos_netos: 47000,
      estimado: true,
    },
    serie: [
      {
        fecha: '2026-10-01',
        ventas: 1000,
        tickets: 10,
        ingresos: 1000,
        ingresos_netos: 980,
        devoluciones: 20,
        margen: 380,
      },
    ],
    top_skus: [
      {
        producto_id: 1,
        nombre: 'Coca 1.5',
        valor: 500,
        ingresos: 1500,
        ingresos_netos: 1240,
        margen_pesos: 500,
        margen_pct: 40.3,
        participacion: 2.6,
      },
    ],
    gondolas: [
      {
        nombre: 'Góndola 1',
        skus: 20,
        ingresos: 9000,
        ingresos_netos: 7438,
        margen: 3000,
        margen_pct: 40.3,
        stock_valorizado: 20000,
        quiebres: 1,
        sin_movimiento: 2,
      },
    ],
  }

  const t = normalizarTablero(v3)

  assert.equal(t.margen.regimen, 'monotributista')
  assert.equal(t.margen.ingresos_netos, 49000)
  assert.equal(t.margen.iva, 0)
  assert.equal(t.margen.devoluciones, 1000)
  assert.equal(t.margen.anterior_ingresos_netos, 47000)
  assert.equal(t.margen.ingresos, 50000)
  assert.equal(t.margen.margen, 19000)
  assert.equal(t.margen.margen_pct, 38.8)
  assert.equal(t.margen.estimado, true)
  // Las claves extra del JSON (version) no se pierden.
  assert.equal((t.margen as unknown as { version: number }).version, 3)

  assert.deepEqual(t.serie[0], {
    fecha: '2026-10-01',
    ventas: 1000,
    tickets: 10,
    ingresos: 1000,
    ingresos_netos: 980,
    devoluciones: 20,
    margen: 380,
  })
  assert.equal(t.top_skus[0].ingresos_netos, 1240)
  assert.equal(t.gondolas[0].ingresos_netos, 7438)
  assert.equal(t.gondolas[0].margen_pct, 40.3)
})

test('régimen desconocido o faltante cae a responsable inscripto; exento se respeta', () => {
  const conRaro = normalizarTablero({ ...BASE, margen: { ingresos: 1, regimen: 'otra_cosa' } })
  assert.equal(conRaro.margen.regimen, 'responsable_inscripto')

  const exento = normalizarTablero({ ...BASE, margen: { ingresos: 1, regimen: 'exento' } })
  assert.equal(exento.margen.regimen, 'exento')

  // Sin serie ni listas, quedan arreglos vacíos en vez de romper.
  assert.deepEqual(conRaro.serie, [])
  assert.deepEqual(conRaro.top_skus, [])
  assert.deepEqual(conRaro.gondolas, [])
})
