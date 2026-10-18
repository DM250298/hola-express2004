-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  BORRADO DE LOS DATOS DE PRUEBA: tareas, asistencia, incidencias    ║
-- ║  y sanciones (pedido de Damián, 2026-10-18).                        ║
-- ║                                                                     ║
-- ║  ⚠️  Antes: correr tareas_v2_borrar_todo_vista_previa. Antes de     ║
-- ║  borrar copia las 16 tablas al esquema respaldo_borrado_prueba      ║
-- ║  (se puede recuperar sin restaurar la base entera).                 ║
-- ║                                                                     ║
-- ║  Borra SOLO estas 16 tablas:                                        ║
-- ║   · tareas: agenda, participantes, rutina, asignados de la rutina,  ║
-- ║     registro de cambios, pedidos, avisos de atraso, avisos          ║
-- ║     mandados, resúmenes semanales, cola de notificaciones;          ║
-- ║   · incidencias, sanciones y su relación;                           ║
-- ║   · asistencia: días calculados, fichadas e importaciones del reloj.║
-- ║  NO toca: cronograma (horarios_asignados), turnos, legajos,         ║
-- ║  tipologías de incidencia, pases de turno, evaluaciones manuales,   ║
-- ║  tableros de tareas (/proyectos), suscripciones de celulares,       ║
-- ║  ventas, stock, finanzas ni nada de otra área.                      ║
-- ║                                                                     ║
-- ║  Todo en una transacción: si algo falla, no se borra nada. Si otra  ║
-- ║  tabla (de otra área) apunta a estas, se frena antes de borrar.     ║
-- ║  El blindaje del registro se saca solo durante el borrado y vuelve  ║
-- ║  a quedar puesto. Al final deja un evento "registro_completo".      ║
-- ╚════════════════════════════════════════════════════════════════════╝

begin;
set local lock_timeout = '10s';

create temp table _borrar (tabla text primary key) on commit drop;
insert into _borrar values
  ('notificaciones_push'), ('tareas_avisos_push'), ('tareas_avisos'), ('tareas_resumenes'),
  ('tareas_eventos'), ('tareas_pedidos'), ('sancion_incidencias'), ('sanciones'), ('incidencias'),
  ('tareas_turno_participantes'), ('tareas_turno'), ('tareas_recurrentes_asignados'),
  ('tareas_recurrentes'), ('asistencia_diaria'), ('fichajes'), ('importaciones_fichajes');

-- 1. Seguro: ninguna tabla de otra área puede depender de estas.
do $$
declare v text;
begin
  select string_agg(format('%s → %s', c.conrelid::regclass, c.confrelid::regclass), ', ') into v
  from pg_constraint c
  where c.contype = 'f'
    and c.confrelid in (select ('public.' || tabla)::regclass from _borrar)
    and c.conrelid not in (select ('public.' || tabla)::regclass from _borrar);
  if v is not null then
    raise exception 'Se frena: hay tablas de otra área que apuntan a estas (%). No se borró nada.', v;
  end if;
end $$;

-- 1b. Respaldo propio de las 16 tablas, dentro de la base, en el esquema
--     respaldo_borrado_prueba (la API no lo expone; nadie de la app lo ve). Sirve
--     para recuperar algo SIN restaurar la base entera (que pisaría ventas y stock).
--     Si ya existía de una corrida anterior, se frena para no pisarlo.
do $$
declare r record;
begin
  if exists (select 1 from pg_namespace where nspname = 'respaldo_borrado_prueba') then
    raise exception 'Ya existe el respaldo respaldo_borrado_prueba (de una corrida anterior). No se borró nada.';
  end if;
  create schema respaldo_borrado_prueba;
  revoke all on schema respaldo_borrado_prueba from public, anon, authenticated;
  for r in select tabla from _borrar loop
    execute format('create table respaldo_borrado_prueba.%I as table public.%I', r.tabla, r.tabla);
  end loop;
end $$;

-- 2. Se saca el blindaje del registro (vuelve en el paso 4).
alter table public.tareas_eventos   disable trigger trg_tareas_eventos_inmutable;
alter table public.tareas_pedidos   disable trigger trg_tareas_pedidos_guarda;
alter table public.tareas_avisos    disable trigger trg_tareas_avisos_guarda;
alter table public.tareas_resumenes disable trigger trg_tareas_resumenes_inmutable;

-- 3. Borrado, en orden, contando las filas.
drop table if exists pg_temp._borrado;
create temp table _borrado (orden serial, tabla text, filas bigint);  -- queda hasta el final para mostrar el resultado
with d as (delete from public.notificaciones_push returning 1) insert into _borrado (tabla, filas) select 'notificaciones_push', count(*) from d;
with d as (delete from public.tareas_avisos_push returning 1) insert into _borrado (tabla, filas) select 'tareas_avisos_push', count(*) from d;
with d as (delete from public.tareas_avisos returning 1) insert into _borrado (tabla, filas) select 'tareas_avisos', count(*) from d;
with d as (delete from public.tareas_resumenes returning 1) insert into _borrado (tabla, filas) select 'tareas_resumenes', count(*) from d;
with d as (delete from public.tareas_eventos returning 1) insert into _borrado (tabla, filas) select 'tareas_eventos', count(*) from d;
with d as (delete from public.tareas_pedidos returning 1) insert into _borrado (tabla, filas) select 'tareas_pedidos', count(*) from d;
with d as (delete from public.sancion_incidencias returning 1) insert into _borrado (tabla, filas) select 'sancion_incidencias', count(*) from d;
with d as (delete from public.sanciones returning 1) insert into _borrado (tabla, filas) select 'sanciones', count(*) from d;
with d as (delete from public.incidencias returning 1) insert into _borrado (tabla, filas) select 'incidencias', count(*) from d;
with d as (delete from public.tareas_turno_participantes returning 1) insert into _borrado (tabla, filas) select 'tareas_turno_participantes', count(*) from d;
with d as (delete from public.tareas_turno returning 1) insert into _borrado (tabla, filas) select 'tareas_turno', count(*) from d;
with d as (delete from public.tareas_recurrentes_asignados returning 1) insert into _borrado (tabla, filas) select 'tareas_recurrentes_asignados', count(*) from d;
with d as (delete from public.tareas_recurrentes returning 1) insert into _borrado (tabla, filas) select 'tareas_recurrentes', count(*) from d;
with d as (delete from public.asistencia_diaria returning 1) insert into _borrado (tabla, filas) select 'asistencia_diaria', count(*) from d;
with d as (delete from public.fichajes returning 1) insert into _borrado (tabla, filas) select 'fichajes', count(*) from d;
with d as (delete from public.importaciones_fichajes returning 1) insert into _borrado (tabla, filas) select 'importaciones_fichajes', count(*) from d;

-- 4. Vuelve el blindaje (ENABLE ALWAYS, como lo dejaron la 264, 293 y 295).
alter table public.tareas_eventos   enable always trigger trg_tareas_eventos_inmutable;
alter table public.tareas_pedidos   enable always trigger trg_tareas_pedidos_guarda;
alter table public.tareas_avisos    enable always trigger trg_tareas_avisos_guarda;
alter table public.tareas_resumenes enable always trigger trg_tareas_resumenes_inmutable;

-- 5. El registro arranca de nuevo, completo desde acá.
select public.fn_tarea_evento('registro_completo', null, null, null,
  jsonb_build_object('desde', now(), 'motivo', 'Borrado de los datos de prueba (tareas, asistencia, incidencias y sanciones)'),
  null, 'borrado_prueba');

do $$
begin
  if (select count(*) from pg_trigger where tgname in ('trg_tareas_eventos_inmutable', 'trg_tareas_pedidos_guarda',
        'trg_tareas_avisos_guarda', 'trg_tareas_resumenes_inmutable') and tgenabled = 'A') <> 4 then
    raise exception 'El blindaje del registro no volvió a quedar puesto. No se borró nada.';
  end if;
end $$;

commit;

-- Lo que se borró (si ves esta tabla, quedó todo hecho). El respaldo queda en el
-- esquema respaldo_borrado_prueba; cuando estés seguro, se borra con:
--   drop schema respaldo_borrado_prueba cascade;
select tabla, filas from _borrado order by orden;
