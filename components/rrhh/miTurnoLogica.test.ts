// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Tests de "Mi turno" en el celular (Tareas v2, Etapa 6)                ║
// ║    npm test                                                            ║
// ║  Foco: en qué sección cae cada tarea, la noche que pasa la medianoche, ║
// ║  el avance del día, el saludo y con quién estás de turno.              ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { TurnoPlantillaRow } from '@/types/database'
import type { TareaConParticipantes } from '@/lib/queries/tareas'
import { contextoReloj, estadoDerivado, ordenarCronologico, type TareaAgenda } from './tareasAgenda.ts'
import { companerosTexto, minutosTarde, pasosHechos, saludo, secciones } from './miTurnoLogica.ts'

const TARDE = { id: 2, nombre: 'tarde', hora_inicio: '15:00:00', hora_fin: '23:00:00', cruza_medianoche: false, tolerancia_min: 10, activo: true } as TurnoPlantillaRow
const NOCHE = { id: 3, nombre: 'noche', hora_inicio: '23:00:00', hora_fin: '07:00:00', cruza_medianoche: true, tolerancia_min: 10, activo: true } as TurnoPlantillaRow
const HOY = '2026-10-17'

function t(id: string, p: Partial<TareaConParticipantes> = {}): TareaConParticipantes {
  return {
    id, plantilla_id: null, titulo: id, descripcion: null, empleado_id: 5, turno_id: 2, fecha: HOY,
    hora: null, duracion_min: 15, ventana_min: null, tipo_actividad: 'puntual', checklist: [],
    prioridad: 'media', requiere_evidencia: false, estado: 'pendiente', modo: 'individual',
    trasladada_a: null, tareas_turno_participantes: [], ...p,
  } as unknown as TareaConParticipantes
}

function derivar(lista: TareaConParticipantes[], hora: string, turno = TARDE): TareaAgenda[] {
  const reloj = contextoReloj(HOY, HOY, hora)
  return ordenarCronologico(lista.map((x) => ({ tarea: x, derivado: estadoDerivado(x, turno, HOY, reloj) })))
}

test('reparte por sección a las 16:00', () => {
  const s = secciones(derivar([
    t('atrasada', { hora: '15:10:00' }),                         // 15:10–15:25, pasó
    t('ahora', { hora: '15:55:00' }),                            // 15:55–16:10
    t('en curso', { hora: '15:50:00', estado: 'en_curso' }),     // 15:50–16:05
    t('más tarde', { hora: '18:00:00' }),
    t('sin hora'),
    t('recordatorio', { tipo_actividad: 'continua' }),
    t('hecha', { hora: '15:00:00', estado: 'completada' }),
    t('no se pudo', { hora: '15:05:00', estado: 'no_se_pudo' }),
  ], '16:00'))
  const ids = (l: TareaAgenda[]) => l.map((x) => x.tarea.id)
  assert.deepEqual(ids(s.atrasadas), ['atrasada'])
  assert.deepEqual(ids(s.ahora), ['ahora'])
  assert.deepEqual(ids(s.enCurso), ['en curso'])
  assert.deepEqual(ids(s.masTarde), ['más tarde'])
  assert.deepEqual(ids(s.todoElTurno), ['sin hora'])
  assert.deepEqual(ids(s.recordatorios), ['recordatorio'])
  assert.deepEqual(ids(s.yaPasaron), ['no se pudo', 'hecha'], 'lo último arriba')
  assert.deepEqual(s.avance, { hechas: 1, total: 6 }, 'no cuentan recordatorios ni "no se pudo"')
})

test('una en curso que se pasó de su horario va a atrasadas; la más vieja primero', () => {
  const s = secciones(derivar([
    t('b', { hora: '15:30:00' }),
    t('a', { hora: '15:00:00', estado: 'en_curso' }),
  ], '16:00'))
  assert.deepEqual(s.atrasadas.map((x) => x.tarea.id), ['a', 'b'])
  assert.equal(minutosTarde(s.atrasadas[0], 16 * 60), 45)
  assert.equal(minutosTarde(s.atrasadas[1], 16 * 60), 15)
})

test('la noche: una tarea de las 02:00 está "ahora" a las 02:05 del día siguiente', () => {
  const reloj = { ahora: 24 * 60 + 2 * 60 + 5 } // 02:05 en la línea del día en que empezó el turno
  const x = t('n', { turno_id: 3, hora: '02:00:00', duracion_min: 15 })
  const s = secciones([{ tarea: x, derivado: estadoDerivado(x, NOCHE, HOY, reloj) }])
  assert.deepEqual(s.ahora.map((y) => y.tarea.id), ['n'])
})

test('saludo, compañeros y pasos', () => {
  assert.equal(saludo('07:30'), 'Buen día')
  assert.equal(saludo('15:40'), 'Buenas tardes')
  assert.equal(saludo('23:10'), 'Buenas noches')
  assert.equal(saludo('03:00'), 'Buenas noches')
  const filas = [
    { turno_id: 2, nombre: 'Camila Gramajo', soy_yo: true },
    { turno_id: 2, nombre: 'Rebeca Fa', soy_yo: false },
    { turno_id: 2, nombre: 'Tomas Cejas', soy_yo: false },
  ]
  assert.equal(companerosTexto(filas, 2), 'Hoy estás con Rebeca y Tomas.')
  assert.equal(companerosTexto(filas.slice(0, 1), 2), 'Hoy no hay nadie más en tu turno.')
  assert.equal(companerosTexto([], null), null)
  assert.deepEqual(pasosHechos(['a', 'b', 'c'], [true, false]), [true, false, false])
  assert.deepEqual(pasosHechos(['a'], null), [false])
})
