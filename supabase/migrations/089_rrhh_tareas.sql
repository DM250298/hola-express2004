-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 089 · RRHH Sprint 3 — Tareas operativas                  ║
-- ║                                                                     ║
-- ║  Tareas asignadas a un empleado (T6: SIEMPRE con responsable), con  ║
-- ║  prioridad, fecha, evidencia por foto y recurrencia.                ║
-- ║                                                                     ║
-- ║  Dos tablas (NO chocan con `tareas` de Proyectos):                  ║
-- ║   · tareas_recurrentes → PLANTILLAS (qué se repite y qué días).     ║
-- ║   · tareas_turno        → INSTANCIAS del día (lo que se ve/completa).║
-- ║                                                                     ║
-- ║  Materialización: el cron diario (06:00 AR) llama                   ║
-- ║  fn_materializar_tareas_turno(hoy); idempotente por UNIQUE          ║
-- ║  (plantilla_id, fecha). Fallback on-demand desde la UI.             ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. Enums ────────────────────────────────────────────────────────────
do $$ begin
  create type public.prioridad_tarea as enum ('baja', 'media', 'alta');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_tarea_turno as enum
    ('pendiente', 'en_curso', 'completada', 'vencida', 'cancelada');
exception when duplicate_object then null; end $$;

-- ─── 2. Plantillas de tareas recurrentes ─────────────────────────────────
create table if not exists public.tareas_recurrentes (
  id                 uuid primary key default gen_random_uuid(),
  titulo             text not null,
  descripcion        text,
  empleado_id        integer not null references public.empleados(id) on delete cascade, -- responsable (T6)
  turno_id           integer references public.turnos_plantilla(id),  -- contexto opcional
  dias_semana        integer[] not null default '{}',  -- dow 0=domingo … 6=sábado
  prioridad          public.prioridad_tarea not null default 'media',
  requiere_evidencia boolean not null default false,
  activa             boolean not null default true,
  usuario_id         uuid references public.usuarios(id),
  created_at         timestamptz not null default now()
);
create index if not exists tareas_rec_empleado_idx on public.tareas_recurrentes (empleado_id);

-- ─── 3. Instancias (lo que se ve y se completa) ──────────────────────────
create table if not exists public.tareas_turno (
  id                 uuid primary key default gen_random_uuid(),
  plantilla_id       uuid references public.tareas_recurrentes(id) on delete set null,
  titulo             text not null,
  descripcion        text,
  empleado_id        integer not null references public.empleados(id) on delete cascade, -- responsable
  turno_id           integer references public.turnos_plantilla(id),
  fecha              date not null,
  prioridad          public.prioridad_tarea not null default 'media',
  requiere_evidencia boolean not null default false,
  estado             public.estado_tarea_turno not null default 'pendiente',
  evidencia_url      text,
  completada_por     integer references public.empleados(id),
  completada_at      timestamptz,
  notas              text,
  usuario_id         uuid references public.usuarios(id),
  created_at         timestamptz not null default now()
);
-- Idempotencia de la materialización: una plantilla genera 1 instancia por día.
create unique index if not exists tareas_turno_plantilla_fecha_uq
  on public.tareas_turno (plantilla_id, fecha)
  where plantilla_id is not null;
create index if not exists tareas_turno_emp_fecha_idx on public.tareas_turno (empleado_id, fecha);
create index if not exists tareas_turno_fecha_estado_idx on public.tareas_turno (fecha, estado);

-- ─── 4. Bucket de evidencia (público, foto de tarea completada) ──────────
insert into storage.buckets (id, name, public) values
  ('tareas-evidencia', 'tareas-evidencia', true)
on conflict (id) do nothing;

drop policy if exists "tareas_evid_subir"  on storage.objects;
drop policy if exists "tareas_evid_editar" on storage.objects;
drop policy if exists "tareas_evid_borrar" on storage.objects;
-- Suben RRHH o cualquier empleado con legajo (no un cajero suelto); editar sólo
-- el dueño del archivo o RRHH. La lectura es pública (bucket público).
create policy "tareas_evid_subir" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'tareas-evidencia'
    and (
      public.fn_tiene_permiso('rrhh')
      or exists (select 1 from public.empleados e where e.usuario_id = auth.uid())
    )
  );
create policy "tareas_evid_editar" on storage.objects
  for update to authenticated
  using (bucket_id = 'tareas-evidencia' and (public.fn_tiene_permiso('rrhh') or owner = auth.uid()))
  with check (bucket_id = 'tareas-evidencia' and (public.fn_tiene_permiso('rrhh') or owner = auth.uid()));
create policy "tareas_evid_borrar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'tareas-evidencia' and public.fn_tiene_permiso('rrhh'));

-- ─── 5. RLS ──────────────────────────────────────────────────────────────
-- Plantillas: sólo RRHH (operativo).
alter table public.tareas_recurrentes enable row level security;
drop policy if exists "tareas_rec_rw" on public.tareas_recurrentes;
create policy "tareas_rec_rw" on public.tareas_recurrentes for all to authenticated
  using (public.fn_tiene_permiso('rrhh')) with check (public.fn_tiene_permiso('rrhh'));

-- Instancias: RRHH ve/edita todo; el empleado ve LAS SUYAS (su checklist).
-- La escritura directa es de RRHH; el empleado completa vía fn_completar_tarea.
alter table public.tareas_turno enable row level security;
drop policy if exists "tareas_turno_select" on public.tareas_turno;
drop policy if exists "tareas_turno_write"  on public.tareas_turno;
create policy "tareas_turno_select" on public.tareas_turno for select to authenticated
  using (
    public.fn_tiene_permiso('rrhh')
    or empleado_id in (select id from public.empleados where usuario_id = auth.uid())
  );
create policy "tareas_turno_write" on public.tareas_turno for all to authenticated
  using (public.fn_tiene_permiso('rrhh')) with check (public.fn_tiene_permiso('rrhh'));

-- ─── 6. fn_materializar_tareas_turno ─────────────────────────────────────
-- Genera las instancias del día desde las plantillas activas cuyo día de
-- semana coincide. Idempotente. La llama el cron (service_role) y la UI.
create or replace function public.fn_materializar_tareas_turno(p_fecha date)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
  v_dow integer := extract(dow from p_fecha)::integer;
  v_hoy date := (timezone('America/Argentina/Buenos_Aires', now()))::date;
begin
  -- El cron la llama con service_role (auth.uid null → pasa). Un usuario debe
  -- tener permiso operativo de RRHH o su panel (empleado); fecha acotada para
  -- que nadie genere tareas masivas en fechas arbitrarias.
  if auth.uid() is not null
     and not (public.fn_tiene_permiso('rrhh') or public.fn_tiene_permiso('mi_panel')) then
    raise exception 'Sin permiso.';
  end if;
  if p_fecha < v_hoy - 1 or p_fecha > v_hoy + 7 then
    raise exception 'Fecha fuera de rango.';
  end if;

  insert into public.tareas_turno (
    plantilla_id, titulo, descripcion, empleado_id, turno_id, fecha,
    prioridad, requiere_evidencia, estado
  )
  select r.id, r.titulo, r.descripcion, r.empleado_id, r.turno_id, p_fecha,
         r.prioridad, r.requiere_evidencia, 'pendiente'
  from public.tareas_recurrentes r
  where r.activa and v_dow = any(r.dias_semana)
  on conflict (plantilla_id, fecha) where plantilla_id is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
grant execute on function public.fn_materializar_tareas_turno(date) to authenticated, service_role;

-- ─── 7. fn_marcar_tareas_vencidas ────────────────────────────────────────
-- Marca vencidas las tareas de días pasados que no se completaron. La llama
-- el cron. (Opera por fecha < hoy AR.)
create or replace function public.fn_marcar_tareas_vencidas()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer; v_hoy date := (timezone('America/Argentina/Buenos_Aires', now()))::date;
begin
  update public.tareas_turno
    set estado = 'vencida'
    where fecha < v_hoy and estado in ('pendiente', 'en_curso');
  get diagnostics v_n = row_count;
  return v_n;
end $$;
-- Sólo la llama el cron (service_role); ningún cliente la usa.
revoke execute on function public.fn_marcar_tareas_vencidas() from public;
grant execute on function public.fn_marcar_tareas_vencidas() to service_role;

-- ─── 8. fn_completar_tarea ───────────────────────────────────────────────
-- Completa una tarea validando evidencia. El responsable completa la suya;
-- RRHH puede completar cualquiera. Registra quién la completó.
create or replace function public.fn_completar_tarea(
  p_tarea_id uuid,
  p_evidencia_url text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_t record; v_emp integer;
begin
  select * into v_t from public.tareas_turno where id = p_tarea_id;
  if v_t.id is null then raise exception 'Tarea inexistente.'; end if;
  -- Sólo se puede completar lo que está abierto (no re-completar / re-abrir).
  if v_t.estado not in ('pendiente', 'en_curso') then
    raise exception 'La tarea no se puede completar en su estado actual (%).', v_t.estado;
  end if;

  select id into v_emp from public.empleados where usuario_id = auth.uid();

  -- Permiso: RRHH, o el responsable completando la suya.
  if not public.fn_tiene_permiso('rrhh')
     and (v_emp is null or v_emp <> v_t.empleado_id) then
    raise exception 'Sin permiso para completar esta tarea.';
  end if;

  if v_t.requiere_evidencia then
    if p_evidencia_url is null or btrim(p_evidencia_url) = '' then
      raise exception 'Esta tarea requiere una foto de evidencia.';
    end if;
    -- La foto debe venir del bucket de evidencia (no una URL cualquiera).
    if position('/storage/v1/object/public/tareas-evidencia/' in p_evidencia_url) = 0 then
      raise exception 'La evidencia debe ser una foto subida al sistema.';
    end if;
  end if;

  update public.tareas_turno set
    estado = 'completada',
    completada_por = v_emp,  -- quién la cerró (NULL si fue un usuario RRHH sin legajo)
    completada_at = now(),
    evidencia_url = coalesce(p_evidencia_url, evidencia_url)
  where id = p_tarea_id;
end $$;
grant execute on function public.fn_completar_tarea(uuid, text) to authenticated;

notify pgrst, 'reload schema';
