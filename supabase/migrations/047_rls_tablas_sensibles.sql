-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 047 · R1.1 — RLS real en tablas sensibles                ║
-- ║                                                                     ║
-- ║  Hasta ahora TODAS las tablas tenían policy `using(true)`: cualquier║
-- ║  usuario logueado podía leer/escribir todo vía la API. Esta migración║
-- ║  cierra las tablas sensibles según el PERMISO del rol.              ║
-- ║                                                                     ║
-- ║  Importante:                                                        ║
-- ║   · Los RPCs financieros son SECURITY DEFINER → bypassean RLS, así  ║
-- ║     que el POS, anular, recepción, etc. siguen funcionando igual.   ║
-- ║   · `admin` siempre tiene acceso total.                             ║
-- ║   · RLS deniega = resultado vacío (no error): nada crashea.         ║
-- ║   · egresos y sangrias: el cajero ve/registra SOLO los de su turno. ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- Helpers (SECURITY DEFINER → no disparan RLS al leer usuarios/roles)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select rol from public.usuarios where id = auth.uid()
$$;

create or replace function public.fn_tiene_permiso(p_clave text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_rol text;
  v_permisos text[];
begin
  select rol into v_rol from public.usuarios where id = auth.uid();
  if v_rol is null then
    return false;
  end if;
  if v_rol = 'admin' then
    return true;  -- admin: acceso total
  end if;
  select permisos into v_permisos from public.roles where codigo = v_rol;
  if v_permisos is null then
    return false;
  end if;
  return p_clave = any(v_permisos);
end;
$$;

grant execute on function public.fn_mi_rol() to authenticated, anon;
grant execute on function public.fn_tiene_permiso(text) to authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────
-- Borra TODAS las policies de una tabla, habilita RLS y crea una policy
-- `for all` gateada por el permiso indicado.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn__rls_gate(p_tabla text, p_permiso text)
returns void language plpgsql as $$
declare v_pol text;
begin
  for v_pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = p_tabla
  loop
    execute format('drop policy %I on public.%I', v_pol, p_tabla);
  end loop;
  execute format('alter table public.%I enable row level security', p_tabla);
  execute format(
    'create policy "gate_rw" on public.%I for all to authenticated '
    || 'using (public.fn_tiene_permiso(%L)) '
    || 'with check (public.fn_tiene_permiso(%L))',
    p_tabla, p_permiso, p_permiso);
end $$;

-- ███ FINANZAS ███
select public.fn__rls_gate('cuentas', 'finanzas');
select public.fn__rls_gate('movimientos_cuenta', 'finanzas');
select public.fn__rls_gate('cuentas_a_pagar', 'finanzas');
select public.fn__rls_gate('acreditaciones', 'finanzas');
select public.fn__rls_gate('arqueos_tesoreria', 'finanzas');
select public.fn__rls_gate('remesas', 'finanzas');
select public.fn__rls_gate('extractos_bancarios', 'finanzas');
select public.fn__rls_gate('lineas_extracto', 'finanzas');

-- ███ CONTABILIDAD ███
select public.fn__rls_gate('asientos', 'contabilidad');
select public.fn__rls_gate('asientos_items', 'contabilidad');
select public.fn__rls_gate('plan_cuentas', 'contabilidad');
select public.fn__rls_gate('activos_fijos', 'contabilidad');

-- ███ RRHH / SUELDOS ███
select public.fn__rls_gate('empleados', 'rrhh');
select public.fn__rls_gate('novedades_empleado', 'rrhh');
select public.fn__rls_gate('liquidaciones', 'rrhh');
select public.fn__rls_gate('recibos_sueldo', 'rrhh');
select public.fn__rls_gate('cuenta_corriente_empleado', 'rrhh');

-- ███ EGRESOS ███  (finanzas ve todo; cajero ve/escribe los de su turno)
do $$
declare v_pol text;
begin
  for v_pol in select policyname from pg_policies
    where schemaname='public' and tablename='egresos'
  loop execute format('drop policy %I on public.egresos', v_pol); end loop;
end $$;
alter table public.egresos enable row level security;
create policy "egresos_select" on public.egresos for select to authenticated
  using (
    public.fn_tiene_permiso('finanzas')
    or turno_id in (select id from public.caja_turnos where usuario_id = auth.uid())
  );
create policy "egresos_write" on public.egresos for all to authenticated
  using (public.fn_tiene_permiso('finanzas'))
  with check (public.fn_tiene_permiso('finanzas'));

-- ███ SANGRIAS ███  (cajero registra y ve las de su turno; finanzas ve todo)
do $$
declare v_pol text;
begin
  for v_pol in select policyname from pg_policies
    where schemaname='public' and tablename='sangrias'
  loop execute format('drop policy %I on public.sangrias', v_pol); end loop;
end $$;
alter table public.sangrias enable row level security;
create policy "sangrias_select" on public.sangrias for select to authenticated
  using (
    public.fn_tiene_permiso('finanzas')
    or turno_id in (select id from public.caja_turnos where usuario_id = auth.uid())
  );
create policy "sangrias_insert" on public.sangrias for insert to authenticated
  with check (usuario_id = auth.uid() or public.fn_tiene_permiso('finanzas'));
create policy "sangrias_update" on public.sangrias for update to authenticated
  using (public.fn_tiene_permiso('finanzas'))
  with check (public.fn_tiene_permiso('finanzas'));
create policy "sangrias_delete" on public.sangrias for delete to authenticated
  using (public.fn_tiene_permiso('finanzas'));

-- Limpieza del helper temporal
drop function if exists public.fn__rls_gate(text, text);

notify pgrst, 'reload schema';
