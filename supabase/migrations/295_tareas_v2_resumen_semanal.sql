-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  295 · Tareas v2: resumen semanal (Etapa 5, 3/4)                    ║
-- ║  fn_tareas_resumen_semana(lunes), solo admin: hechas a tiempo y con ║
-- ║  atraso, no se pudo, sin hacer, por turno y persona, las que más se ║
-- ║  atrasan, marcadas por otro, cambios, pedidos y avisos (sin         ║
-- ║  recordatorios ni bloques). tareas_resumenes: la foto de cada lunes ║
-- ║  08:00 (la 296), que no se edita ni se borra.                       ║
-- ║  Requiere la 294. Se puede correr de nuevo. Termina en "notify".    ║
-- ╚════════════════════════════════════════════════════════════════════╝

set local lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.fn_tareas_avisar_atrasos()') is null then
    raise exception '295: falta la 294.';
  end if;
end $$;

create table if not exists public.tareas_resumenes (
  semana_desde date primary key,
  created_at   timestamptz not null default now(),
  datos        jsonb not null
);
alter table public.tareas_resumenes enable row level security;
drop policy if exists tareas_resumenes_select on public.tareas_resumenes;
create policy tareas_resumenes_select on public.tareas_resumenes
  for select to authenticated using ((select public.fn_tiene_permiso('tareas_admin')));
revoke insert, update, delete, truncate, references, trigger
  on public.tareas_resumenes from public, anon, authenticated, service_role;
revoke select on public.tareas_resumenes from public, anon;
grant select on public.tareas_resumenes to authenticated;

drop trigger if exists trg_tareas_resumenes_inmutable on public.tareas_resumenes;
create trigger trg_tareas_resumenes_inmutable
  before update or delete on public.tareas_resumenes
  for each row execute function public.fn_trg_registro_inmutable();
drop trigger if exists trg_tareas_resumenes_sin_truncate on public.tareas_resumenes;
create trigger trg_tareas_resumenes_sin_truncate
  before truncate on public.tareas_resumenes
  for each statement execute function public.fn_trg_registro_inmutable();
alter table public.tareas_resumenes enable always trigger trg_tareas_resumenes_inmutable;
alter table public.tareas_resumenes enable always trigger trg_tareas_resumenes_sin_truncate;

create or replace function public.fn_tareas_resumen_semana(p_lunes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_hasta date := p_lunes + 6;
  v_desde_at timestamptz := p_lunes::timestamp at time zone 'America/Argentina/La_Rioja';
  v_hasta_at timestamptz := (p_lunes + 7)::timestamp at time zone 'America/Argentina/La_Rioja';
  v jsonb;
begin
  if auth.uid() is not null and not public.fn_tiene_permiso('tareas_admin') then
    raise exception 'Sin permiso.';
  end if;
  if extract(isodow from p_lunes) <> 1 then
    raise exception 'La semana empieza un lunes.';
  end if;

  with base as (
    select t.id, t.titulo, t.turno_id, t.plantilla_id, t.limite_at, t.completada_at, t.motivo_no_se_pudo,
           case when t.estado = 'completada' then 'hecha'
                when t.estado in ('no_se_pudo', 'cancelada') then t.estado::text
                when t.estado = 'vencida' or public.fn_tarea_fin_turno(t.fecha, t.turno_id) < now() then 'sin_hacer'
                else 'abierta' end as cierre,
           case when t.empleado_id is not null then array[t.empleado_id]
                else coalesce((select array_agg(p.empleado_id) from public.tareas_turno_participantes p
                                where p.tarea_id = t.id), '{}') end as duenos
    from public.tareas_turno t
    where t.fecha between p_lunes and v_hasta and t.tipo_actividad = 'puntual'
  ),
  c as (
    select b.*, (b.cierre = 'hecha' and (b.limite_at is null or b.completada_at <= b.limite_at)) as a_tiempo
    from base b
  ),
  persona as (
    select d.emp, count(*) filter (where c.cierre <> 'cancelada') as tareas,
           count(*) filter (where c.cierre = 'hecha') as hechas,
           count(*) filter (where c.a_tiempo) as a_tiempo,
           count(*) filter (where c.cierre = 'no_se_pudo') as no_se_pudo,
           count(*) filter (where c.cierre = 'sin_hacer') as sin_hacer
    from c cross join lateral unnest(c.duenos) d(emp) group by d.emp
  )
  select jsonb_build_object(
    'desde', p_lunes, 'hasta', v_hasta, 'calculado_at', now(),
    'totales', (select jsonb_build_object(
        'tareas', count(*) filter (where cierre <> 'cancelada'),
        'hechas', count(*) filter (where cierre = 'hecha'),
        'a_tiempo', count(*) filter (where a_tiempo),
        'con_atraso', count(*) filter (where cierre = 'hecha' and not a_tiempo),
        'no_se_pudo', count(*) filter (where cierre = 'no_se_pudo'),
        'sin_hacer', count(*) filter (where cierre = 'sin_hacer'),
        'abiertas', count(*) filter (where cierre = 'abierta'),
        'canceladas', count(*) filter (where cierre = 'cancelada')) from c),
    'por_turno', coalesce((select jsonb_agg(x order by x.turno_id) from (
        select c.turno_id, tp.nombre, count(*) filter (where c.cierre = 'hecha') as hechas,
               count(*) filter (where c.a_tiempo) as a_tiempo,
               count(*) filter (where c.cierre = 'no_se_pudo') as no_se_pudo,
               count(*) filter (where c.cierre = 'sin_hacer') as sin_hacer
        from c left join public.turnos_plantilla tp on tp.id = c.turno_id
        group by c.turno_id, tp.nombre) x), '[]'),
    'por_persona', coalesce((select jsonb_agg(x order by x.nombre) from (
        select p.*, e.nombre || coalesce(' ' || e.apellido, '') as nombre
        from persona p join public.empleados e on e.id = p.emp) x), '[]'),
    'no_se_pudo_motivos', coalesce((select jsonb_object_agg(m.motivo, m.n) from (
        select motivo_no_se_pudo::text as motivo, count(*) as n from c
        where cierre = 'no_se_pudo' group by 1) m), '{}'),
    'mas_atrasadas', coalesce((select jsonb_agg(x order by x.veces desc, x.titulo) from (
        select c.titulo, c.turno_id, count(*) as veces from c
        where c.cierre = 'sin_hacer' or (c.cierre = 'hecha' and not c.a_tiempo)
        group by c.titulo, c.turno_id order by count(*) desc, c.titulo limit 5) x), '[]'),
    'marcadas_por_otro', (select count(*) from public.tareas_eventos ev
        where ev.created_at >= v_desde_at and ev.created_at < v_hasta_at
          and ev.tipo in ('completada', 'no_se_pudo') and cardinality(ev.en_nombre_de) > 0),
    'por_otro_quien', coalesce((select jsonb_object_agg(x.actor_nombre, x.n) from (
        select ev.actor_nombre, count(*) as n from public.tareas_eventos ev
        where ev.created_at >= v_desde_at and ev.created_at < v_hasta_at
          and ev.tipo in ('completada', 'no_se_pudo') and cardinality(ev.en_nombre_de) > 0
        group by 1) x), '{}'),
    'cambios_rutina', (select count(*) from public.tareas_eventos ev
        where ev.created_at >= v_desde_at and ev.created_at < v_hasta_at and ev.entidad = 'rutina'
          and ev.actor_usuario_id is not null and ev.tipo in ('creada', 'editada', 'quitada', 'reactivada')),
    'cambios_agenda', (select count(*) from public.tareas_eventos ev
        where ev.created_at >= v_desde_at and ev.created_at < v_hasta_at and ev.entidad = 'agenda'
          and ev.actor_usuario_id is not null
          and ev.tipo in ('creada', 'editada', 'cancelada', 'hora_corregida', 'reabierta', 'trasladada')),
    'pedidos', (select jsonb_build_object('creados', count(*),
          'aprobados', count(*) filter (where estado = 'aprobado'),
          'rechazados', count(*) filter (where estado = 'rechazado'),
          'pendientes', count(*) filter (where estado = 'pendiente'))
        from public.tareas_pedidos where created_at >= v_desde_at and created_at < v_hasta_at),
    'avisos', (select count(*) from public.tareas_avisos a where a.fecha between p_lunes and v_hasta)
  ) into v;
  return v;
end;
$$;

revoke execute on function public.fn_tareas_resumen_semana(date) from public, anon;
grant execute on function public.fn_tareas_resumen_semana(date) to authenticated;

do $$
begin
  if has_table_privilege('authenticated', 'public.tareas_resumenes', 'INSERT')
     or has_table_privilege('authenticated', 'public.tareas_resumenes', 'DELETE')
     or has_function_privilege('anon', 'public.fn_tareas_resumen_semana(date)', 'EXECUTE') then
    raise exception '295: quedaron mal los permisos.';
  end if;
end $$;

notify pgrst, 'reload schema';
