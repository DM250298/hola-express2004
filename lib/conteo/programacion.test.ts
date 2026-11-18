import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  combinarFechaHora,
  estadoProgramacion,
  fechaHoraPorDefecto,
  hayPendienteVencida,
  ordenarProgramaciones,
  tareasDeProgramacion,
  validarProgramacion,
  type ProgramacionParaEstado,
} from './programacion.ts'
import type { ConteoProgramacionRow } from '@/types/database'

// Lunes 17/11/2026 a las 12:00 en Argentina.
const AHORA = Date.parse('2026-11-17T12:00:00-03:00')

function fila(parcial: Partial<ConteoProgramacionRow>): ConteoProgramacionRow {
  return {
    id: 1,
    nombre: 'Clase A',
    umbral_pesos: 5000,
    notas: null,
    zonas: [],
    programada_para: '2026-11-19T08:00:00-03:00',
    programada_por: 'u1',
    estado: 'programada',
    sesion_id: null,
    intentos: 0,
    ultimo_intento_at: null,
    ultimo_error: null,
    abierta_at: null,
    abierta_por: null,
    cancelada_at: null,
    cancelada_por: null,
    created_at: '2026-11-17T10:00:00-03:00',
    ...parcial,
  }
}

describe('combinarFechaHora', () => {
  it('arma el ISO con el desfase fijo de Argentina', () => {
    assert.equal(combinarFechaHora('2026-11-19', '08:00'), '2026-11-19T08:00:00-03:00')
  })
  it('devuelve null si falta la fecha o la hora', () => {
    assert.equal(combinarFechaHora('', '08:00'), null)
    assert.equal(combinarFechaHora('2026-11-19', ''), null)
    assert.equal(combinarFechaHora('19/11/2026', '08:00'), null)
  })
})

describe('validarProgramacion', () => {
  it('rechaza lo que ya pasó o está a menos de 2 minutos', () => {
    const r = validarProgramacion('2026-11-17', '11:00', AHORA)
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.motivo, /ya pasaron/)
    assert.equal(validarProgramacion('2026-11-17', '12:01', AHORA).ok, false)
  })
  it('acepta desde 2 minutos adelante y devuelve el ISO', () => {
    const r = validarProgramacion('2026-11-17', '12:05', AHORA)
    assert.deepEqual(r, { ok: true, iso: '2026-11-17T12:05:00-03:00' })
  })
  it('rechaza más de 90 días adelante', () => {
    const r = validarProgramacion('2027-02-16', '12:00', AHORA)
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.motivo, /90 días/)
    assert.equal(validarProgramacion('2027-02-15', '11:00', AHORA).ok, true)
  })
  it('pide fecha y hora si falta algo', () => {
    const r = validarProgramacion('', '', AHORA)
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.motivo, 'Elegí fecha y hora.')
  })
})

describe('fechaHoraPorDefecto', () => {
  it('propone mañana a las 07:00 según el día argentino, no el UTC', () => {
    // 02:30 UTC del 17 = 23:30 del 16 en Argentina → "mañana" es el 17.
    assert.deepEqual(fechaHoraPorDefecto(Date.parse('2026-11-17T02:30:00Z')), {
      fecha: '2026-11-17',
      hora: '07:00',
    })
    assert.deepEqual(fechaHoraPorDefecto(AHORA), { fecha: '2026-11-18', hora: '07:00' })
  })
})

describe('estadoProgramacion', () => {
  const base: ProgramacionParaEstado = {
    estado: 'programada',
    programada_para: '2026-11-19T08:00:00-03:00',
    ultimo_error: null,
    abierta_at: null,
    abierta_por: null,
  }
  it('futura mientras no venció', () => {
    assert.equal(estadoProgramacion(base, AHORA).clave, 'futura')
  })
  it('recién vencida y sin error: el proceso la está abriendo', () => {
    const e = estadoProgramacion({ ...base, programada_para: '2026-11-17T11:59:00-03:00' }, AHORA)
    assert.equal(e.clave, 'por_abrir')
    assert.equal(e.alerta, false)
  })
  it('vencida hace rato y sin error: demorada, con la hora y el pedido de abrirla a mano', () => {
    const e = estadoProgramacion({ ...base, programada_para: '2026-11-17T11:30:00-03:00' }, AHORA)
    assert.equal(e.clave, 'demorada')
    assert.equal(e.alerta, true)
    assert.match(e.detalle ?? '', /11:30/)
    assert.match(e.detalle ?? '', /abrila a mano/)
  })
  it('vencida con el motivo del proceso: esperando, sin alerta', () => {
    const e = estadoProgramacion(
      {
        ...base,
        programada_para: '2026-11-17T11:30:00-03:00',
        ultimo_error: 'Hay otra sesión de conteo en curso: se reintenta cada minuto hasta las 12:30.',
      },
      AHORA
    )
    assert.equal(e.clave, 'esperando')
    assert.equal(e.alerta, false)
    assert.match(e.detalle ?? '', /12:30/)
  })
  it('fallida muestra el motivo en rojo', () => {
    const e = estadoProgramacion({ ...base, estado: 'fallida', ultimo_error: 'No tenés permiso' }, AHORA)
    assert.equal(e.clave, 'fallida')
    assert.equal(e.alerta, true)
    assert.equal(e.detalle, 'No tenés permiso')
  })
  it('abierta distingue sola de a mano', () => {
    assert.equal(
      estadoProgramacion({ ...base, estado: 'abierta', abierta_at: '2026-11-17T08:00:00-03:00' }, AHORA).etiqueta,
      'Se abrió sola'
    )
    assert.equal(
      estadoProgramacion(
        { ...base, estado: 'abierta', abierta_at: '2026-11-17T08:00:00-03:00', abierta_por: 'u2' },
        AHORA
      ).etiqueta,
      'Abierta a mano'
    )
    assert.equal(estadoProgramacion({ ...base, estado: 'cancelada' }, AHORA).clave, 'cancelada')
  })
})

describe('tareasDeProgramacion', () => {
  it('lee nombre y responsables del payload del wizard', () => {
    assert.deepEqual(
      tareasDeProgramacion([
        { nombre: 'Clase A', responsables: ['u1', 'u2'], criterios: { clases_abc: ['A'] } },
        { nombre: 'Heladeras', responsable_user_id: 'u3' },
        { nombre: 'Libre' },
      ]),
      [
        { nombre: 'Clase A', responsables: ['u1', 'u2'] },
        { nombre: 'Heladeras', responsables: ['u3'] },
        { nombre: 'Libre', responsables: [] },
      ]
    )
  })
  it('ignora lo que no es una tarea', () => {
    assert.deepEqual(tareasDeProgramacion('x'), [])
    assert.deepEqual(tareasDeProgramacion([null, 3, ['a']]), [])
  })
})

describe('ordenarProgramaciones', () => {
  const filas = [
    fila({ id: 1, programada_para: '2026-11-20T08:00:00-03:00' }),
    fila({ id: 2, programada_para: '2026-11-18T08:00:00-03:00', estado: 'fallida' }),
    fila({ id: 3, estado: 'abierta', abierta_at: '2026-11-16T08:00:00-03:00' }),
    fila({ id: 4, estado: 'abierta', abierta_at: '2026-11-01T08:00:00-03:00' }),
    fila({ id: 5, estado: 'abierta', abierta_at: '2026-11-17T07:00:00-03:00' }),
    fila({ id: 6, estado: 'cancelada' }),
  ]
  it('pendientes por fecha y abiertas de la semana, la más nueva primero', () => {
    const { pendientes, recientes } = ordenarProgramaciones(filas, AHORA)
    assert.deepEqual(pendientes.map((f) => f.id), [2, 1])
    assert.deepEqual(recientes.map((f) => f.id), [5, 3])
  })
  it('detecta una programada vencida sin abrir', () => {
    assert.equal(hayPendienteVencida(filas, AHORA), false)
    assert.equal(
      hayPendienteVencida([fila({ programada_para: '2026-11-17T11:00:00-03:00' })], AHORA),
      true
    )
  })
})
