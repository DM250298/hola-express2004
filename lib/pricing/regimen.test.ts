// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Tests de regimenDesdeCondicionIva                                     ║
// ║                                                                        ║
// ║  Runner: node --test (Node 24 corre TS nativo por type-stripping).     ║
// ║    node --test lib/pricing/regimen.test.ts                             ║
// ║                                                                        ║
// ║  Antes de la mig 311 el motor comparaba solo con 'monotributista' y    ║
// ║  trataba al monotributo guardado como 'monotributo' (el valor del      ║
// ║  formulario) como responsable inscripto.                               ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { regimenDesdeCondicionIva } from './regimen.ts'

test('responsable_inscripto → responsable_inscripto', () => {
  assert.equal(regimenDesdeCondicionIva('responsable_inscripto'), 'responsable_inscripto')
})

test('monotributo (valor viejo del formulario) → monotributista', () => {
  assert.equal(regimenDesdeCondicionIva('monotributo'), 'monotributista')
})

test('monotributista → monotributista, sin importar mayúsculas ni espacios', () => {
  assert.equal(regimenDesdeCondicionIva('monotributista'), 'monotributista')
  assert.equal(regimenDesdeCondicionIva('  Monotributista '), 'monotributista')
})

test('exento → monotributista (no discrimina IVA)', () => {
  assert.equal(regimenDesdeCondicionIva('exento'), 'monotributista')
})

test('vacío, null o desconocido → responsable_inscripto', () => {
  assert.equal(regimenDesdeCondicionIva(''), 'responsable_inscripto')
  assert.equal(regimenDesdeCondicionIva(null), 'responsable_inscripto')
  assert.equal(regimenDesdeCondicionIva(undefined), 'responsable_inscripto')
  assert.equal(regimenDesdeCondicionIva('cualquier_cosa'), 'responsable_inscripto')
})
