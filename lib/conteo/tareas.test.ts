import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DIAS_CONTEO_RECIENTE,
  aTareasNuevas,
  cantidadesEnOrden,
  leerCantidad,
  type TareaBorrador,
} from './tareas.ts'

const base: TareaBorrador = {
  clave: 't1',
  nombre: '  ARCOR ',
  responsables: ['ana', 'beto'],
  criterios: { proveedor_ids: [7] },
}

describe('leerCantidad', () => {
  it('acepta enteros positivos', () => {
    assert.equal(leerCantidad('100'), 100)
    assert.equal(leerCantidad(' 60 '), 60)
  })
  it('vacío, cero, negativos y decimales son "sin número"', () => {
    assert.equal(leerCantidad(''), null)
    assert.equal(leerCantidad('0'), null)
    assert.equal(leerCantidad('-5'), null)
    assert.equal(leerCantidad('1,5'), null)
    assert.equal(leerCantidad('abc'), null)
  })
})

describe('cantidadesEnOrden', () => {
  it('sigue el orden de los responsables y deja null al que no tiene', () => {
    assert.deepEqual(cantidadesEnOrden(['ana', 'beto'], { beto: 60 }), [null, 60])
    assert.deepEqual(cantidadesEnOrden(['beto', 'ana'], { ana: 100, beto: 60 }), [60, 100])
  })
  it('sin ningún número no manda nada (reparto parejo)', () => {
    assert.equal(cantidadesEnOrden(['ana'], undefined), undefined)
    assert.equal(cantidadesEnOrden(['ana'], {}), undefined)
    assert.equal(cantidadesEnOrden(['ana'], { ana: 0 }), undefined)
  })
  it('ignora cantidades de quien ya no cuenta', () => {
    assert.equal(cantidadesEnOrden(['ana'], { beto: 60 }), undefined)
  })
})

describe('aTareasNuevas', () => {
  it('por defecto excluye lo contado en la ventana y no manda cantidades', () => {
    const [t] = aTareasNuevas([base])
    assert.equal(t.nombre, 'ARCOR')
    assert.equal(t.excluir_dias, DIAS_CONTEO_RECIENTE)
    assert.equal(t.cantidades, undefined)
  })
  it('con el tilde de incluir, la ventana va en 0', () => {
    const [t] = aTareasNuevas([{ ...base, incluirRecientes: true }])
    assert.equal(t.excluir_dias, 0)
  })
  it('manda las cantidades en el orden de los responsables', () => {
    const [t] = aTareasNuevas([{ ...base, cantidades: { ana: 100, beto: 60 } }])
    assert.deepEqual(t.cantidades, [100, 60])
  })
  it('la zona libre no lleva cantidades ni ventana', () => {
    const [t] = aTareasNuevas([
      { ...base, criterios: null, cantidades: { ana: 5 } },
    ])
    assert.equal(t.criterios, null)
    assert.equal(t.cantidades, undefined)
    assert.equal(t.excluir_dias, undefined)
  })
})
