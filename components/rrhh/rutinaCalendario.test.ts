// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Tests de la rutina en calendario (Tareas v2, Etapa 4)                 ║
// ║    npm test                                                            ║
// ║  Foco: arrastrar y estirar de a 15 sin salirse del turno, el carril    ║
// ║  al soltar, "se hace este día" y guardar solo lo que cambió.           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { TurnoPlantillaRow } from '@/types/database'
import type { PlantillaConAsignados } from '@/lib/queries/tareas'
import { aRutina } from './nuevaTareaLogica.ts'
import {
  aplicaEnDia,
  cambios,
  comoTareaAgenda,
  estirar,
  formDesdePlantilla,
  indiceCarril,
  largoTurno,
  mismosAsignados,
  mover,
  proximoDia,
} from './rutinaCalendario.ts'

const MANANA = { id: 1, nombre: 'manana', hora_inicio: '07:00:00', hora_fin: '15:00:00', cruza_medianoche: false, activo: true } as TurnoPlantillaRow
const NOCHE = { id: 3, nombre: 'noche', hora_inicio: '23:00:00', hora_fin: '07:00:00', cruza_medianoche: true, activo: true } as TurnoPlantillaRow

function plantilla(p: Partial<PlantillaConAsignados> = {}): PlantillaConAsignados {
  return {
    id: 'p1', titulo: 'Control de temperaturas', descripcion: null, empleado_id: null, turno_id: 1,
    dias_semana: [0, 1, 2, 3, 4, 5, 6], prioridad: 'alta', requiere_evidencia: false, activa: true,
    alcance: 'puesto', roles_puesto: ['responsable_general'], modo: 'individual', tipo_recurrencia: 'dias_semana',
    dia_mes: null, cada_n_dias: null, fecha_base: null, vigencia_desde: null, vigencia_hasta: null,
    hora: null, minutos_desde_inicio: 75, duracion_min: 15, ventana_min: null, tipo_actividad: 'puntual',
    checklist: [], usuario_id: null, created_at: '2026-10-01T10:00:00Z', area: 'control_seguridad',
    privada: false, avisar_atraso_min: 15, cambios_desde: null, version_anterior: null, codigo: 'M11',
    updated_at: '', updated_by: null, tareas_recurrentes_asignados: [],
    ...p,
  } as PlantillaConAsignados
}

test('largo del turno, mover y estirar de a 15 sin salirse', () => {
  assert.equal(largoTurno(MANANA), 480)
  assert.equal(largoTurno(NOCHE), 480)
  assert.equal(mover(75, 15, 22, 480), 90, '75 + 22 → 97 → redondea a 90')
  assert.equal(mover(75, 15, -200, 480), 0, 'no antes del inicio')
  assert.equal(mover(460, 30, 60, 480), 450, 'no después del fin')
  assert.equal(estirar(75, 15, 37, 480), 45, "52 min → 45")
  assert.equal(estirar(75, 15, 40, 480), 60, "55 min → 60")
  assert.equal(estirar(75, 15, -40, 480), 15, 'mínimo 15')
  assert.equal(estirar(450, 15, 120, 480), 30, 'hasta el fin del turno')
})

test('indiceCarril: dónde cae al soltar', () => {
  assert.equal(indiceCarril(10, 400, 4), 0)
  assert.equal(indiceCarril(350, 400, 4), 3)
  assert.equal(indiceCarril(-20, 400, 4), 0)
  assert.equal(indiceCarril(999, 400, 4), 3)
})

test('aplicaEnDia: días de la semana, vigencia, inactiva, día del mes y cada N días', () => {
  assert.equal(aplicaEnDia(plantilla({ dias_semana: [1, 3] }), '2026-10-19'), true, 'lunes')
  assert.equal(aplicaEnDia(plantilla({ dias_semana: [1, 3] }), '2026-10-18'), false, 'domingo')
  assert.equal(aplicaEnDia(plantilla({ vigencia_desde: '2026-10-20' }), '2026-10-19'), false)
  assert.equal(aplicaEnDia(plantilla({ activa: false }), '2026-10-19'), false)
  assert.equal(aplicaEnDia(plantilla({ tipo_recurrencia: 'dia_mes', dia_mes: 31 }), '2026-11-30'), true, 'el 31 cae el último día')
  assert.equal(aplicaEnDia(plantilla({ tipo_recurrencia: 'cada_n_dias', cada_n_dias: 15, fecha_base: '2026-10-01' }), '2026-10-16'), true)
  assert.equal(aplicaEnDia(plantilla({ tipo_recurrencia: 'cada_n_dias', cada_n_dias: 15, fecha_base: '2026-10-01' }), '2026-10-17'), false)
})

test('proximoDia', () => {
  assert.equal(proximoDia('2026-10-17', 0), '2026-10-18')
  assert.equal(proximoDia('2026-10-17', 6), '2026-10-17')
})

test('comoTareaAgenda: inicio en la línea del día; la noche pasa de 1440', () => {
  assert.equal(comoTareaAgenda(plantilla(), MANANA).derivado.inicio, 420 + 75)
  assert.equal(comoTareaAgenda(plantilla({ turno_id: 3, minutos_desde_inicio: 180 }), NOCHE).derivado.inicio, 1560)
  assert.equal(comoTareaAgenda(plantilla({ minutos_desde_inicio: null }), MANANA).derivado.inicio, null)
})

test('formDesdePlantilla + cambios: sin tocar nada no hay cambios; mover solo cambia la hora', () => {
  const p = plantilla()
  const f = formDesdePlantilla(p, MANANA)
  assert.deepEqual([f.desde, f.hasta, f.quien, f.avisar], ['08:15', '08:30', 'puesto', true])
  const base = aRutina(f, true).datos
  assert.deepEqual(cambios(base, aRutina(f, true).datos), {})
  const movida = aRutina({ ...f, desde: '09:00', hasta: '09:15' }, true).datos
  assert.deepEqual(cambios(base, movida), { hora: '09:00' })
  const otraArea = aRutina({ ...f, area: 'reposicion_limpieza' }, true).datos
  assert.deepEqual(cambios(base, otraArea), { area: 'reposicion_limpieza' })
})

test('formDesdePlantilla: recordatorio y asignados fijos', () => {
  const f = formDesdePlantilla(
    plantilla({ tipo_actividad: 'continua', minutos_desde_inicio: null, alcance: 'empleados', tareas_recurrentes_asignados: [{ empleado_id: 4 }] }),
    MANANA
  )
  assert.deepEqual([f.horario, f.recordatorio, f.quien, f.personas], ['todo_el_turno', true, 'persona', [4]])
  assert.equal(mismosAsignados([4, 2], [2, 4]), true)
  assert.equal(mismosAsignados([4], [2, 4]), false)
})
