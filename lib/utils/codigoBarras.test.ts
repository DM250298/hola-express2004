// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Tests del estado del código de barras de un producto (mig 328)       ║
// ║                                                                        ║
// ║  Runner: node --test (Node 24 corre TS nativo por type-stripping).     ║
// ║    npm test                                                            ║
// ║                                                                        ║
// ║  La regla tiene que ser LA MISMA que la del trigger                    ║
// ║  trg_items_pedido_exige_codigo: si acá un producto es "pendiente", la  ║
// ║  base lo rechaza, y al revés. Un desfase deja al empleado trabado sin  ║
// ║  saber por qué, o deja pasar lo que el dueño pidió frenar.            ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  esCodigoAutogenerado,
  estadoCodigo,
  etiquetaCodigo,
  traducirErrorCodigoPendiente,
} from './codigoBarras.ts'

test('esCodigoAutogenerado: vacío, null y HEX- son autogenerados', () => {
  assert.equal(esCodigoAutogenerado(null), true)
  assert.equal(esCodigoAutogenerado(''), true)
  assert.equal(esCodigoAutogenerado('HEX-000123'), true)
  assert.equal(esCodigoAutogenerado('7790040000123'), false)
  // La base siempre genera en mayúsculas: un "hex-" minúscula es un código ajeno.
  assert.equal(esCodigoAutogenerado('hex-1'), false)
})

test('estadoCodigo: sin nada decidido, el HEX- queda pendiente', () => {
  assert.equal(estadoCodigo({ codigo_barras: 'HEX-000123' }), 'pendiente')
  assert.equal(estadoCodigo({ codigo_barras: null }), 'pendiente')
  assert.equal(estadoCodigo({ codigo_barras: '' }), 'pendiente')
  // Fila anterior a la 328 (snapshot offline): los flags vienen vacíos.
  assert.equal(
    estadoCodigo({
      codigo_barras: 'HEX-000123',
      sin_codigo_barras: null,
      plu_balanza: null,
      codigo_barras_2: null,
    }),
    'pendiente'
  )
  assert.equal(
    estadoCodigo({ codigo_barras: 'HEX-000123', sin_codigo_barras: false }),
    'pendiente'
  )
})

test('estadoCodigo: el tilde, el PLU o el EAN secundario lo resuelven', () => {
  assert.equal(
    estadoCodigo({ codigo_barras: 'HEX-000123', sin_codigo_barras: true }),
    'no_lleva'
  )
  assert.equal(
    estadoCodigo({ codigo_barras: 'HEX-000123', plu_balanza: 4 }),
    'no_lleva'
  )
  assert.equal(
    estadoCodigo({ codigo_barras: 'HEX-000123', codigo_barras_2: '7790040000123' }),
    'no_lleva'
  )
  // Un secundario en blanco no cuenta.
  assert.equal(
    estadoCodigo({ codigo_barras: 'HEX-000123', codigo_barras_2: '   ' }),
    'pendiente'
  )
})

test('estadoCodigo: un código real manda sobre cualquier flag', () => {
  assert.equal(estadoCodigo({ codigo_barras: '7790040000123' }), 'real')
  assert.equal(
    estadoCodigo({ codigo_barras: '7790040000123', sin_codigo_barras: true }),
    'real'
  )
  assert.equal(
    estadoCodigo({ codigo_barras: '7790040000123', plu_balanza: 4 }),
    'real'
  )
})

test('etiquetaCodigo: qué se muestra en lugar del código', () => {
  assert.equal(etiquetaCodigo({ codigo_barras: '7790040000123' }), '7790040000123')
  assert.equal(etiquetaCodigo({ codigo_barras: 'HEX-000123' }), 'Sin código')
  assert.equal(
    etiquetaCodigo({ codigo_barras: 'HEX-000123', sin_codigo_barras: true }),
    'No lleva código'
  )
  assert.equal(
    etiquetaCodigo({ codigo_barras: 'HEX-000123', plu_balanza: 12 }),
    'PLU 12'
  )
  assert.equal(
    etiquetaCodigo({ codigo_barras: 'HEX-000123', codigo_barras_2: ' 779 ' }),
    '779'
  )
})

test('traducirErrorCodigoPendiente: solo el error del trigger, con el nombre', () => {
  assert.equal(
    traducirErrorCodigoPendiente('CODIGO_PENDIENTE: Pan francés'),
    'No se puede recibir "Pan francés" sin código de barras. Cargale el código o marcá que no lleva, y volvé a confirmar.'
  )
  // PostgREST a veces antepone texto; el prefijo puede no estar al principio.
  assert.equal(
    traducirErrorCodigoPendiente('ERROR: CODIGO_PENDIENTE:   Queso   '),
    'No se puede recibir "Queso" sin código de barras. Cargale el código o marcá que no lleva, y volvé a confirmar.'
  )
  assert.equal(
    traducirErrorCodigoPendiente('CODIGO_PENDIENTE:'),
    'No se puede recibir ese producto sin código de barras. Cargale el código o marcá que no lleva, y volvé a confirmar.'
  )
  assert.equal(traducirErrorCodigoPendiente('El pedido ya fue recibido'), null)
})
