// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Tests del motor de cobertura — 10 escenarios de la spec + invariantes ║
// ║                                                                        ║
// ║  Runner: node --test (Node 24 corre TS nativo por type-stripping).     ║
// ║    npm test                                                            ║
// ║                                                                        ║
// ║  Los mismos escenarios existen del lado SQL en                         ║
// ║  supabase/tests/test_cobertura_compras.sql (contra la migración 151):  ║
// ║  si un caso cambia acá tiene que cambiar allá.                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calcularCobertura,
  calcularDiasStock,
  calcularVentaDiaria,
  cuentaComoTransito,
  esAjusteFuerte,
  esSobrestock,
  redondearPorPresentacion,
  transitoNetoRenglon,
} from './cobertura.ts'
import type {
  InputCobertura,
  ParametrosReposicion,
} from './tiposCobertura.ts'

/** Config base de los casos: objetivo 12 días, seguridad 2, frecuencia 5. */
const PARAMS: ParametrosReposicion = {
  diasCoberturaObjetivo: 12,
  diasSeguridad: 2,
  frecuenciaReposicionDias: 5,
}

const BASE: InputCobertura = {
  stockActual: 0,
  venta30d: 0,
  stockEnTransito: 0,
  ventaPorPeso: false,
}

// ── Caso 1 — Stock suficiente → pedido 0 ─────────────────────────────────
test('Caso 1 — stock suficiente: no requiere y sugerido 0', () => {
  const r = calcularCobertura(
    { ...BASE, stockActual: 40, venta30d: 60 }, // vd 2 → punto 14
    PARAMS
  )
  assert.equal(r.ventaDiaria, 2)
  assert.equal(r.puntoReposicion, 14)
  assert.equal(r.requiereCompra, false)
  assert.equal(r.cantidadSugerida, 0)
  assert.equal(r.cantidadSugeridaRedondeada, 0)
  assert.equal(r.estado, 'verde')
})

// ── Caso 2 — Debajo del punto → hasta el objetivo (Fernet de la spec) ────
test('Caso 2 — en el punto de reposición: sugiere hasta el objetivo', () => {
  const r = calcularCobertura(
    { ...BASE, stockActual: 14, venta30d: 60 }, // vd 2, punto 14, objetivo 24
    PARAMS
  )
  assert.equal(r.requiereCompra, true)
  assert.equal(r.stockObjetivo, 24)
  assert.equal(r.cantidadSugerida, 10) // 24 − 14 − 0
  assert.equal(r.estado, 'rojo')
})

// ── Caso 3 — Mercadería en tránsito → se descuenta del pedido ────────────
test('Caso 3 — tránsito descuenta la sugerencia', () => {
  const r = calcularCobertura(
    { ...BASE, stockActual: 8, venta30d: 60, stockEnTransito: 6 },
    PARAMS
  )
  // disponible 14 ≤ punto 14 → requiere; 24 − 8 − 6 = 10
  assert.equal(r.disponible, 14)
  assert.equal(r.requiereCompra, true)
  assert.equal(r.cantidadSugerida, 10)
})

// ── Caso 4 — Recepción parcial → solo cuenta lo pendiente ────────────────
test('Caso 4 — parcial: tránsito neto = pedido − recibido, nunca negativo', () => {
  assert.equal(transitoNetoRenglon(30, 18), 12)
  assert.equal(transitoNetoRenglon(30, null), 30)
  assert.equal(transitoNetoRenglon(30, 35), 0) // sobre-recepción no resta

  const r = calcularCobertura(
    { ...BASE, stockActual: 0, venta30d: 60, stockEnTransito: 12 },
    PARAMS
  )
  assert.equal(r.requiereCompra, true)
  assert.equal(r.cantidadSugerida, 12) // 24 − 0 − 12
})

// ── Caso 5 — Pedido cancelado → no cuenta como tránsito ──────────────────
test('Caso 5 — estados de OC que cuentan como tránsito', () => {
  assert.equal(cuentaComoTransito('enviado'), true)
  assert.equal(cuentaComoTransito('recepcion_parcial'), true)
  assert.equal(cuentaComoTransito('cancelado'), false)
  assert.equal(cuentaComoTransito('borrador'), false)
  assert.equal(cuentaComoTransito('recibido'), false)
})

// ── Caso 6 — Venta promedio 0 → sin sugerencia automática ────────────────
test('Caso 6 — sin ventas recientes: días null, gris, sugerido 0', () => {
  const r = calcularCobertura({ ...BASE, stockActual: 3, venta30d: 0 }, PARAMS)
  assert.equal(r.ventaDiaria, 0)
  assert.equal(r.diasStock, null) // nunca dividir por cero
  assert.equal(r.requiereCompra, false)
  assert.equal(r.cantidadSugerida, 0)
  assert.equal(r.estado, 'gris')
})

test('Caso 6b — crítico sin ventas: usa stock_minimo como piso', () => {
  const r = calcularCobertura(
    { ...BASE, stockActual: 2, venta30d: 0, esCritico: true, stockMinimo: 10 },
    PARAMS
  )
  assert.equal(r.requiereCompra, true)
  assert.equal(r.cantidadSugerida, 8) // 10 − 2
  assert.equal(r.estado, 'rojo')
})

// ── Caso 7 — Stock negativo → necesidad correcta + alerta ────────────────
test('Caso 7 — stock negativo: repone el faltante completo y marca rojo', () => {
  const r = calcularCobertura(
    { ...BASE, stockActual: -4, venta30d: 60 },
    PARAMS
  )
  assert.equal(r.requiereCompra, true)
  assert.equal(r.cantidadSugerida, 28) // 24 − (−4)
  assert.equal(r.estado, 'rojo')
  assert.ok(r.diasStock !== null && r.diasStock < 0)
})

// ── Caso 8 — Sobrestock → pedido 0 + alerta ──────────────────────────────
test('Caso 8 — sobrestock: 50 días contra objetivo 12 → flag, sin pedido', () => {
  const r = calcularCobertura(
    { ...BASE, stockActual: 100, venta30d: 60 }, // vd 2 → 50 días
    PARAMS
  )
  assert.equal(r.diasStock, 50)
  assert.equal(r.cantidadSugerida, 0)
  assert.equal(r.esSobrestock, true) // 50 > 2 × 12
  assert.equal(r.estado, 'verde')

  // umbral fijo de config pisa al dinámico
  assert.equal(esSobrestock(50, 12, 60), false)
  assert.equal(esSobrestock(50, 12, 40), true)
})

// ── Caso 9 — Presentación x6 → redondear hacia arriba ────────────────────
test('Caso 9 — caja x6: necesidad 10 → 2 cajas = 12 unidades', () => {
  const r = calcularCobertura(
    { ...BASE, stockActual: 14, venta30d: 60, multiploCompra: 6 },
    PARAMS
  )
  assert.equal(r.cantidadSugerida, 10)
  assert.equal(r.paquetes, 2)
  assert.equal(r.cantidadSugeridaRedondeada, 12)

  // múltiplo exacto no salta un bulto de más (guarda de ruido float)
  const exacto = redondearPorPresentacion(12, 6, false)
  assert.equal(exacto.paquetes, 2)
  assert.equal(exacto.cantidadFinal, 12)
})

// ── Caso 10 — Producto por kg → decimales intactos ───────────────────────
test('Caso 10 — por peso: mantiene 3 decimales, sin redondeo a entero', () => {
  const r = calcularCobertura(
    { ...BASE, stockActual: 2.5, venta30d: 45.5, ventaPorPeso: true },
    PARAMS
  )
  assert.equal(r.ventaDiaria, 1.517) // 45.5 / 30 redondeado a 3 dec
  assert.equal(r.stockObjetivo, 18.204)
  assert.equal(r.requiereCompra, true) // 2.5 ≤ punto 10.619
  assert.equal(r.cantidadSugerida, 15.704) // 18.204 − 2.5
  assert.equal(r.cantidadSugeridaRedondeada, 15.704) // NO entero
  assert.equal(r.paquetes, null)
})

// ── Extras: naranja y ajuste fuerte ──────────────────────────────────────
test('Naranja — cerca del punto (≤ 1.25×) sin llegar a requerir', () => {
  // punto 14 → naranja hasta 17.5; stock 16 no requiere pero avisa
  const r = calcularCobertura({ ...BASE, stockActual: 16, venta30d: 60 }, PARAMS)
  assert.equal(r.requiereCompra, false)
  assert.equal(r.estado, 'naranja')
})

test('esAjusteFuerte — dobla, reduce a la mitad o pide sin sugerencia', () => {
  assert.equal(esAjusteFuerte(12, 36), true) // 3× → pide motivo
  assert.equal(esAjusteFuerte(12, 14), false)
  assert.equal(esAjusteFuerte(12, 6), true) // mitad
  assert.equal(esAjusteFuerte(12, 0), true)
  assert.equal(esAjusteFuerte(0, 5), true) // compra sin sugerencia
  assert.equal(esAjusteFuerte(0, 0), false)
})

test('Config incoherente — objetivo se clampa al punto (no hay rojo con sugerido 0)', () => {
  // cobertura 7 < frecuencia 7 + seguridad 2 = 9 → objetivo crudo (14) < punto (18)
  const params: ParametrosReposicion = {
    diasCoberturaObjetivo: 7,
    diasSeguridad: 2,
    frecuenciaReposicionDias: 7,
  }
  const r = calcularCobertura(
    { ...BASE, stockActual: 16, venta30d: 60 }, // vd 2, disponible 16 ≤ punto 18
    params
  )
  assert.equal(r.puntoReposicion, 18)
  assert.equal(r.stockObjetivo, 18) // clampeado (crudo sería 14)
  assert.equal(r.requiereCompra, true)
  assert.equal(r.cantidadSugerida, 2) // 18 − 16: nunca rojo con sugerido 0
})

test('calcularVentaDiaria y calcularDiasStock — bordes', () => {
  assert.equal(calcularVentaDiaria(78), 2.6)
  assert.equal(calcularDiasStock(15, 2.6), 5.8) // el ejemplo de la spec
  assert.equal(calcularDiasStock(15, 0), null)
})

// ── Property test — invariantes con PRNG determinístico ──────────────────
// LCG igual al de lib/pricing/motor.test.ts: reproducible, sin Math.random.
function prng(semilla: number): () => number {
  let estado = semilla >>> 0
  return () => {
    estado = (estado * 1664525 + 1013904223) >>> 0
    return estado / 0xffffffff
  }
}

test('Invariantes — 5000 casos aleatorios reproducibles', () => {
  const rand = prng(20260817)
  for (let i = 0; i < 5000; i++) {
    const ventaPorPeso = rand() < 0.3
    const conMultiplo = rand() < 0.4
    const multiplo = conMultiplo ? Math.max(0.5, Math.round(rand() * 24 * 2) / 2) : null
    const input: InputCobertura = {
      stockActual: Math.round((rand() * 220 - 20) * 1000) / 1000,
      venta30d: rand() < 0.15 ? 0 : Math.round(rand() * 600 * 1000) / 1000,
      stockEnTransito: Math.round(rand() * 60 * 1000) / 1000,
      ventaPorPeso,
      esCritico: rand() < 0.2,
      productoNuevo: rand() < 0.1,
      stockMinimo: Math.round(rand() * 20),
      multiploCompra: multiplo,
    }
    const params: ParametrosReposicion = {
      diasCoberturaObjetivo: 1 + Math.round(rand() * 29),
      diasSeguridad: Math.round(rand() * 5),
      frecuenciaReposicionDias: 1 + Math.round(rand() * 13),
    }
    const r = calcularCobertura(input, params)
    const ctx = `caso ${i}: ${JSON.stringify({ input, params, r })}`

    // sugerido nunca negativo, redondeado nunca menor al sugerido
    assert.ok(r.cantidadSugerida >= 0, ctx)
    assert.ok(r.cantidadSugeridaRedondeada >= r.cantidadSugerida - 0.0005, ctx)
    // el redondeado respeta el múltiplo del proveedor
    if (multiplo != null && r.cantidadSugeridaRedondeada > 0) {
      const resto = r.cantidadSugeridaRedondeada / multiplo
      assert.ok(Math.abs(resto - Math.round(resto)) < 1e-6, ctx)
      assert.equal(r.paquetes, Math.round(resto), ctx)
    }
    // sin requerir compra no hay sugerencia
    if (!r.requiereCompra) assert.equal(r.cantidadSugerida, 0, ctx)
    // con ventas, requiere ⇔ disponible ≤ punto (con tolerancia)
    if (r.ventaDiaria > 0 && r.requiereCompra) {
      assert.ok(r.disponible <= r.puntoReposicion + 0.001, ctx)
    }
    // sin ventas jamás hay días de stock; con ventas siempre
    assert.equal(r.diasStock == null, r.ventaDiaria === 0, ctx)
    // producto entero sin múltiplo: la cantidad final es entera
    if (!ventaPorPeso && multiplo == null) {
      assert.equal(
        r.cantidadSugeridaRedondeada,
        Math.round(r.cantidadSugeridaRedondeada),
        ctx
      )
    }
  }
})
