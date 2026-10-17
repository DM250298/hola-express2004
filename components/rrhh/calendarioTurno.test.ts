// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Tests del calendario del turno (Tareas v2, Etapa 2)                   ║
// ║    npm test                                                            ║
// ║  Foco: tareas que se pisan van lado a lado, carriles por área y por    ║
// ║  persona (grupales en cada participante, privadas aparte), la franja   ║
// ║  "todo el turno", el panel lateral y el aviso de 3 a la vez.           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { TurnoPlantillaRow } from '@/types/database'
import type { TareaConParticipantes } from '@/lib/queries/tareas'
import { contextoReloj, estadoDerivado, type TareaAgenda } from './tareasAgenda.ts'
import {
  avancePorPersona,
  carriles,
  esTodoElTurno,
  estiloCalendario,
  filtrarTipo,
  marcasHora,
  minutosAtraso,
  panelLateral,
  rangoTurno,
  tareasJuntas,
  ubicar,
} from './calendarioTurno.ts'

const MANANA: TurnoPlantillaRow = {
  id: 1, nombre: 'manana', hora_inicio: '07:00:00', hora_fin: '15:00:00',
  cruza_medianoche: false, tolerancia_min: 10, activo: true,
} as TurnoPlantillaRow
const NOCHE: TurnoPlantillaRow = {
  id: 3, nombre: 'noche', hora_inicio: '23:00:00', hora_fin: '07:00:00',
  cruza_medianoche: true, tolerancia_min: 10, activo: true,
} as TurnoPlantillaRow

const HOY = '2026-10-18'
let n = 0
function tarea(p: Partial<TareaConParticipantes>): TareaConParticipantes {
  n++
  return {
    id: `t${n}`, plantilla_id: null, titulo: `Tarea ${n}`, descripcion: null, empleado_id: 1,
    turno_id: 1, fecha: HOY, prioridad: 'media', requiere_evidencia: false, estado: 'pendiente',
    evidencia_url: null, completada_por: null, completada_at: null, modo: 'individual',
    rechazada_por: null, rechazada_at: null, motivo_rechazo: null, rechazos_count: 0, fijada: false,
    notas: null, hora: '08:00:00', duracion_min: 30, ventana_min: null, tipo_actividad: 'puntual',
    checklist: [], iniciada_por: null, iniciada_at: null, motivo_omision: null, trasladada_de: null,
    trasladada_a: null, usuario_id: null, created_at: '', origen: 'rutina', area: 'atencion_caja',
    privada: false, tareas_turno_participantes: [],
    ...p,
  } as TareaConParticipantes
}
function agenda(lista: TareaConParticipantes[], hora = '10:00', turno = MANANA): TareaAgenda[] {
  const reloj = contextoReloj(HOY, HOY, hora)
  return lista.map((t) => ({ tarea: t, derivado: estadoDerivado(t, turno, HOY, reloj) }))
}

test('rangoTurno y marcas: la noche cruza medianoche; la de ayer cae en negativo', () => {
  assert.deepEqual(rangoTurno(MANANA, 'hoy'), { desde: 420, hasta: 900 })
  assert.deepEqual(rangoTurno(NOCHE, 'hoy'), { desde: 1380, hasta: 1860 })
  assert.deepEqual(rangoTurno(NOCHE, 'ayer'), { desde: -60, hasta: 420 })
  assert.deepEqual(marcasHora(420, 600), [420, 480, 540, 600])
})

test('ubicar: las que se pisan van lado a lado; las cortas en una línea', () => {
  const l = agenda([
    tarea({ titulo: 'A', hora: '08:00', duracion_min: 60 }),
    tarea({ titulo: 'B', hora: '08:30', duracion_min: 30 }),
    tarea({ titulo: 'C', hora: '09:30', duracion_min: 15 }),
    tarea({ titulo: 'D', hora: null, duracion_min: null }),
  ])
  const b = ubicar(l, 420)
  const por = Object.fromEntries(b.map((x) => [x.item.tarea.titulo, x]))
  assert.equal(b.length, 3, 'la sin hora no va al calendario')
  assert.deepEqual([por.A.top, por.A.alto, por.A.col, por.A.cols], [60, 60, 0, 2])
  assert.deepEqual([por.B.col, por.B.cols], [1, 2])
  assert.deepEqual([por.C.col, por.C.cols, por.C.compacta], [0, 1, true])
})

test('ubicar: tres que se encadenan comparten columnas y reusan la libre', () => {
  const l = agenda([
    tarea({ titulo: 'A', hora: '08:00', duracion_min: 60 }),
    tarea({ titulo: 'B', hora: '08:15', duracion_min: 15 }),
    tarea({ titulo: 'C', hora: '08:40', duracion_min: 40 }),
  ])
  const por = Object.fromEntries(ubicar(l, 420).map((x) => [x.item.tarea.titulo, x]))
  assert.equal(por.B.col, 1)
  assert.equal(por.C.col, 1, 'C toma la columna que dejó B')
  assert.equal(por.A.cols, 2)
})

test('esTodoElTurno: recordatorios y tareas sin hora', () => {
  const [a, b, c] = agenda([
    tarea({ tipo_actividad: 'continua', hora: null }),
    tarea({ hora: null }),
    tarea({}),
  ])
  assert.deepEqual([esTodoElTurno(a), esTodoElTurno(b), esTodoElTurno(c)], [true, true, false])
})

test('carriles por área: las cuatro siempre; "Sin área" solo si hace falta; privadas aparte', () => {
  const l = agenda([
    tarea({ area: 'control_seguridad' }),
    tarea({ area: null }),
    tarea({ area: 'atencion_caja', privada: true, empleado_id: null }),
  ])
  const c = carriles(l, 'area', [])
  assert.deepEqual(c.map((x) => x.clave), [
    'atencion_caja', 'produccion_fiambreria', 'reposicion_limpieza', 'control_seguridad', 'sin_area', 'privadas',
  ])
  assert.equal(c[0].tareas.length, 0, 'la privada no va al carril de su área')
  assert.equal(c.find((x) => x.clave === 'privadas')?.tareas.length, 1)
  assert.equal(carriles(agenda([tarea({})]), 'area', []).some((x) => x.clave === 'sin_area'), false)
})

test('carriles por persona: grupal en cada participante; sin dueño y quien no figura', () => {
  const l = agenda([
    tarea({ titulo: 'Suya', empleado_id: 1 }),
    tarea({ titulo: 'Grupal', empleado_id: null, modo: 'grupal', tareas_turno_participantes: [{ empleado_id: 1 }, { empleado_id: 2 }] }),
    tarea({ titulo: 'Huérfana', empleado_id: null }),
    tarea({ titulo: 'De Sonia', empleado_id: 9 }),
  ])
  const c = carriles(l, 'persona', [{ id: 1, nombre: 'Camila' }, { id: 2, nombre: 'Tomás' }])
  const por = Object.fromEntries(c.map((x) => [x.clave, x]))
  assert.deepEqual(por.p1.tareas.map((x) => x.tarea.titulo), ['Suya', 'Grupal'])
  assert.deepEqual(por.p2.tareas.map((x) => x.tarea.titulo), ['Grupal'])
  assert.equal(por.p9.subtitulo, 'No figura en el turno')
  assert.deepEqual(por.sin_asignar.tareas.map((x) => x.tarea.titulo), ['Huérfana'])
})

test('filtro por tipo: rutina o puntuales', () => {
  const l = agenda([tarea({ origen: 'rutina' }), tarea({ origen: 'puntual' })])
  assert.equal(filtrarTipo(l, 'todas').length, 2)
  assert.equal(filtrarTipo(l, 'rutina')[0].tarea.origen, 'rutina')
  assert.equal(filtrarTipo(l, 'puntuales')[0].tarea.origen, 'puntual')
})

test('estilo y minutos de atraso', () => {
  const [atr, curso, hecha, nopudo, cancelada] = agenda(
    [
      tarea({ hora: '08:00', duracion_min: 30 }),
      tarea({ hora: '09:50', duracion_min: 30, estado: 'en_curso' }),
      tarea({ estado: 'completada' }),
      tarea({ estado: 'no_se_pudo' }),
      tarea({ estado: 'cancelada' }),
    ],
    '10:00'
  )
  assert.deepEqual(
    [atr, curso, hecha, nopudo, cancelada].map(estiloCalendario),
    ['atrasada', 'en_curso', 'hecha', 'no_se_pudo', 'cancelada']
  )
  assert.equal(minutosAtraso(atr, contextoReloj(HOY, HOY, '10:00')), 90)
  assert.equal(minutosAtraso(curso, contextoReloj(HOY, HOY, '10:00')), 0)
})

test('panel lateral: ahora, atrasadas (la más vieja primero) y lo que sigue', () => {
  const l = agenda(
    [
      tarea({ titulo: 'Atrasada 2', hora: '08:30', duracion_min: 15 }),
      tarea({ titulo: 'Atrasada 1', hora: '08:00', duracion_min: 15 }),
      tarea({ titulo: 'Ahora', hora: '09:50', duracion_min: 30 }),
      tarea({ titulo: 'Sigue 2', hora: '12:00' }),
      tarea({ titulo: 'Sigue 1', hora: '11:00' }),
      tarea({ titulo: 'Recordatorio', tipo_actividad: 'continua', hora: null }),
    ],
    '10:00'
  )
  const p = panelLateral(l)
  assert.deepEqual(p.ahora.map((x) => x.tarea.titulo), ['Ahora'])
  assert.deepEqual(p.atrasadas.map((x) => x.tarea.titulo), ['Atrasada 1', 'Atrasada 2'])
  assert.deepEqual(p.sigue.map((x) => x.tarea.titulo), ['Sigue 1', 'Sigue 2'])
})

test('avance por persona: grupal cuenta para cada uno; no cuentan recordatorios ni "no se pudo"', () => {
  const l = agenda([
    tarea({ empleado_id: 1, estado: 'completada' }),
    tarea({ empleado_id: 1 }),
    tarea({ empleado_id: 1, estado: 'no_se_pudo' }),
    tarea({ empleado_id: 1, tipo_actividad: 'continua', hora: null }),
    tarea({ empleado_id: null, modo: 'grupal', estado: 'completada', tareas_turno_participantes: [{ empleado_id: 1 }, { empleado_id: 2 }] }),
  ])
  const a = avancePorPersona(l, [{ id: 1, nombre: 'Camila' }, { id: 2, nombre: 'Tomás' }, { id: 3, nombre: 'Sin tareas' }])
  assert.deepEqual(a.map((x) => [x.nombre, x.hechas, x.total]), [['Camila', 2, 3], ['Tomás', 1, 1]])
})

test('tareasJuntas: avisa cuando a alguien se le juntan 3 a la vez', () => {
  const l = agenda([
    tarea({ empleado_id: 1, hora: '08:00', duracion_min: 60 }),
    tarea({ empleado_id: 1, hora: '08:15', duracion_min: 30 }),
    tarea({ empleado_id: 1, hora: '08:30', duracion_min: 30 }),
    tarea({ empleado_id: 2, hora: '08:00', duracion_min: 60 }),
    tarea({ empleado_id: 2, hora: '08:30', duracion_min: 60 }),
  ])
  assert.deepEqual(tareasJuntas(l), [{ id: 1, desde: 510, cantidad: 3 }])
})
