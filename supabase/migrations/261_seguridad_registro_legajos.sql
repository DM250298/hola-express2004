-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  261 · Seguridad: registro inmutable y vínculo usuario–legajo       ║
-- ║  (Tareas v2, Etapa 1 · bloque A)                                     ║
-- ║                                                                     ║
-- ║   · seguridad_eventos: registro de cambios de roles, usuarios y      ║
-- ║     legajos (rol, activo, permisos, cuenta vinculada, puesto).       ║
-- ║     Nadie lo puede editar ni borrar, tampoco el administrador.       ║
-- ║   · Una cuenta de login va con UN solo legajo (índice único).        ║
-- ║     Si hay duplicados, la migración se frena y los lista: hay que    ║
-- ║     desvincular uno antes (en prueba: cajero@pruebas.local).         ║
-- ║   · Vincular o cambiar la cuenta de un legajo exige 'usuarios_roles' ║
-- ║     (antes alcanzaba con rrhh: la encargada podía vincularse a       ║
-- ║     otro legajo).                                                    ║
-- ║   · Nadie borra legajos por la app (se dan de baja, no se borran).   ║
-- ║                                                                     ║
-- ║  Requiere la 260. Correr en las DOS bases. Se puede correr de nuevo. ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

set local lock_timeout = '5s';

-- ─── 0. Requisitos ──────────────────────────────────────────────────────
do $$
declare v_dup text;
begin
  if to_regprocedure('public.fn_sesion_es_sistema()') is null then
    raise exception '261: falta correr la 260.';
  end if;
  select string_agg(format('cuenta %s → legajos %s', usuario_id, ids), '; ')
    into v_dup
  from (select usuario_id, string_agg(id::text, ', ' order by id) as ids
          from public.empleados where usuario_id is not null
         group by usuario_id having count(*) > 1) d;
  if v_dup is not null then
    raise exception '261: hay cuentas vinculadas a más de un legajo. Desvinculá una antes: %', v_dup;
  end if;
end $$;

-- ─── 1. Registro inmutable (lo reusan las tablas de tareas) ─────────────
create or replace function public.fn_trg_registro_inmutable()
returns trigger language plpgsql as $$
begin
  raise exception 'El registro no se puede editar ni borrar.';
end;
$$;
revoke execute on function public.fn_trg_registro_inmutable() from public, anon, authenticated;

create table if not exists public.seguridad_eventos (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default clock_timestamp(),
  tipo             text not null check (tipo in ('rol_creado', 'rol_editado', 'rol_borrado',
                     'usuario_rol', 'usuario_activo', 'empleado_vinculo', 'empleado_puesto')),
  actor_usuario_id uuid,          -- null = sistema (SQL Editor, service role)
  objetivo         text not null, -- código de rol, id de usuario o id de legajo
  antes            jsonb,
  despues          jsonb
);
create index if not exists seguridad_eventos_fecha_idx on public.seguridad_eventos (created_at desc);

alter table public.seguridad_eventos enable row level security;
drop policy if exists seguridad_eventos_select on public.seguridad_eventos;
create policy seguridad_eventos_select on public.seguridad_eventos
  for select to authenticated using ((select public.fn_tiene_permiso('usuarios_roles')));

revoke insert, update, delete, truncate, references, trigger
  on public.seguridad_eventos from public, anon, authenticated, service_role;

drop trigger if exists trg_seguridad_eventos_inmutable on public.seguridad_eventos;
create trigger trg_seguridad_eventos_inmutable
  before update or delete on public.seguridad_eventos
  for each row execute function public.fn_trg_registro_inmutable();
drop trigger if exists trg_seguridad_eventos_sin_truncate on public.seguridad_eventos;
create trigger trg_seguridad_eventos_sin_truncate
  before truncate on public.seguridad_eventos
  for each statement execute function public.fn_trg_registro_inmutable();
alter table public.seguridad_eventos enable always trigger trg_seguridad_eventos_inmutable;
alter table public.seguridad_eventos enable always trigger trg_seguridad_eventos_sin_truncate;

-- Único escritor del registro (definer: inserta como dueño de la tabla).
create or replace function public.fn_seguridad_evento(
  p_tipo text, p_objetivo text, p_antes jsonb, p_despues jsonb
) returns void language sql security definer set search_path = public as $$
  insert into public.seguridad_eventos (tipo, actor_usuario_id, objetivo, antes, despues)
  values (p_tipo, auth.uid(), p_objetivo, p_antes, p_despues)
$$;
revoke execute on function public.fn_seguridad_evento(text, text, jsonb, jsonb) from public, anon, authenticated;

-- ─── 2. Qué se registra ─────────────────────────────────────────────────
create or replace function public.fn_trg_usuarios_registro()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.rol is distinct from old.rol then
    perform public.fn_seguridad_evento('usuario_rol', new.id::text,
      jsonb_build_object('rol', old.rol), jsonb_build_object('rol', new.rol, 'email', new.email));
  end if;
  if new.activo is distinct from old.activo then
    perform public.fn_seguridad_evento('usuario_activo', new.id::text,
      jsonb_build_object('activo', old.activo), jsonb_build_object('activo', new.activo, 'email', new.email));
  end if;
  return new;
end;
$$;
drop trigger if exists trg_usuarios_registro on public.usuarios;
create trigger trg_usuarios_registro
  after update on public.usuarios
  for each row execute function public.fn_trg_usuarios_registro();

create or replace function public.fn_trg_roles_registro()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.fn_seguridad_evento('rol_creado', new.codigo, null,
      jsonb_build_object('nombre', new.nombre, 'permisos', new.permisos));
  elsif tg_op = 'DELETE' then
    perform public.fn_seguridad_evento('rol_borrado', old.codigo,
      jsonb_build_object('nombre', old.nombre, 'permisos', old.permisos), null);
    return old;
  elsif (new.nombre, new.permisos) is distinct from (old.nombre, old.permisos) then
    perform public.fn_seguridad_evento('rol_editado', new.codigo,
      jsonb_build_object('nombre', old.nombre, 'permisos', old.permisos),
      jsonb_build_object('nombre', new.nombre, 'permisos', new.permisos));
  end if;
  return new;
end;
$$;
drop trigger if exists trg_roles_registro on public.roles;
create trigger trg_roles_registro
  after insert or update or delete on public.roles
  for each row execute function public.fn_trg_roles_registro();

-- ─── 3. Legajos: vínculo con la cuenta y puesto ─────────────────────────
create or replace function public.fn_trg_empleados_vinculo()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_viejo uuid := case when tg_op = 'UPDATE' then old.usuario_id end;
begin
  if new.usuario_id is distinct from v_viejo then
    if not public.fn_sesion_es_sistema()
       and not public.fn_tiene_permiso('usuarios_roles') then
      raise exception 'Solo un administrador puede vincular o cambiar la cuenta de login de un legajo.';
    end if;
    perform public.fn_seguridad_evento('empleado_vinculo', new.id::text,
      jsonb_build_object('usuario_id', v_viejo),
      jsonb_build_object('usuario_id', new.usuario_id, 'legajo', new.legajo));
  end if;
  if tg_op = 'UPDATE' and new.rol_operativo is distinct from old.rol_operativo then
    perform public.fn_seguridad_evento('empleado_puesto', new.id::text,
      jsonb_build_object('rol_operativo', old.rol_operativo),
      jsonb_build_object('rol_operativo', new.rol_operativo, 'legajo', new.legajo));
  end if;
  return new;
end;
$$;
drop trigger if exists trg_empleados_vinculo on public.empleados;
create trigger trg_empleados_vinculo
  before insert or update of usuario_id, rol_operativo on public.empleados
  for each row execute function public.fn_trg_empleados_vinculo();

revoke execute on function public.fn_trg_usuarios_registro() from public, anon, authenticated;
revoke execute on function public.fn_trg_roles_registro() from public, anon, authenticated;
revoke execute on function public.fn_trg_empleados_vinculo() from public, anon, authenticated;

create unique index if not exists empleados_usuario_id_uq
  on public.empleados (usuario_id) where usuario_id is not null;

drop policy if exists empleados_delete on public.empleados;
revoke delete, truncate on public.empleados from anon, authenticated;

-- ─── 4. Verificación ────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.seguridad_eventos') is null
     or to_regclass('public.empleados_usuario_id_uq') is null then
    raise exception '261: falta la tabla de registro o el índice único.';
  end if;
  if (select count(*) from pg_trigger where tgname in ('trg_seguridad_eventos_inmutable',
        'trg_seguridad_eventos_sin_truncate', 'trg_usuarios_registro', 'trg_roles_registro',
        'trg_empleados_vinculo')) <> 5 then
    raise exception '261: faltan triggers.';
  end if;
  if has_table_privilege('authenticated', 'public.seguridad_eventos', 'INSERT')
     or has_table_privilege('authenticated', 'public.seguridad_eventos', 'UPDATE')
     or has_table_privilege('authenticated', 'public.empleados', 'DELETE') then
    raise exception '261: quedaron permisos de escritura abiertos.';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public'
              and tablename = 'empleados' and cmd = 'DELETE') then
    raise exception '261: quedó una policy de borrado en empleados.';
  end if;
end $$;

notify pgrst, 'reload schema';
