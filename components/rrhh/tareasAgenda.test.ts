// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Tests de la lógica pura de la agenda por turno (Personal › Tareas)   ║
// ║                                                                        ║
// ║  Runner: node --test (Node 24 corre TS nativo por type-stripping).     ║
// ║    npm test                                                            ║
// ║                                                                        ║
// ║  Foco: el estado derivado (atrasada / ahora / más tarde), la noche     ║
// ║  que cruza medianoche y que "no se pudo" (Tareas v2, mig 261) cuente   ║
// ║  como cerrada sin hacer en todos los conteos.                          ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { TurnoPlantillaRow } from '@/types/database'
import type { TareaConParticipantes } from '@/lib/queries/tareas'
import {
  type TareaAgenda,
  cargaPorPersona,
  cerradaSinHacer,
  conteoTurno,
  contextoReloj,
  estadoDerivado,
  inicioAbsoluto,
  segmentosDia,
  sinAsignar,
  solapamientosPorPersona,
} from './tareasAgenda.ts'

const MANANA: TurnoPlantillaRow = {
  id: 1,
  nombre: 'manana',
  hora_inicio: '07:00:00',
  hora_fin: '15:00:00',
  cruza_medianoche: false,
  tolerancia_min: 10,
  activo: true,
}

const NOCHE: TurnoPlantillaRow = {
  id: 3,
  nombre: 'noche',
  hora_inicio: '23:00:00',
  hora_fin: '07:00:00',
  cruza_medianoche: true,
  tolerancia_min: 10,
  activo: true,
}

const HOY = '2026-10-16'
const AYER = '2026-10-15'

function tarea(parcial: Partial<TareaConParticipantes> = {}): TareaConParticipantes {
  return {
    id: 't1',
    plantilla_id: null,
    titulo: 'Tarea',
    descripcion: null,
    empleado_id: 10,
    turno_id: MANANA.id,
    fecha: HOY,
    prioridad: 'media',
    requiere_evidencia: false,
    estado: 'pendiente',
    evidencia_url: null,
    completada_por: null,
    completada_at: null,
    modo: 'individual',
    rechazada_por: null,
    rechazada_at: null,
    motivo_rechazo: null,
    rechazos_count: 0,
    fijada: false,
    notas: null,
    hora: '08:00:00',
    duracion_min: 30,
    ventana_min: null,
    tipo_actividad: 'puntual',
    checklist: [],
    iniciada_por: null,
    iniciada_at: null,
    motivo_omision: null,
    trasladada_de: null,
    trasladada_a: null,
    usuario_id: null,
    created_at: '2026-10-16T09:00:00Z',
    tareas_turno_participantes: [],
    ...parcial,
  }
}

function enAgenda(t: TareaConParticipantes, hora = '10:00'): TareaAgenda {
  return { tarea: t, derivado: estadoDerivado(t, MANANA, HOY, contextoReloj(HOY, HOY, hora)) }
}

test('cerradaSinHacer: cancelada y "no se pudo" sí; el resto no', () => {
  assert.equal(cerradaSinHacer('cancelada'), true)
  assert.equal(cerradaSinHacer('no_se_pudo'), true)
  for (const e of ['pendiente', 'en_curso', 'completada', 'vencida']) {
    assert.equal(cerradaSinHacer(e), false, e)
  }
})

test('estadoDerivado: los estados cerrados no se atrasan', () => {
  const reloj = contextoReloj(HOY, HOY, '12:00')
  const d = (parcial: Partial<TareaConParticipantes>) =>
    estadoDerivado(tarea(parcial), MANANA, HOY, reloj)

  assert.deepEqual([d({ estado: 'no_se_pudo' }).estado, d({ estado: 'no_se_pudo' }).atrasada], ['no_se_pudo', false])
  assert.equal(d({ estado: 'completada' }).estado, 'completada')
  assert.equal(d({ estado: 'cancelada' }).estado, 'omitida')
  assert.equal(d({ estado: 'cancelada', trasladada_a: 't2' }).estado, 'trasladada')
  assert.deepEqual([d({ estado: 'vencida' }).estado, d({ estado: 'vencida' }).atrasada], ['vencida', true])
})

test('estadoDerivado: más tarde, ahora y atrasada según la ventana', () => {
  const en = (hora: string, parcial: Partial<TareaConParticipantes> = {}) =>
    estadoDerivado(tarea(parcial), MANANA, HOY, contextoReloj(HOY, HOY, hora)).estado

  // 08:00 con 30 min de duración y sin ventana propia: vence a las 08:30.
  assert.equal(en('07:59'), 'futura')
  assert.equal(en('08:00'), 'ahora')
  assert.equal(en('08:29'), 'ahora')
  assert.equal(en('08:30'), 'atrasada')
  // La ventana manda sobre la duración.
  assert.equal(en('08:30', { ventana_min: 60 }), 'ahora')
  // Sin duración ni ventana: 30 minutos por defecto.
  assert.equal(en('08:30', { duracion_min: null }), 'atrasada')
  // Sin hora nunca se atrasa.
  assert.equal(en('23:59', { hora: null }), 'pendiente')
  // En curso sigue en curso aunque se pase de la ventana, pero marcada.
  const enCurso = estadoDerivado(tarea({ estado: 'en_curso' }), MANANA, HOY, contextoReloj(HOY, HOY, '09:00'))
  assert.deepEqual([enCurso.estado, enCurso.atrasada], ['en_curso', true])
})

test('estadoDerivado: agenda de un día pasado o futuro', () => {
  const pasado = estadoDerivado(tarea(), MANANA, AYER, contextoReloj(AYER, HOY, '10:00'))
  assert.equal(pasado.estado, 'atrasada')
  const futuro = estadoDerivado(tarea({ fecha: '2026-10-17' }), MANANA, '2026-10-17', contextoReloj('2026-10-17', HOY, '10:00'))
  assert.equal(futuro.estado, 'futura')
})

test('noche: la 01:00 cae después de medianoche y la fecha es la del inicio del turno', () => {
  const t = { hora: '01:00:00', fecha: HOY }
  // Vista desde la agenda de hoy: 01:00 de mañana = minuto 1500.
  assert.equal(inicioAbsoluto(t, NOCHE, HOY), 1500)
  // Vista desde la agenda de mañana: es la cola de la noche de ayer = minuto 60.
  assert.equal(inicioAbsoluto(t, NOCHE, '2026-10-17'), 60)
  // Antes de medianoche no se corre.
  assert.equal(inicioAbsoluto({ hora: '23:30:00', fecha: HOY }, NOCHE, HOY), 1410)
})

test('noche de ayer: a las 00:30 de hoy la tarea de la 01:00 todavía no empezó', () => {
  const t = tarea({ turno_id: NOCHE.id, fecha: AYER, hora: '01:00:00', duracion_min: 15 })
  const d = estadoDerivado(t, NOCHE, HOY, contextoReloj(HOY, HOY, '00:30'))
  assert.equal(d.inicio, 60)
  assert.equal(d.estado, 'futura')
  assert.equal(estadoDerivado(t, NOCHE, HOY, contextoReloj(HOY, HOY, '01:20')).estado, 'atrasada')
})

test('segmentosDia: la noche aporta la cola de ayer y el arranque de hoy', () => {
  const seg = segmentosDia([MANANA, NOCHE])
  const resumen = seg.map((s) => [s.turno?.nombre ?? null, s.desde, s.hasta, s.origen])
  assert.deepEqual(resumen, [
    ['noche', 0, 420, 'ayer'],
    ['manana', 420, 900, 'hoy'],
    [null, 900, 1380, 'hoy'],
    ['noche', 1380, 1440, 'hoy'],
  ])
})

test('conteoTurno: no cuenta canceladas, "no se pudo" ni continuas', () => {
  const lista = [
    enAgenda(tarea({ id: 'a', estado: 'completada' })),
    enAgenda(tarea({ id: 'b', estado: 'pendiente' })),
    enAgenda(tarea({ id: 'c', estado: 'no_se_pudo' })),
    enAgenda(tarea({ id: 'd', estado: 'cancelada' })),
    enAgenda(tarea({ id: 'e', tipo_actividad: 'continua' })),
  ]
  assert.deepEqual(conteoTurno(lista), { hechas: 1, total: 2 })
})

test('sinAsignar: una grupal cerrada sin hacer no avisa', () => {
  const grupal = { empleado_id: null, modo: 'grupal' as const, tareas_turno_participantes: [] }
  assert.equal(sinAsignar(tarea(grupal)), true)
  assert.equal(sinAsignar(tarea({ ...grupal, estado: 'no_se_pudo' })), false)
  assert.equal(sinAsignar(tarea({ ...grupal, estado: 'cancelada' })), false)
})

test('carga y solapamientos: "no se pudo" no le carga minutos a nadie', () => {
  const lista = [
    enAgenda(tarea({ id: 'a', hora: '08:00:00', duracion_min: 60 })),
    enAgenda(tarea({ id: 'b', hora: '08:30:00', duracion_min: 30, estado: 'no_se_pudo' })),
    enAgenda(tarea({ id: 'c', hora: '08:45:00', duracion_min: 30 })),
  ]
  assert.equal(cargaPorPersona(lista).get(10), 90)
  const sol = solapamientosPorPersona(lista)
  assert.deepEqual(sol.map((s) => [s.a.id, s.b.id]), [['a', 'c']])
})
