// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Tests de las etiquetas de balanza (mig 326)                           ║
// ║                                                                        ║
// ║  Runner: node --test (Node 24 corre TS nativo por type-stripping).     ║
// ║    npm test                                                            ║
// ║                                                                        ║
// ║  Las tres etiquetas son las reales de la foto del dueño (2026-11-04):  ║
// ║  queso cremoso 270 g y 130 g (PLU 1) y pategrás 275 g (PLU 4).         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PREFIJO_BALANZA,
  elegirProductoEscaneado,
  parsearCodigoBalanza,
  validarDigitoEan13,
} from './codigoBalanza.ts'

const CREMOSO_270 = '2000001002704'
const CREMOSO_130 = '2000001001301'
const PATEGRAS_275 = '2000004002756'

test('validarDigitoEan13: las etiquetas reales cierran, un dígito cambiado no', () => {
  assert.equal(validarDigitoEan13(CREMOSO_270), true)
  assert.equal(validarDigitoEan13(CREMOSO_130), true)
  assert.equal(validarDigitoEan13(PATEGRAS_275), true)
  assert.equal(validarDigitoEan13('2000001002705'), false)
  assert.equal(validarDigitoEan13('200000100270'), false) // 12 dígitos
  assert.equal(validarDigitoEan13('200000100270a'), false)
  assert.equal(validarDigitoEan13(''), false)
  // EAN de fábrica válido (779 = Argentina): cierra, pero no es etiqueta.
  assert.equal(validarDigitoEan13('7790001002709'), true)
})

test('parsearCodigoBalanza: las tres etiquetas de la foto', () => {
  assert.equal(PREFIJO_BALANZA, '20')
  assert.deepEqual(parsearCodigoBalanza(CREMOSO_270), { plu: 1, kg: 0.27 })
  assert.deepEqual(parsearCodigoBalanza(CREMOSO_130), { plu: 1, kg: 0.13 })
  assert.deepEqual(parsearCodigoBalanza(PATEGRAS_275), { plu: 4, kg: 0.275 })
  // Con espacios alrededor (algún scanner los manda) se acepta igual.
  assert.deepEqual(parsearCodigoBalanza(` ${CREMOSO_270} `), { plu: 1, kg: 0.27 })
})

test('parsearCodigoBalanza: extremos del formato', () => {
  // PLU 99999 con 1 g.
  assert.deepEqual(parsearCodigoBalanza('2099999000014'), { plu: 99999, kg: 0.001 })
  // PLU 4 con 9,999 kg y con el tope de 99,999 kg.
  assert.deepEqual(parsearCodigoBalanza('2000004099992'), { plu: 4, kg: 9.999 })
  assert.deepEqual(parsearCodigoBalanza('2000004999995'), { plu: 4, kg: 99.999 })
})

test('parsearCodigoBalanza: rechaza lo que no es etiqueta', () => {
  assert.equal(parsearCodigoBalanza('2000001002705'), null) // verificador mal
  assert.equal(parsearCodigoBalanza('200000100270'), null) // 12 dígitos
  assert.equal(parsearCodigoBalanza('20000010027041'), null) // 14 dígitos
  assert.equal(parsearCodigoBalanza('200000100270a'), null)
  assert.equal(parsearCodigoBalanza(''), null)
  assert.equal(parsearCodigoBalanza('HEX-000123'), null)
  assert.equal(parsearCodigoBalanza('7790001002709'), null) // EAN de fábrica
  assert.equal(parsearCodigoBalanza('2100001002701'), null) // prefijo 21, cierra
  assert.equal(parsearCodigoBalanza('2000000000015'), null) // PLU 0 (ejemplo del Excel)
  assert.equal(parsearCodigoBalanza('2000001000007'), null) // 0 gramos
})

type Cand = {
  id: number
  codigo_barras: string | null
  codigo_barras_2: string | null
  plu_balanza: number | null
}
const fijo: Cand = { id: 1, codigo_barras: CREMOSO_270, codigo_barras_2: null, plu_balanza: null }
const cremoso: Cand = { id: 2, codigo_barras: 'HEX-000002', codigo_barras_2: null, plu_balanza: 1 }
const pategras: Cand = { id: 3, codigo_barras: 'HEX-000003', codigo_barras_2: '7790001002709', plu_balanza: 4 }
const etiqueta = parsearCodigoBalanza(CREMOSO_270)

test('elegirProductoEscaneado: el código fijo exacto gana al PLU', () => {
  const r = elegirProductoEscaneado([cremoso, fijo], CREMOSO_270, etiqueta)
  assert.equal(r?.producto.id, 1)
  assert.equal(r?.kg, null)
})

test('elegirProductoEscaneado: por PLU trae los kg de la etiqueta', () => {
  const r = elegirProductoEscaneado([pategras, cremoso], CREMOSO_270, etiqueta)
  assert.equal(r?.producto.id, 2)
  assert.equal(r?.kg, 0.27)
})

test('elegirProductoEscaneado: código común, principal o secundario, sin kg', () => {
  assert.deepEqual(elegirProductoEscaneado([cremoso, pategras], 'HEX-000003', null), {
    producto: pategras,
    kg: null,
  })
  assert.deepEqual(elegirProductoEscaneado([cremoso, pategras], ' 7790001002709 ', null), {
    producto: pategras,
    kg: null,
  })
})

test('elegirProductoEscaneado: sin candidatos o sin ese PLU es null', () => {
  assert.equal(elegirProductoEscaneado([], CREMOSO_270, etiqueta), null)
  assert.equal(elegirProductoEscaneado([pategras], CREMOSO_270, etiqueta), null)
  assert.equal(elegirProductoEscaneado([cremoso], 'HEX-000009', null), null)
})
