// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Tests del conteo cíclico por clase ABC (migs 306 a 309)               ║
// ║                                                                        ║
// ║  Runner: node --test (Node 24 corre TS nativo por type-stripping).     ║
// ║    npm test                                                            ║
// ║                                                                        ║
// ║  La tarjeta "Avance por clase ABC" y el resumen de una tarea parcial   ║
// ║  salen de acá: un número mal sumado manda a contar lo que no hace      ║
// ║  falta o esconde lo que falta.                                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cantidadSugerida,
  fragmentosResumenParcial,
  parsearEntero,
  pendientesDeClase,
  resumirPorClase,
} from './ciclo.ts'
import { etiquetaParcial } from './tareas.ts'
import type { ClaseConteo, ConteoPendienteRow } from '../../types/database.ts'

function fila(
  id: number,
  clase: ClaseConteo,
  extra: Partial<ConteoPendienteRow> = {}
): ConteoPendienteRow {
  return {
    producto_id: id,
    nombre: `P${id}`,
    codigo_barras: null,
    clase_abc: clase,
    donde: null,
    orden: id,
    ultimo_ts: null,
    ultima_sesion: null,
    contado_en_ventana: false,
    en_tarea_abierta: false,
    ...extra,
  }
}

const FILAS: ConteoPendienteRow[] = [
  fila(1, 'A', { contado_en_ventana: true, ultimo_ts: '2026-10-20T10:00:00Z' }),
  fila(2, 'A', { contado_en_ventana: true, ultimo_ts: '2026-10-20T10:00:00Z' }),
  fila(3, 'A', { en_tarea_abierta: true }),
  fila(4, 'A'),
  fila(5, 'A', { ultimo_ts: '2026-07-01T10:00:00Z' }),
  fila(6, 'B'),
  fila(7, 'N', { contado_en_ventana: true }),
]

test('resumirPorClase: siempre las cuatro clases, en orden, con pendientes y en curso', () => {
  const r = resumirPorClase(FILAS)
  assert.deepEqual(
    r.map((x) => [x.clase, x.total, x.contados, x.en_curso, x.pendientes]),
    [
      ['A', 5, 2, 1, 3],
      ['B', 1, 0, 0, 1],
      ['C', 0, 0, 0, 0],
      ['N', 1, 1, 0, 0],
    ]
  )
  assert.equal(r[3].etiqueta, 'Sin ventas')
})

test('resumirPorClase: sin filas devuelve las cuatro clases en cero', () => {
  assert.deepEqual(
    resumirPorClase([]).map((x) => x.total),
    [0, 0, 0, 0]
  )
})

test('pendientesDeClase: solo los no contados, en orden de recorrido', () => {
  const desordenadas = [...FILAS].reverse()
  assert.deepEqual(
    pendientesDeClase(desordenadas, 'A').map((f) => f.producto_id),
    [3, 4, 5]
  )
  assert.deepEqual(pendientesDeClase(FILAS, 'C'), [])
})

test('cantidadSugerida: nunca más que lo que se puede mandar', () => {
  assert.equal(cantidadSugerida(385, 0, 50), 50)
  assert.equal(cantidadSugerida(30, 0, 50), 30)
  assert.equal(cantidadSugerida(30, 25, 50), 5)
  assert.equal(cantidadSugerida(3, 3, 50), 0)
})

test('fragmentosResumenParcial: con tope y ventana', () => {
  assert.deepEqual(
    fragmentosResumenParcial(
      { productos: 50, pendientes: 385, ya_contados: 120, en_criterio: 505, limitado: true },
      30
    ),
    [
      'los primeros del recorrido',
      'de 385 pendientes',
      '120 ya contados en los últimos 30 días',
      '505 en el criterio',
    ]
  )
})

test('fragmentosResumenParcial: solo ventana, tope que no recorta, o nada', () => {
  assert.deepEqual(
    fragmentosResumenParcial(
      { productos: 7, pendientes: 7, ya_contados: 1, en_criterio: 10, limitado: false },
      30
    ),
    ['1 ya contado en los últimos 30 días', '10 en el criterio']
  )
  // Ventana sin salteados y tope más grande que la lista: tarea completa.
  assert.deepEqual(
    fragmentosResumenParcial(
      { productos: 10, pendientes: 10, ya_contados: 0, en_criterio: 10, limitado: false },
      30
    ),
    []
  )
  // Todo lo que sobra es de otra tarea (ya_asignados): no es asunto de acá.
  assert.deepEqual(
    fragmentosResumenParcial(
      { productos: 8, pendientes: 8, ya_contados: 0, en_criterio: 10, limitado: false },
      null
    ),
    []
  )
})

test('etiquetaParcial: chip corto de la tarea', () => {
  assert.equal(
    etiquetaParcial({ cantidad_max: 50, sin_contar_dias: 30 }),
    'los primeros 50 · solo pendientes (30 días)'
  )
  assert.equal(etiquetaParcial({ cantidad_max: null, sin_contar_dias: 30 }), 'solo pendientes (30 días)')
  assert.equal(etiquetaParcial({ cantidad_max: 50, sin_contar_dias: null }), 'los primeros 50')
  assert.equal(etiquetaParcial({ cantidad_max: null, sin_contar_dias: null }), null)
})

test('parsearEntero: solo enteros positivos', () => {
  assert.equal(parsearEntero('50'), 50)
  assert.equal(parsearEntero(' 7 '), 7)
  assert.equal(parsearEntero(''), null)
  assert.equal(parsearEntero('0'), null)
  assert.equal(parsearEntero('1.5'), null)
  assert.equal(parsearEntero('-3'), null)
  assert.equal(parsearEntero('abc'), null)
})
