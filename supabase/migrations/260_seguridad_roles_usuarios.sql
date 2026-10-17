-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  260 · Seguridad: roles y usuarios dejan de estar abiertos          ║
-- ║  (Tareas v2, Etapa 1 · bloque A)                                     ║
-- ║                                                                     ║
-- ║  Hasta ahora roles ("todo") y usuarios ("authenticated todo") tenían ║
-- ║  policies using(true): cualquier usuario logueado podía cambiarse   ║
-- ║  el rol a 'admin' o darse permisos. Desde esta migración:           ║
-- ║   · leer sigue abierto a los logueados (la app lo usa en todos lados);║
-- ║   · escribir exige el permiso nuevo 'usuarios_roles' (admin lo tiene);║
-- ║   · un trigger impide escalar: nadie se cambia su propio rol o       ║
-- ║     'activo', nadie asigna un rol con permisos que no tiene, solo    ║
-- ║     un admin crea/asigna 'admin', los roles base no se borran;       ║
-- ║   · el alta automática (handle_new_user) nace con 'sin_acceso'       ║
-- ║     (/api/usuarios después le pone el rol real con service role);    ║
-- ║   · un usuario desactivado pierde todos los permisos en la base.     ║
-- ║                                                                     ║
-- ║  El SQL Editor y el service_role (sin usuario) no pasan por las      ║
-- ║  guardas. Correr en las DOS bases. Se puede correr más de una vez.   ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

set local lock_timeout = '5s';

-- ─── 1. Roles base nuevos y permiso usuarios_roles ──────────────────────
insert into public.roles (codigo, nombre, es_sistema, permisos)
values ('sin_acceso', 'Sin acceso', true, '{}')
on conflict (codigo) do nothing;

update public.roles
   set permisos = array_append(permisos, 'usuarios_roles'), updated_at = now()
 where codigo = 'admin' and not ('usuarios_roles' = any(permisos));

-- ─── 2. ¿Quién es "sistema"? (SQL Editor, cron con service_role) ───────
-- anon también tiene auth.uid() null: por eso se mira el rol del JWT.
create or replace function public.fn_sesion_es_sistema()
returns boolean language sql stable set search_path = public as $$
  select auth.uid() is null
     and coalesce(auth.role(), '') not in ('anon', 'authenticated')
$$;
revoke execute on function public.fn_sesion_es_sistema() from public, anon, authenticated;

-- ─── 3. fn_tiene_permiso: misma firma, ahora exige usuario activo ───────
create or replace function public.fn_tiene_permiso(p_clave text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_rol text;
  v_permisos text[];
begin
  select rol into v_rol from public.usuarios where id = auth.uid() and activo;
  if v_rol is null then
    return false;
  end if;
  if v_rol = 'admin' then
    return true;
  end if;
  select permisos into v_permisos from public.roles where codigo = v_rol;
  if v_permisos is null then
    return false;
  end if;
  return p_clave = any(v_permisos);
end;
$$;

-- ─── 4. Alta automática sin permisos ────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.usuarios (id, email, nombre, rol, activo)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
    'sin_acceso',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ─── 5. Guardas anti-escalada ───────────────────────────────────────────
-- ¿El que está logueado tiene TODOS estos permisos? (admin = todos)
create or replace function public.fn_seguridad_puede_otorgar(p_permisos text[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(bool_and(public.fn_tiene_permiso(k)), true)
  from unnest(coalesce(p_permisos, '{}')) k
$$;
revoke execute on function public.fn_seguridad_puede_otorgar(text[]) from public, anon, authenticated;

create or replace function public.fn_trg_usuarios_guarda()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_permisos text[];
begin
  if public.fn_sesion_es_sistema() then return new; end if;
  if new.id is distinct from old.id or new.email is distinct from old.email then
    raise exception 'No se puede cambiar el id ni el email de un usuario desde la app.';
  end if;
  if new.id = auth.uid()
     and (new.rol is distinct from old.rol or new.activo is distinct from old.activo) then
    raise exception 'No podés cambiar tu propio rol ni desactivarte.';
  end if;
  if new.rol is distinct from old.rol then
    select permisos into v_permisos from public.roles where codigo = new.rol;
    if not found then
      raise exception 'El rol "%" no existe.', new.rol;
    end if;
    if new.rol = 'admin' and coalesce(public.fn_mi_rol(), '') <> 'admin' then
      raise exception 'Solo un administrador puede asignar el rol de administrador.';
    end if;
    if not public.fn_seguridad_puede_otorgar(v_permisos) then
      raise exception 'No podés asignar un rol con permisos que vos no tenés.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_usuarios_guarda on public.usuarios;
create trigger trg_usuarios_guarda
  before update on public.usuarios
  for each row execute function public.fn_trg_usuarios_guarda();

create or replace function public.fn_trg_roles_guarda()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_nuevos text[];
begin
  if public.fn_sesion_es_sistema() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if old.es_sistema then
      raise exception 'El rol "%" es un rol base y no se puede borrar.', old.nombre;
    end if;
    if exists (select 1 from public.usuarios u where u.rol = old.codigo) then
      raise exception 'Hay usuarios con el rol "%": reasignalos antes de borrarlo.', old.nombre;
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.codigo is distinct from old.codigo or new.es_sistema is distinct from old.es_sistema then
      raise exception 'No se puede cambiar el código ni si un rol es base.';
    end if;
  elsif new.es_sistema then
    raise exception 'Los roles base solo se crean por migración.';
  end if;
  if new.codigo = 'admin' and coalesce(public.fn_mi_rol(), '') <> 'admin' then
    raise exception 'Solo un administrador puede tocar el rol de administrador.';
  end if;
  -- Solo se pueden agregar permisos que quien edita ya tiene.
  select coalesce(array_agg(k), '{}') into v_nuevos
  from unnest(coalesce(new.permisos, '{}')) k
  where tg_op = 'INSERT' or not (k = any(coalesce(old.permisos, '{}')));
  if not public.fn_seguridad_puede_otorgar(v_nuevos) then
    raise exception 'No podés dar permisos que vos no tenés.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_roles_guarda on public.roles;
create trigger trg_roles_guarda
  before insert or update or delete on public.roles
  for each row execute function public.fn_trg_roles_guarda();

revoke execute on function public.fn_trg_usuarios_guarda() from public, anon, authenticated;
revoke execute on function public.fn_trg_roles_guarda() from public, anon, authenticated;

-- ─── 6. Policies: se borran TODAS las de roles y usuarios y se recrean ──
do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies
            where schemaname = 'public' and tablename in ('roles', 'usuarios')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

alter table public.roles enable row level security;
alter table public.usuarios enable row level security;

create policy roles_select on public.roles
  for select to authenticated using (true);
create policy roles_insert on public.roles
  for insert to authenticated with check ((select public.fn_tiene_permiso('usuarios_roles')));
create policy roles_update on public.roles
  for update to authenticated
  using ((select public.fn_tiene_permiso('usuarios_roles')))
  with check ((select public.fn_tiene_permiso('usuarios_roles')));
create policy roles_delete on public.roles
  for delete to authenticated using ((select public.fn_tiene_permiso('usuarios_roles')));

create policy usuarios_select on public.usuarios
  for select to authenticated using (true);
create policy usuarios_update on public.usuarios
  for update to authenticated
  using ((select public.fn_tiene_permiso('usuarios_roles')))
  with check ((select public.fn_tiene_permiso('usuarios_roles')));
-- Altas y bajas de usuarios: solo handle_new_user y /api/usuarios (service role).

revoke insert, delete, truncate on public.usuarios from anon, authenticated;
revoke truncate on public.roles from anon, authenticated;

-- ─── 7. Verificación: si algo no quedó, el pegado entero se deshace ────
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public'
              and tablename in ('roles', 'usuarios') and qual = 'true' and cmd <> 'SELECT') then
    raise exception '260: quedó una policy de escritura abierta en roles/usuarios.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public'
       and tablename in ('roles', 'usuarios')) <> 6 then
    raise exception '260: se esperaban 6 policies en roles/usuarios.';
  end if;
  if not exists (select 1 from public.roles where codigo = 'sin_acceso')
     or not exists (select 1 from public.roles where codigo = 'admin' and 'usuarios_roles' = any(permisos)) then
    raise exception '260: faltan los roles sin_acceso o el permiso usuarios_roles en admin.';
  end if;
  if (select count(*) from pg_trigger where tgname in ('trg_usuarios_guarda', 'trg_roles_guarda')) <> 2 then
    raise exception '260: faltan los triggers de guarda.';
  end if;
  if has_table_privilege('authenticated', 'public.usuarios', 'INSERT')
     or has_table_privilege('authenticated', 'public.usuarios', 'DELETE') then
    raise exception '260: authenticated todavía puede insertar o borrar usuarios.';
  end if;
end $$;

notify pgrst, 'reload schema';
