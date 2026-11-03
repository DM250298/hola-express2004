// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Tests de las unidades sin cargo de la factura (mig 325)              ║
// ║                                                                        ║
// ║  Runner: node --test (Node 24 corre TS nativo por type-stripping).     ║
// ║    npm test                                                            ║
// ║                                                                        ║
// ║  El caso del dueño: 6 Benedictino a $1.463,49 + 1 sin cargo. El        ║
// ║  promedio es solo informativo; lo que cuenta es que el total que entra ║
// ║  a stock sea pagadas + sin cargo y que el neto siga sobre las pagadas. ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  difiereDeRecibido,
  errorSinCargo,
  parseSinCargo,
  promedioConSinCargo,
  totalesDifieren,
  totalesUnidades,
  unidadesRenglon,
} from './sinCargo.ts'

test('parseSinCargo: vacío, basura y negativos son 0; 3 decimales', () => {
  assert.equal(parseSinCargo(''), 0)
  assert.equal(parseSinCargo('abc'), 0)
  assert.equal(parseSinCargo('-2'), 0)
  assert.equal(parseSinCargo('1'), 1)
  assert.equal(parseSinCargo('0.2505'), 0.251)
})

test('errorSinCargo: vacío es válido, negativo y texto bloquean', () => {
  assert.equal(errorSinCargo(''), null)
  assert.equal(errorSinCargo('  '), null)
  assert.equal(errorSinCargo('1'), null)
  assert.equal(errorSinCargo('0'), null)
  assert.match(errorSinCargo('-1') ?? '', /negativas/)
  assert.match(errorSinCargo('x') ?? '', /número/)
})

test('unidadesRenglon: pagadas + sin cargo', () => {
  assert.equal(unidadesRenglon(6, 1), 7)
  assert.equal(unidadesRenglon(6, 0), 6)
  assert.equal(unidadesRenglon(0, 3), 3)
  assert.equal(unidadesRenglon(1.5, 0.25), 1.75)
})

test('promedioConSinCargo: 6 × 1463,49 + 1 gratis → 1254,42 informativo', () => {
  assert.equal(promedioConSinCargo(1463.49, 6, 1), 1254.42)
  // Sin cargo 0 → no hay nada que informar.
  assert.equal(promedioConSinCargo(1463.49, 6, 0), null)
  // Renglón 100 % sin cargo: el promedio es 0 (y el costo no se guarda).
  assert.equal(promedioConSinCargo(500, 0, 3), 0)
  assert.equal(promedioConSinCargo(500, 0, 0), null)
})

test('difiereDeRecibido: extra (null) nunca difiere; tolerancia de floats', () => {
  assert.equal(difiereDeRecibido(7, null), false)
  assert.equal(difiereDeRecibido(7, 7), false)
  assert.equal(difiereDeRecibido(6, 7), true)
  assert.equal(difiereDeRecibido(0.1 + 0.2, 0.3), false)
})

test('totalesUnidades: separa pagadas, sin cargo y recibido, en u. y kg', () => {
  const t = totalesUnidades([
    { cantidad: 6, sinCargo: 1, recibida: 7, porPeso: false },
    { cantidad: 16, sinCargo: 0, recibida: 16, porPeso: false },
    { cantidad: 2.5, sinCargo: 0.5, recibida: 3, porPeso: true },
    // Extra: no suma a recibido.
    { cantidad: 0, sinCargo: 3, recibida: null, porPeso: false },
  ])
  assert.deepEqual(t, { facU: 22, facKg: 2.5, scU: 4, scKg: 0.5, recU: 23, recKg: 3 })
  // 22 + 4 = 26 ≠ 23: el extra entra a stock sin recepción.
  assert.equal(totalesDifieren(t), true)
  assert.equal(
    totalesDifieren({ facU: 6, facKg: 0, scU: 1, scKg: 0, recU: 7, recKg: 0 }),
    false
  )
})
