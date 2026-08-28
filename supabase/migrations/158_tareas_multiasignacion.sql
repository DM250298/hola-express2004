-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 158 · Tareas v2 — multiasignación, grupal, recurrencia    ║
-- ║  ampliada, rechazo y cumplimiento                                    ║
-- ║                                                                     ║
-- ║  Extiende el módulo de tareas operativas (089/091):                  ║
-- ║   · Plantillas asignables a VARIOS empleados o a "todos" (dinámico:  ║
-- ║     se resuelve contra empleados activos al materializar).           ║
-- ║   · Modo 'grupal': una sola instancia por día; la cierra el primero  ║
-- ║     que la completa (empleado_id NULL + tabla de participantes).     ║
-- ║   · Recurrencia: dias_semana (existente) + dia_mes + cada_n_dias,    ║
-- ║     con vigencia desde/hasta.                                        ║
-- ║   · Rechazo: la encargada devuelve una completada (con motivo) a     ║
-- ║     pendiente. Queda el último rechazo + contador.                   ║
-- ║   · Permiso nuevo 'tareas_gestion' (encargado + admin): gestionar    ║
-- ║     tareas deja de estar abierto a todo 'rrhh' (cajero/fiambrero).   ║
-- ║   · fn_cumplimiento_tareas: agregados por empleado y por tarea para  ║
-- ║     la pantalla de control (rango de fechas).                        ║
-- ║                                                                     ║
-- ║  tareas_recurrentes.empleado_id queda DEPRECADO (nullable): la       ║
-- ║  fuente de verdad pasa a alcance + tareas_recurrentes_asignados.     ║
-- ║  No se dropea todavía (ventana entre correr esto y deployar la UI). ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. Enums nuevos ─────────────────────────────────────────────────────
do $$ begin
  create type public.modo_tarea as enum ('individual', 'grupal');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tipo_recurrencia_tarea as enum
    ('dias_semana', 'dia_mes', 'cada_n_dias');
exception when duplicate_object then null; end $$;

-- ─── 2. tareas_recurrentes: alcance, modo, recurrencia, vigencia ─────────
alter table public.tareas_recurrentes
  alter column empleado_id drop not null;  -- DEPRECADO: manda la tabla puente

alter table public.tareas_recurrentes
  add column if not exists alcance text not null default 'empleados'
    check (alcance in ('empleados', 'todos')),
  add column if not exists modo public.modo_tarea not null default 'individual',
  add column if not exists tipo_recurrencia public.tipo_recurrencia_tarea
    not null default 'dias_semana',
  add column if not exists dia_mes integer check (dia_mes between 1 and 31),
  add column if not exists cada_n_dias integer check (cada_n_dias >= 1),
  add column if not exists fecha_base date,   -- ancla de 'cada_n_dias'
  add column if not exists vigencia_desde date,
  add column if not exists vigencia_hasta date;

create table if not exists public.tareas_recurrentes_asignados (
  plantilla_id uuid    not null references public.tareas_recurrentes(id) on delete cascade,
  empleado_id  integer not null references public.empleados(id) on delete cascade,
  primary key (plantilla_id, empleado_id)
);
create index if not exists tareas_rec_asig_emp_idx
  on public.tareas_recurrentes_asignados (empleado_id);

-- Backfill: cada plantilla existente (1 responsable) → 1 fila puente.
insert into public.tareas_recurrentes_asignados (plantilla_id, empleado_id)
select id, empleado_id from public.tareas_recurrentes
where empleado_id is not null
on conflict do nothing;

-- ─── 3. tareas_turno: grupal + rechazo ───────────────────────────────────
alter table public.tareas_turno
  alter column empleado_id drop not null;  -- NULL = instancia grupal

alter table public.tareas_turno
  add column if not exists modo public.modo_tarea not null default 'individual',
  add column if not exists rechazada_por uuid references public.usuarios(id),
  add column if not exists rechazada_at timestamptz,
  add column if not exists motivo_rechazo text,
  add column if not exists rechazos_count integer not null default 0;

create table if not exists public.tareas_turno_participantes (
  tarea_id    uuid    not null references public.tareas_turno(id) on delete cascade,
  empleado_id integer not null references public.empleados(id) on delete cascade,
  primary key (tarea_id, empleado_id)
);
create index if not exists tareas_turno_part_emp_idx
  on public.tareas_turno_participantes (empleado_id);

-- ─── 4. Idempotencia de la materialización (índices nuevos) ──────────────
-- El viejo (plantilla_id, fecha) impide el fan-out a N empleados: lo
-- reemplazan dos parciales — 1 instancia por (plantilla, día, empleado)
-- para las individuales, 1 instancia grupal por (plantilla, día).
drop index if exists public.tareas_turno_plantilla_fecha_uq;

create unique index if not exists tareas_turno_plantilla_fecha_emp_uq
  on public.tareas_turno (plantilla_id, fecha, empleado_id)
  where plantilla_id is not null and empleado_id is not null;

create unique index if not exists tareas_turno_plantilla_fecha_grupal_uq
  on public.tareas_turno (plantilla_id, fecha)
  where plantilla_id is not null and empleado_id is null;

-- ─── 5. RLS (gestión pasa de 'rrhh' a 'tareas_gestion') ──────────────────
-- Se recrean TODAS las policies del módulo con el patrón InitPlan
-- (select fn_tiene_permiso(...)) — las de la 089 eran previas a la 111.

-- Plantillas: solo gestión.
drop policy if exists "tareas_rec_rw" on public.tareas_recurrentes;
create policy "tareas_rec_rw" on public.tareas_recurrentes for all to authenticated
  using ((select public.fn_tiene_permiso('tareas_gestion')))
  with check ((select public.fn_tiene_permiso('tareas_gestion')));

alter table public.tareas_recurrentes_asignados enable row level security;
drop policy if exists "tareas_rec_asig_rw" on public.tareas_recurrentes_asignados;
create policy "tareas_rec_asig_rw" on public.tareas_recurrentes_asignados
  for all to authenticated
  using ((select public.fn_tiene_permiso('tareas_gestion')))
  with check ((select public.fn_tiene_permiso('tareas_gestion')));

-- Instancias: gestión ve/edita todo; el empleado ve las suyas y las
-- grupales donde participa. El empleado completa vía fn_completar_tarea.
drop policy if exists "tareas_turno_select" on public.tareas_turno;
drop policy if exists "tareas_turno_write"  on public.tareas_turno;
create policy "tareas_turno_select" on public.tareas_turno for select to authenticated
  using (
    (select public.fn_tiene_permiso('tareas_gestion'))
    or (select public.fn_tiene_permiso('rrhh'))  -- tablero RRHH sigue leyendo agregados
    or empleado_id in (select id from public.empleados where usuario_id = auth.uid())
    or id in (
      select p.tarea_id
      from public.tareas_turno_participantes p
      join public.empleados e on e.id = p.empleado_id
      where e.usuario_id = auth.uid()
    )
  );
create policy "tareas_turno_write" on public.tareas_turno for all to authenticated
  using ((select public.fn_tiene_permiso('tareas_gestion')))
  with check ((select public.fn_tiene_permiso('tareas_gestion')));

alter table public.tareas_turno_participantes enable row level security;
drop policy if exists "tareas_turno_part_select" on public.tareas_turno_participantes;
drop policy if exists "tareas_turno_part_write"  on public.tareas_turno_participantes;
create policy "tareas_turno_part_select" on public.tareas_turno_participantes
  for select to authenticated
  using (
    (select public.fn_tiene_permiso('tareas_gestion'))
    or (select public.fn_tiene_permiso('rrhh'))
    or empleado_id in (select id from public.empleados where usuario_id = auth.uid())
    or tarea_id in (
      select p2.tarea_id
      from public.tareas_turno_participantes p2
      join public.empleados e on e.id = p2.empleado_id
      where e.usuario_id = auth.uid()
    )
  );
create policy "tareas_turno_part_write" on public.tareas_turno_participantes
  for all to authenticated
  using ((select public.fn_tiene_permiso('tareas_gestion')))
  with check ((select public.fn_tiene_permiso('tareas_gestion')));

-- Storage tareas-evidencia: subir sigue abierto a rrhh/empleados con legajo
-- (los que completan); editar/borrar suma la gestión.
drop policy if exists "tareas_evid_subir"  on storage.objects;
drop policy if exists "tareas_evid_editar" on storage.objects;
drop policy if exists "tareas_evid_borrar" on storage.objects;
create policy "tareas_evid_subir" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'tareas-evidencia'
    and (
      (select public.fn_tiene_permiso('rrhh'))
      or (select public.fn_tiene_permiso('tareas_gestion'))
      or exists (select 1 from public.empleados e where e.usuario_id = auth.uid())
    )
  );
create policy "tareas_evid_editar" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'tareas-evidencia'
    and ((select public.fn_tiene_permiso('tareas_gestion'))
         or (select public.fn_tiene_permiso('rrhh')) or owner = auth.uid())
  )
  with check (
    bucket_id = 'tareas-evidencia'
    and ((select public.fn_tiene_permiso('tareas_gestion'))
         or (select public.fn_tiene_permiso('rrhh')) or owner = auth.uid())
  );
create policy "tareas_evid_borrar" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'tareas-evidencia'
    and ((select public.fn_tiene_permiso('tareas_gestion'))
         or (select public.fn_tiene_permiso('rrhh')))
  );

-- ─── 6. fn_materializar_tareas_turno v2 (misma firma) ────────────────────
-- Fan-out: las plantillas del día generan N instancias individuales (una
-- por asignado activo) o 1 instancia grupal + sus participantes. La
-- resolución de asignados es DINÁMICA (empleados activos al materializar).
-- Fallback deploy-window: plantilla vieja sin fila puente usa empleado_id.
create or replace function public.fn_materializar_tareas_turno(p_fecha date)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer := 0;
  v_m integer;
  v_dow integer := extract(dow from p_fecha)::integer;
  v_dia integer := extract(day from p_fecha)::integer;
  v_fin_mes date := (date_trunc('month', p_fecha) + interval '1 month - 1 day')::date;
  v_hoy date := (timezone('America/Argentina/Buenos_Aires', now()))::date;
begin
  -- El cron la llama con service_role (auth.uid null → pasa). Un usuario debe
  -- tener gestión de tareas, RRHH operativo o su panel; fecha acotada para
  -- que nadie genere tareas masivas en fechas arbitrarias.
  if auth.uid() is not null
     and not (public.fn_tiene_permiso('tareas_gestion')
              or public.fn_tiene_permiso('rrhh')
              or public.fn_tiene_permiso('mi_panel')) then
    raise exception 'Sin permiso.';
  end if;
  if p_fecha < v_hoy - 1 or p_fecha > v_hoy + 7 then
    raise exception 'Fecha fuera de rango.';
  end if;

  -- 6.a Individuales: una instancia por (plantilla del día × asignado activo).
  with plantillas_hoy as (
    select r.*
    from public.tareas_recurrentes r
    where r.activa
      and (r.vigencia_desde is null or p_fecha >= r.vigencia_desde)
      and (r.vigencia_hasta is null or p_fecha <= r.vigencia_hasta)
      and (
        (r.tipo_recurrencia = 'dias_semana' and v_dow = any(r.dias_semana))
        or (r.tipo_recurrencia = 'dia_mes' and r.dia_mes is not null and (
              v_dia = r.dia_mes
              -- "día 31" cae el último día de los meses cortos
              or (p_fecha = v_fin_mes and r.dia_mes > v_dia)
           ))
        or (r.tipo_recurrencia = 'cada_n_dias' and r.cada_n_dias is not null and (
              p_fecha >= coalesce(r.fecha_base, (timezone('America/Argentina/Buenos_Aires', r.created_at))::date)
              and (p_fecha - coalesce(r.fecha_base, (timezone('America/Argentina/Buenos_Aires', r.created_at))::date))
                  % r.cada_n_dias = 0
           ))
      )
  ),
  asignados as (
    select p.id as plantilla_id, e.id as empleado_id
    from plantillas_hoy p
    cross join public.empleados e
    where p.alcance = 'todos' and e.activo
    union
    select p.id, a.empleado_id
    from plantillas_hoy p
    join public.tareas_recurrentes_asignados a on a.plantilla_id = p.id
    join public.empleados e on e.id = a.empleado_id and e.activo
    where p.alcance = 'empleados'
    union
    -- fallback: plantilla vieja (pre-158) sin fila puente todavía
    select p.id, p.empleado_id
    from plantillas_hoy p
    join public.empleados e on e.id = p.empleado_id and e.activo
    where p.alcance = 'empleados' and p.empleado_id is not null
      and not exists (select 1 from public.tareas_recurrentes_asignados a
                      where a.plantilla_id = p.id)
  )
  insert into public.tareas_turno (
    plantilla_id, titulo, descripcion, empleado_id, turno_id, fecha,
    prioridad, requiere_evidencia, estado, modo, usuario_id
  )
  select p.id, p.titulo, p.descripcion, a.empleado_id, p.turno_id, p_fecha,
         p.prioridad, p.requiere_evidencia, 'pendiente', 'individual', p.usuario_id
  from plantillas_hoy p
  join asignados a on a.plantilla_id = p.id
  where p.modo = 'individual'
  on conflict (plantilla_id, fecha, empleado_id)
    where plantilla_id is not null and empleado_id is not null do nothing;
  get diagnostics v_m = row_count;
  v_n := v_n + v_m;

  -- 6.b Grupales: UNA instancia por plantilla del día (empleado_id NULL).
  with plantillas_hoy as (
    select r.*
    from public.tareas_recurrentes r
    where r.activa
      and (r.vigencia_desde is null or p_fecha >= r.vigencia_desde)
      and (r.vigencia_hasta is null or p_fecha <= r.vigencia_hasta)
      and (
        (r.tipo_recurrencia = 'dias_semana' and v_dow = any(r.dias_semana))
        or (r.tipo_recurrencia = 'dia_mes' and r.dia_mes is not null and (
              v_dia = r.dia_mes
              or (p_fecha = v_fin_mes and r.dia_mes > v_dia)
           ))
        or (r.tipo_recurrencia = 'cada_n_dias' and r.cada_n_dias is not null and (
              p_fecha >= coalesce(r.fecha_base, (timezone('America/Argentina/Buenos_Aires', r.created_at))::date)
              and (p_fecha - coalesce(r.fecha_base, (timezone('America/Argentina/Buenos_Aires', r.created_at))::date))
                  % r.cada_n_dias = 0
           ))
      )
  )
  insert into public.tareas_turno (
    plantilla_id, titulo, descripcion, empleado_id, turno_id, fecha,
    prioridad, requiere_evidencia, estado, modo, usuario_id
  )
  select p.id, p.titulo, p.descripcion, null, p.turno_id, p_fecha,
         p.prioridad, p.requiere_evidencia, 'pendiente', 'grupal', p.usuario_id
  from plantillas_hoy p
  where p.modo = 'grupal'
  on conflict (plantilla_id, fecha)
    where plantilla_id is not null and empleado_id is null do nothing;
  get diagnostics v_m = row_count;
  v_n := v_n + v_m;

  -- 6.c Participantes de las grupales del día (incremental: si se editó la
  -- plantilla hoy mismo, los asignados nuevos se suman a la instancia).
  with plantillas_hoy as (
    select r.*
    from public.tareas_recurrentes r
    where r.activa and r.modo = 'grupal'
      and (r.vigencia_desde is null or p_fecha >= r.vigencia_desde)
      and (r.vigencia_hasta is null or p_fecha <= r.vigencia_hasta)
  ),
  asignados as (
    select p.id as plantilla_id, e.id as empleado_id
    from plantillas_hoy p
    cross join public.empleados e
    where p.alcance = 'todos' and e.activo
    union
    select p.id, a.empleado_id
    from plantillas_hoy p
    join public.tareas_recurrentes_asignados a on a.plantilla_id = p.id
    join public.empleados e on e.id = a.empleado_id and e.activo
    where p.alcance = 'empleados'
  )
  insert into public.tareas_turno_participantes (tarea_id, empleado_id)
  select t.id, a.empleado_id
  from asignados a
  join public.tareas_turno t
    on t.plantilla_id = a.plantilla_id and t.fecha = p_fecha and t.empleado_id is null
  on conflict do nothing;

  return v_n;
end $$;
grant execute on function public.fn_materializar_tareas_turno(date) to authenticated, service_role;

-- ─── 7. fn_completar_tarea v2 (misma firma) ──────────────────────────────
-- Cambios: acepta 'vencida' (re-completar tras un rechazo tardío o cerrar
-- tarde con timestamp real); grupal → cualquier participante puede; la
-- gestión completa cualquiera (antes: todo 'rrhh').
create or replace function public.fn_completar_tarea(
  p_tarea_id uuid,
  p_evidencia_url text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_t record; v_emp integer;
begin
  select * into v_t from public.tareas_turno where id = p_tarea_id;
  if v_t.id is null then raise exception 'Tarea inexistente.'; end if;
  if v_t.estado not in ('pendiente', 'en_curso', 'vencida') then
    raise exception 'La tarea no se puede completar en su estado actual (%).', v_t.estado;
  end if;

  select id into v_emp from public.empleados where usuario_id = auth.uid();

  -- Permiso: gestión, el responsable (individual), o un participante (grupal).
  if not public.fn_tiene_permiso('tareas_gestion') then
    if v_t.empleado_id is not null then
      if v_emp is null or v_emp <> v_t.empleado_id then
        raise exception 'Sin permiso para completar esta tarea.';
      end if;
    else
      if v_emp is null or not exists (
        select 1 from public.tareas_turno_participantes p
        where p.tarea_id = p_tarea_id and p.empleado_id = v_emp
      ) then
        raise exception 'Sin permiso para completar esta tarea.';
      end if;
    end if;
  end if;

  if v_t.requiere_evidencia then
    if p_evidencia_url is null or btrim(p_evidencia_url) = '' then
      raise exception 'Esta tarea requiere una foto de evidencia.';
    end if;
    if position('/storage/v1/object/public/tareas-evidencia/' in p_evidencia_url) = 0 then
      raise exception 'La evidencia debe ser una foto subida al sistema.';
    end if;
  end if;

  update public.tareas_turno set
    estado = 'completada',
    completada_por = v_emp,  -- quién la cerró (NULL si fue gestión sin legajo)
    completada_at = now(),
    evidencia_url = coalesce(p_evidencia_url, evidencia_url)
  where id = p_tarea_id;
end $$;
grant execute on function public.fn_completar_tarea(uuid, text) to authenticated;

-- ─── 8. fn_rechazar_tarea — la encargada devuelve una completada ─────────
create or replace function public.fn_rechazar_tarea(
  p_tarea_id uuid,
  p_motivo text
) returns void language plpgsql security definer set search_path = public as $$
declare v_t record;
begin
  if not public.fn_tiene_permiso('tareas_gestion') then
    raise exception 'Sin permiso para rechazar tareas.';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'El motivo del rechazo es obligatorio.';
  end if;

  select * into v_t from public.tareas_turno where id = p_tarea_id;
  if v_t.id is null then raise exception 'Tarea inexistente.'; end if;
  if v_t.estado <> 'completada' then
    raise exception 'Solo se puede rechazar una tarea completada (estado actual: %).', v_t.estado;
  end if;

  update public.tareas_turno set
    estado = 'pendiente',
    rechazada_por = auth.uid(),
    rechazada_at = now(),
    motivo_rechazo = btrim(p_motivo),
    rechazos_count = rechazos_count + 1,
    completada_por = null,
    completada_at = null,
    evidencia_url = null   -- la foto rechazada se descarta de la instancia
  where id = p_tarea_id;
end $$;
grant execute on function public.fn_rechazar_tarea(uuid, text) to authenticated;

-- ─── 9. fn_cumplimiento_tareas — control histórico por rango ─────────────
-- Agregación server-side para la pantalla de cumplimiento. Reglas:
--  · Individual: cuenta 1 asignada al responsable; completada/vencida según estado.
--  · Grupal completada: suma 1/1 SOLO a quien la hizo (completada_por); a los
--    demás participantes no les cuenta (ni asignada) — no penaliza.
--  · Grupal vencida/pendiente: no penaliza a nadie por_empleado; se ve
--    en por_tarea (ahí se nota que "nadie la hizo").
create or replace function public.fn_cumplimiento_tareas(
  p_desde date,
  p_hasta date,
  p_empleado_id integer default null
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not public.fn_tiene_permiso('tareas_gestion') then
    raise exception 'Sin permiso para ver el cumplimiento de tareas.';
  end if;
  if p_hasta < p_desde then
    raise exception 'Rango de fechas inválido.';
  end if;
  if p_hasta - p_desde > 366 then
    raise exception 'El rango no puede superar un año.';
  end if;

  select jsonb_build_object(
    'por_empleado', coalesce((
      select jsonb_agg(jsonb_build_object(
               'empleado_id', y.empleado_id, 'nombre', y.nombre, 'apellido', y.apellido,
               'asignadas', y.asignadas, 'completadas', y.completadas,
               'vencidas', y.vencidas, 'pendientes', y.pendientes,
               'rechazos', y.rechazos,
               'pct', case when y.asignadas = 0 then null
                           else round(y.completadas::numeric / y.asignadas * 100, 1) end
             ) order by y.nombre, y.apellido)
      from (
        select e.id as empleado_id, e.nombre, e.apellido,
               count(*)::int as asignadas,
               count(*) filter (where x.estado = 'completada')::int as completadas,
               count(*) filter (where x.estado = 'vencida')::int    as vencidas,
               count(*) filter (where x.estado in ('pendiente','en_curso'))::int as pendientes,
               coalesce(sum(x.rechazos), 0)::int as rechazos
        from (
          -- individuales del rango (sin canceladas)
          select tt.empleado_id, tt.estado::text as estado, tt.rechazos_count as rechazos
          from public.tareas_turno tt
          where tt.fecha between p_desde and p_hasta
            and tt.estado <> 'cancelada' and tt.empleado_id is not null
          union all
          -- grupales completadas → 1/1 para quien la hizo
          select tt.completada_por, 'completada', tt.rechazos_count
          from public.tareas_turno tt
          where tt.fecha between p_desde and p_hasta
            and tt.empleado_id is null and tt.estado = 'completada'
            and tt.completada_por is not null
        ) x
        join public.empleados e on e.id = x.empleado_id
        where p_empleado_id is null or x.empleado_id = p_empleado_id
        group by e.id, e.nombre, e.apellido
      ) y
    ), '[]'::jsonb),

    'por_tarea', coalesce((
      select jsonb_agg(jsonb_build_object(
               'plantilla_id', z.plantilla_id, 'titulo', z.titulo, 'modo', z.modo,
               'total', z.total, 'completadas', z.completadas,
               'vencidas', z.vencidas, 'pendientes', z.pendientes,
               'rechazos', z.rechazos,
               'pct', case when z.total = 0 then null
                           else round(z.completadas::numeric / z.total * 100, 1) end
             ) order by z.titulo)
      from (
        select tt.plantilla_id, tt.titulo, tt.modo::text as modo,
               count(*)::int as total,
               count(*) filter (where tt.estado = 'completada')::int as completadas,
               count(*) filter (where tt.estado = 'vencida')::int    as vencidas,
               count(*) filter (where tt.estado in ('pendiente','en_curso'))::int as pendientes,
               coalesce(sum(tt.rechazos_count), 0)::int as rechazos
        from public.tareas_turno tt
        where tt.fecha between p_desde and p_hasta
          and tt.estado <> 'cancelada'
          and (p_empleado_id is null
               or tt.empleado_id = p_empleado_id
               or tt.completada_por = p_empleado_id
               or exists (select 1 from public.tareas_turno_participantes p
                          where p.tarea_id = tt.id and p.empleado_id = p_empleado_id))
        group by tt.plantilla_id, tt.titulo, tt.modo
      ) z
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;
revoke execute on function public.fn_cumplimiento_tareas(date, date, integer) from public;
grant execute on function public.fn_cumplimiento_tareas(date, date, integer) to authenticated;

-- ─── 10. fn_calcular_evaluacion v2 (misma firma, base = mig 091) ─────────
-- Único cambio: el CTE `tar` ahora suma las GRUPALES completadas (1/1 a
-- quien las hizo) y excluye las grupales de los demás (no penalizan).
create or replace function public.fn_calcular_evaluacion(
  p_periodo text,
  p_empleado_id integer default null
) returns table (
  empleado_id        integer,
  nombre             text,
  apellido           text,
  legajo             text,
  puesto             text,
  dias_esperados     integer,
  dias_presente      integer,
  tardanzas          integer,
  ausencias          integer,
  incompletos        integer,
  tareas_asignadas   integer,
  tareas_completadas integer,
  puntaje_asistencia numeric,
  puntaje_tareas     numeric,
  puntaje_manual     numeric,
  puntaje_total      numeric,
  comentario         text,
  evaluado_at        timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_desde date;
  v_hasta date;
  v_es_propio boolean;
  v_pen_tard  numeric := 10;
  v_pen_aus   numeric := 34;
  v_pen_inc   numeric := 15;
  v_pon_asis  numeric := 40;
  v_pon_tar   numeric := 40;
  v_pon_man   numeric := 20;
begin
  if p_periodo !~ '^\d{4}-\d{2}$' then
    raise exception 'Período inválido (se espera YYYY-MM): %', p_periodo;
  end if;

  -- Permiso: rrhh ve a todos; un empleado sólo SU propio legajo.
  v_es_propio := p_empleado_id is not null and exists (
    select 1 from public.empleados e
    where e.id = p_empleado_id and e.usuario_id = auth.uid()
  );
  if not public.fn_tiene_permiso('rrhh') and not v_es_propio then
    raise exception 'Sin permiso para ver evaluaciones de desempeño.';
  end if;

  v_desde := (p_periodo || '-01')::date;
  v_hasta := (v_desde + interval '1 month' - interval '1 day')::date;

  -- Parámetros (defaults defensivos si falta la clave).
  select coalesce((valor #>> '{}')::numeric, v_pen_tard) into v_pen_tard from public.rrhh_config where clave = 'eval_penal_tardanza';
  select coalesce((valor #>> '{}')::numeric, v_pen_aus)  into v_pen_aus  from public.rrhh_config where clave = 'eval_penal_ausencia';
  select coalesce((valor #>> '{}')::numeric, v_pen_inc)  into v_pen_inc  from public.rrhh_config where clave = 'eval_penal_incompleto';
  select coalesce((valor #>> '{}')::numeric, v_pon_asis) into v_pon_asis from public.rrhh_config where clave = 'eval_ponderacion_asistencia';
  select coalesce((valor #>> '{}')::numeric, v_pon_tar)  into v_pon_tar  from public.rrhh_config where clave = 'eval_ponderacion_tareas';
  select coalesce((valor #>> '{}')::numeric, v_pon_man)  into v_pon_man  from public.rrhh_config where clave = 'eval_ponderacion_manual';

  return query
  with emp as (
    select e.id, e.nombre, e.apellido, e.legajo, e.puesto
    from public.empleados e
    where e.activo = true
      and (p_empleado_id is null or e.id = p_empleado_id)
  ),
  asis as (
    select ad.empleado_id,
      count(*) filter (where ad.estado in ('presente','tardanza','ausente_injustificado','incompleto'))::int as dias_esperados,
      count(*) filter (where ad.estado = 'presente')::int               as dias_presente,
      count(*) filter (where ad.estado = 'tardanza')::int               as tardanzas,
      count(*) filter (where ad.estado = 'ausente_injustificado')::int  as ausencias,
      count(*) filter (where ad.estado = 'incompleto')::int             as incompletos
    from public.asistencia_diaria ad
    where ad.fecha between v_desde and v_hasta
    group by ad.empleado_id
  ),
  tar as (
    select x.empleado_id,
      sum(x.asig)::int as asignadas,
      sum(x.comp)::int as completadas
    from (
      -- individuales: como siempre
      select tt.empleado_id, 1 as asig, (tt.estado = 'completada')::int as comp
      from public.tareas_turno tt
      where tt.fecha between v_desde and v_hasta
        and tt.estado <> 'cancelada'
        and tt.empleado_id is not null
      union all
      -- grupales completadas: 1/1 solo para quien la cerró
      select tt.completada_por, 1, 1
      from public.tareas_turno tt
      where tt.fecha between v_desde and v_hasta
        and tt.empleado_id is null
        and tt.estado = 'completada'
        and tt.completada_por is not null
    ) x
    group by x.empleado_id
  ),
  calc as (
    select
      emp.id as empleado_id, emp.nombre, emp.apellido, emp.legajo, emp.puesto,
      coalesce(a.dias_esperados, 0)  as dias_esperados,
      coalesce(a.dias_presente, 0)   as dias_presente,
      coalesce(a.tardanzas, 0)       as tardanzas,
      coalesce(a.ausencias, 0)       as ausencias,
      coalesce(a.incompletos, 0)     as incompletos,
      coalesce(t.asignadas, 0)       as tareas_asignadas,
      coalesce(t.completadas, 0)     as tareas_completadas,
      -- Asistencia: null si no tuvo días con turno; si no, 100 menos penales.
      case when coalesce(a.dias_esperados, 0) = 0 then null
           else greatest(0, least(100,
                  100 - v_pen_tard * coalesce(a.tardanzas, 0)
                      - v_pen_aus  * coalesce(a.ausencias, 0)
                      - v_pen_inc  * coalesce(a.incompletos, 0)))
      end as p_asis,
      -- Tareas: null si no tenía tareas; si no, tasa de cumplimiento.
      case when coalesce(t.asignadas, 0) = 0 then null
           else round(coalesce(t.completadas, 0)::numeric / t.asignadas * 100, 2)
      end as p_tar,
      ev.puntaje_manual as p_man,
      ev.comentario,
      ev.updated_at as evaluado_at
    from emp
    left join asis a on a.empleado_id = emp.id
    left join tar  t on t.empleado_id = emp.id
    left join public.evaluacion_desempeno ev
      on ev.empleado_id = emp.id and ev.periodo = p_periodo
  )
  select
    calc.empleado_id, calc.nombre, calc.apellido, calc.legajo, calc.puesto,
    calc.dias_esperados, calc.dias_presente, calc.tardanzas, calc.ausencias, calc.incompletos,
    calc.tareas_asignadas, calc.tareas_completadas,
    calc.p_asis, calc.p_tar, calc.p_man,
    -- Total ponderado SÓLO sobre los componentes disponibles (peso del que
    -- falta se redistribuye al normalizar por la suma de pesos presentes).
    case
      when calc.p_asis is null and calc.p_tar is null and calc.p_man is null then null
      else round(
        ( coalesce(calc.p_asis * v_pon_asis, 0)
        + coalesce(calc.p_tar  * v_pon_tar,  0)
        + coalesce(calc.p_man  * v_pon_man,  0) )
        / nullif(
            (case when calc.p_asis is not null then v_pon_asis else 0 end)
          + (case when calc.p_tar  is not null then v_pon_tar  else 0 end)
          + (case when calc.p_man  is not null then v_pon_man  else 0 end)
        , 0)
      , 2)
    end as puntaje_total,
    calc.comentario, calc.evaluado_at
  from calc
  order by calc.nombre, calc.apellido;
end $$;

revoke execute on function public.fn_calcular_evaluacion(text, integer) from public;
grant execute on function public.fn_calcular_evaluacion(text, integer) to authenticated;

-- ─── 11. Permiso 'tareas_gestion' → encargado + admin ────────────────────
-- (admin bypassa fn_tiene_permiso, pero se agrega para que la matriz de
-- Configuración lo muestre tildado.)
do $$ begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'roles') then
    update public.roles
       set permisos = array_append(permisos, 'tareas_gestion')
     where codigo in ('admin', 'encargado')
       and not ('tareas_gestion' = any(permisos));
  end if;
end $$;

notify pgrst, 'reload schema';

-- ─── Smoke tests (correr a mano después de la migración) ─────────────────
-- 1) Funciones duplicadas (debe dar 0 filas):
--    select proname, count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and proname like 'fn_%'
--    group by proname having count(*) > 1;
-- 2) Backfill completo (debe dar 0):
--    select count(*) from public.tareas_recurrentes r
--    left join public.tareas_recurrentes_asignados a on a.plantilla_id = r.id
--    where r.alcance = 'empleados' and r.empleado_id is not null and a.plantilla_id is null;
-- 3) Idempotencia: select public.fn_materializar_tareas_turno(current_date);
--    dos veces seguidas → la segunda devuelve 0.
-- 4) Permiso: select 'tareas_gestion' = any(permisos) from public.roles
--    where codigo = 'encargado';  → true
