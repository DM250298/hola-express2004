// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Tests del Registro de cambios y los avisos (Tareas v2, Etapa 5)       ║
// ║    npm test                                                            ║
// ║  Foco: antes → después en palabras, "en nombre de", agrupar por día    ║
// ║  de La Rioja, % de cumplimiento y a quién le llega un aviso.           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { TareaAvisoRow, TareaEventoRow } from '@/types/database'
import {
  agruparPorDia,
  cambiosLegibles,
  diasTexto,
  duracionTexto,
  fechaAr,
  horaAr,
  lunesDe,
  pctCumplimiento,
  quienFue,
  type ContextoRegistro,
} from './registroLogica.ts'
import { avisosNuevos, avisosParaMi, textoAviso, textoAvisado } from './avisosLogica.ts'

const CTX: ContextoRegistro = {
  empleados: new Map([[1, 'Sonia'], [2, 'Camila'], [6, 'Rebeca']]),
  turnos: new Map([[1, { nombre: 'Mañana', hora_inicio: '07:00:00' }], [3, { nombre: 'Noche', hora_inicio: '23:00:00' }]]),
}

function ev(p: Partial<TareaEventoRow>): TareaEventoRow {
  return {
    id: 1, created_at: '2026-10-17T13:20:00Z', transaccion: 1, entidad: 'agenda', tipo: 'editada',
    tarea_turno_id: 't1', tarea_recurrente_id: null, pedido_id: null, turno_id: 1, fecha: '2026-10-17',
    titulo: 'Control de temperaturas', privada: false, duenos: [2], actor_usuario_id: 'u1',
    actor_empleado_id: 1, actor_nombre: 'Sonia', en_nombre_de: [], antes: null, despues: null,
    motivo: null, origen: 'app', ...p,
  }
}

test('rutina: mover de hora y cambiar días se lee en palabras', () => {
  const c = cambiosLegibles(ev({
    entidad: 'rutina', tipo: 'editada',
    antes: { minutos_desde_inicio: 75, dias_semana: [0, 1, 2, 3, 4, 5, 6], hora: null },
    despues: { minutos_desde_inicio: 120, dias_semana: [1, 2, 3, 4, 5], hora: null },
  }), CTX)
  assert.deepEqual(c, [
    { campo: 'Empieza', antes: '08:15', despues: '09:00' },
    { campo: 'Días', antes: 'Todos los días', despues: 'Lunes a viernes' },
  ])
})

test('la noche pasa la medianoche; sin turno conocido, minutos desde el inicio', () => {
  const [c] = cambiosLegibles(ev({ turno_id: 3, entidad: 'rutina', antes: { minutos_desde_inicio: 0 }, despues: { minutos_desde_inicio: 180 } }), CTX)
  assert.deepEqual([c.antes, c.despues], ['23:00', '02:00'])
  const [d] = cambiosLegibles(ev({ turno_id: 9, entidad: 'rutina', antes: null, despues: { minutos_desde_inicio: 30 } }), CTX)
  assert.equal(d.despues, '30 min desde el inicio')
})

test('asignados, área, aviso y estado con nombres', () => {
  const c = cambiosLegibles(ev({
    antes: { empleado_id: 2, area: null, avisar_atraso_min: 15, estado: 'pendiente' },
    despues: { empleado_id: 6, area: 'control_seguridad', avisar_atraso_min: null, estado: 'completada' },
  }), CTX)
  assert.deepEqual(c.map((x) => `${x.campo}: ${x.antes} → ${x.despues}`), [
    'Asignada a: Camila → Rebeca',
    'Área: Sin área → Control y seguridad',
    'Aviso de atraso: A los 15 min → No avisa',
    'Estado: Pendiente → Hecha',
  ])
})

test('aviso de atraso y pasos del checklist tienen su propia línea', () => {
  const [a] = cambiosLegibles(ev({ tipo: 'aviso_atraso', actor_nombre: 'HEX', despues: { para: 'admin', avisado_a: 'Damián, Rodrigo', minutos: 20 } }), CTX)
  assert.equal(a.despues, '20 min de atraso, a los administradores: Damián, Rodrigo')
  const [p] = cambiosLegibles(ev({ tipo: 'checklist_paso', despues: { paso: 0, texto: 'Heladera 1', hecho: true } }), CTX)
  assert.equal(p.despues, 'Heladera 1: hecho')
})

test('lo técnico no se muestra (disparado_por, pedido_id)', () => {
  const c = cambiosLegibles(ev({ tipo: 'reasignada', antes: { empleado_id: 2 }, despues: { disparado_por: 'x' } }), CTX)
  assert.deepEqual(c, [{ campo: 'Asignada a', antes: 'Camila', despues: null }])
})

test('al crear no repite el título ni "Privada: No"', () => {
  const c = cambiosLegibles(ev({ tipo: 'creada', antes: null, despues: { titulo: 'X', privada: false, hora: '23:30:00', duracion_min: 45 } }), CTX)
  assert.deepEqual(c.map((x) => `${x.campo}: ${x.despues}`), ['Hora: 23:30', 'Duración: 45 min'])
})

test('quién: en nombre de; sin actor es HEX', () => {
  assert.equal(quienFue(ev({ en_nombre_de: [2] }), CTX), 'Sonia en nombre de Camila')
  assert.equal(quienFue(ev({ actor_nombre: null }), CTX), 'HEX')
  assert.equal(quienFue(ev({ en_nombre_de: [99] }), CTX), 'Sonia en nombre de Legajo 99')
})

test('día y hora de La Rioja (UTC−3)', () => {
  assert.equal(fechaAr('2026-10-18T02:30:00Z'), '2026-10-17')
  assert.equal(horaAr('2026-10-18T02:30:00Z'), '23:30')
  const g = agruparPorDia([ev({ id: 3, created_at: '2026-10-18T04:00:00Z' }), ev({ id: 2, created_at: '2026-10-18T02:00:00Z' }), ev({ id: 1, created_at: '2026-10-17T12:00:00Z' })])
  assert.deepEqual(g.map((x) => [x.dia, x.eventos.map((e) => e.id)]), [['2026-10-18', [3]], ['2026-10-17', [2, 1]]])
})

test('textos cortos: días, duración, lunes, cumplimiento', () => {
  assert.equal(diasTexto([0, 6]), 'Fines de semana')
  assert.equal(diasTexto([0, 1, 3]), 'Lun, Mié, Dom')
  assert.equal(duracionTexto(90), '1 h 30 min')
  assert.equal(duracionTexto(120), '2 h')
  assert.equal(lunesDe('2026-10-18'), '2026-10-12', 'domingo → lunes anterior')
  assert.equal(lunesDe('2026-10-12'), '2026-10-12')
  assert.equal(pctCumplimiento({ hechas: 3, sin_hacer: 1 }), 75)
  assert.equal(pctCumplimiento({ hechas: 0, sin_hacer: 0 }), null)
})

test('avisos: a quién le llega y cuáles son nuevos', () => {
  const a = (id: number, dest: string[], resuelto: string | null = null) =>
    ({ id, titulo: 'T', duenos_nombres: 'Camila B', minutos_atraso: 20, destinatarios: dest, resuelto_at: resuelto }) as TareaAvisoRow
  const lista = [a(1, ['s']), a(2, ['adm']), a(3, ['s'], '2026-10-17T10:00:00Z')]
  assert.deepEqual(avisosParaMi(lista, 's').map((x) => x.id), [1])
  assert.deepEqual(avisosParaMi(lista, null), [])
  assert.deepEqual(avisosNuevos(lista, new Set([1])).map((x) => x.id), [2, 3])
  assert.equal(textoAviso(lista[0]), 'T (Camila B): 20 min de atraso')
  assert.equal(textoAvisado({ destinatarios_nombres: 'Rebeca', created_at: '2026-10-17T13:20:00Z', para: 'encargada' }, horaAr), 'Avisado a Rebeca · 10:20')
})
