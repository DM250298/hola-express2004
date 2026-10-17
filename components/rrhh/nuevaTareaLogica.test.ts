// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Tests del formulario "Nueva tarea" (Tareas v2, Etapa 3)               ║
// ║    npm test                                                            ║
// ║  Foco: validaciones (horario dentro del turno, la noche que cruza la   ║
// ║  medianoche), lo que se manda a la base y el resumen.                  ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { TurnoPlantillaRow } from '@/types/database'
import { aPuntual, aRutina, duracion, formularioVacio, resumen, validar, variosPosibles } from './nuevaTareaLogica.ts'

const MANANA = { id: 1, nombre: 'manana', hora_inicio: '07:00:00', hora_fin: '15:00:00', cruza_medianoche: false, activo: true } as TurnoPlantillaRow
const NOCHE = { id: 3, nombre: 'noche', hora_inicio: '23:00:00', hora_fin: '07:00:00', cruza_medianoche: true, activo: true } as TurnoPlantillaRow

const base = () => ({
  ...formularioVacio('2026-10-18', 1),
  titulo: 'Controlar heladera 3',
  area: 'control_seguridad' as const,
  desde: '08:00',
  hasta: '08:30',
  puestos: ['responsable_general' as const],
})

test('duracion: normal y cruzando la medianoche', () => {
  assert.equal(duracion('08:00', '08:30'), 30)
  assert.equal(duracion('23:30', '00:15'), 45)
})

test('validar: un formulario completo no tiene errores', () => {
  assert.deepEqual(validar(base(), MANANA), [])
})

test('validar: título, área, puesto y días', () => {
  const e = validar({ ...base(), titulo: ' ', area: null, puestos: [] }, MANANA)
  assert.ok(e.some((x) => x.includes('qué hay que hacer')))
  assert.ok(e.some((x) => x.includes('área')))
  assert.ok(e.some((x) => x.includes('puesto')))
  assert.ok(validar({ ...base(), frecuencia: 'rutina', dias: [] }, MANANA).some((x) => x.includes('día de la semana')))
})

test('validar: el horario tiene que quedar dentro del turno', () => {
  assert.ok(validar({ ...base(), desde: '14:45', hasta: '15:30' }, MANANA).some((x) => x.includes('dentro del turno')))
  assert.ok(validar({ ...base(), desde: '16:00', hasta: '16:30' }, MANANA).some((x) => x.includes('dentro del turno')))
  assert.ok(validar({ ...base(), desde: '08:00', hasta: '08:00' }, MANANA).some((x) => x.includes('después del inicio')))
  // Noche: 23:30 a 00:15 es válido; 06:30 a 07:30 se pasa del turno.
  assert.deepEqual(validar({ ...base(), turnoId: 3, desde: '23:30', hasta: '00:15' }, NOCHE), [])
  assert.ok(validar({ ...base(), turnoId: 3, desde: '06:30', hasta: '07:30' }, NOCHE).some((x) => x.includes('dentro del turno')))
})

test('validar: una privada no pide quién la hace', () => {
  assert.deepEqual(validar({ ...base(), privada: true, puestos: [] }, MANANA), [])
})

test('aPuntual: por puesto, con aviso y foto', () => {
  const p = aPuntual({ ...base(), prioridad: 'alta', avisar: true, foto: true })
  assert.equal(p.hora, '08:00')
  assert.equal(p.duracionMin, 30)
  assert.deepEqual(p.rolesPuesto, ['responsable_general'])
  assert.deepEqual(p.empleadoIds, [])
  assert.equal(p.avisarAtrasoMin, 15)
  assert.equal(p.requiereEvidencia, true)
  assert.equal(p.tipoActividad, 'puntual')
})

test('aPuntual: recordatorio de todo el turno no avisa ni pide foto', () => {
  const p = aPuntual({ ...base(), horario: 'todo_el_turno', recordatorio: true, avisar: true, foto: true })
  assert.equal(p.hora, null)
  assert.equal(p.tipoActividad, 'continua')
  assert.equal(p.avisarAtrasoMin, null)
  assert.equal(p.requiereEvidencia, false)
})

test('aPuntual: privada sin asignados', () => {
  const p = aPuntual({ ...base(), privada: true, quien: 'persona', personas: [2], modo: 'grupal' })
  assert.deepEqual([p.empleadoIds, p.rolesPuesto, p.modo, p.privada], [[], [], 'individual', true])
})

test('aRutina: por persona = alcance empleados; la encargada no manda "privada"', () => {
  const r = aRutina({ ...base(), frecuencia: 'rutina', quien: 'persona', personas: [2, 5], dias: [5, 1] }, false)
  assert.equal(r.datos.alcance, 'empleados')
  assert.deepEqual(r.asignados, [2, 5])
  assert.deepEqual(r.datos.dias_semana, [1, 5])
  assert.equal('privada' in r.datos, false)
  assert.equal(aRutina({ ...base(), frecuencia: 'rutina', privada: true }, true).datos.privada, true)
})

test('variosPosibles y resumen', () => {
  assert.equal(variosPosibles({ ...base(), quien: 'persona', personas: [2] }), false)
  assert.equal(variosPosibles({ ...base(), quien: 'persona', personas: [2, 3] }), true)
  const r = resumen(
    { ...base(), prioridad: 'alta', avisar: true },
    { turno: MANANA, nombreTurno: 'Mañana', diaLegible: 'domingo 18/10', nombreArea: 'Control y seguridad', quienes: ['Sonia'] }
  )
  assert.equal(r[1], 'Solo una vez, el domingo 18/10 · turno mañana · de 08:00 a 08:30')
  assert.ok(r[3].startsWith('Ese día le toca a: Sonia'))
  assert.equal(r[4], 'prioridad alta · avisa si se atrasa más de 15 min')
})
