-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 232 · Permiso rrhh_sanciones + fn_aplicar_sancion        ║
-- ║                                                                     ║
-- ║  Las sanciones formales (estatuto art. 13) las aplica Dirección.    ║
-- ║  Permiso nuevo 'rrhh_sanciones': se agrega SOLO al rol admin (el    ║
-- ║  atajo de fn_tiene_permiso ya le da todo, pero la UI y el middleware ║
-- ║  leen roles.permisos). A los demás roles lo asigna el dueño desde   ║
-- ║  Configuración › Usuarios.                                          ║
-- ║  fn_aplicar_sancion: alta de sanción con vínculo a incidencias (las ║
-- ║  cierra) y auditoría. Suspensión exige días (1–30); suspensión y    ║
-- ║  exclusión exigen referencia de acta/sumario (art. 14).             ║
-- ║  REQUIERE: migs 230 y 231. Ejecutar UNA sola vez. Primero PRUEBA,   ║
-- ║  después PRODUCCIÓN.                                                ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. Permiso a admin (idempotente) ────────────────────────────────
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'roles'
  ) then
    update public.roles
    set permisos = array_append(permisos, 'rrhh_sanciones'),
        updated_at = now()
    where codigo = 'admin'
      and not ('rrhh_sanciones' = any(permisos));
  end if;
end $$;

-- ─── 2. fn_aplicar_sancion ───────────────────────────────────────────
create or replace function public.fn_aplicar_sancion(
  p_empleado_id integer,
  p_tipo text,
  p_fecha date,
  p_motivo text,
  p_dias integer default null,
  p_incidencia_ids integer[] default '{}',
  p_referencia_acta text default null,
  p_resolucion text default null
) returns public.sanciones
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.sanciones;
  v_acta text := nullif(trim(coalesce(p_referencia_acta, '')), '');
  v_inc_id integer;
  v_n integer;
begin
  if not public.fn_tiene_permiso('rrhh_sanciones') then
    raise exception 'Solo Dirección puede aplicar sanciones formales.';
  end if;
  if v_uid is null then
    raise exception 'SESION_CAMBIO: la sesión no es válida. Volvé a iniciar sesión.';
  end if;
  if p_tipo not in ('llamado_atencion', 'apercibimiento', 'suspension', 'exclusion') then
    raise exception 'Tipo de sanción inválido.';
  end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Indicá el motivo de la sanción.';
  end if;
  if not exists (select 1 from public.empleados where id = p_empleado_id) then
    raise exception 'El empleado no existe.';
  end if;
  if p_tipo = 'suspension' and (p_dias is null or p_dias < 1 or p_dias > 30) then
    raise exception 'La suspensión requiere entre 1 y 30 días (estatuto art. 13).';
  end if;
  if p_tipo in ('suspension', 'exclusion') and v_acta is null then
    raise exception 'Suspensión y exclusión requieren referencia del acta o sumario (art. 14).';
  end if;

  -- Las incidencias vinculadas deben ser del mismo empleado.
  if p_incidencia_ids is not null and array_length(p_incidencia_ids, 1) > 0 then
    select count(*) into v_n from public.incidencias
    where id = any(p_incidencia_ids) and empleado_id <> p_empleado_id;
    if v_n > 0 then
      raise exception 'Hay incidencias vinculadas que no son de este empleado.';
    end if;
  end if;

  insert into public.sanciones (
    empleado_id, tipo, fecha, motivo, dias_suspension, referencia_acta,
    resolucion, va_al_legajo, aplicada_por
  ) values (
    p_empleado_id, p_tipo, p_fecha, trim(p_motivo),
    case when p_tipo = 'suspension' then p_dias else null end,
    v_acta, nullif(trim(coalesce(p_resolucion, '')), ''),
    p_tipo <> 'llamado_atencion', v_uid
  ) returning * into v_row;

  if p_incidencia_ids is not null then
    foreach v_inc_id in array p_incidencia_ids loop
      insert into public.sancion_incidencias (sancion_id, incidencia_id)
      values (v_row.id, v_inc_id)
      on conflict do nothing;

      update public.incidencias
      set estado = 'cerrada',
          cerrada_at = coalesce(cerrada_at, now()),
          cerrada_por = coalesce(cerrada_por, v_uid),
          accion_correctiva = coalesce(
            accion_correctiva, 'Sanción formal #' || v_row.id || ' (' || p_tipo || ')'
          ),
          updated_at = now()
      where id = v_inc_id and estado = 'abierta';
    end loop;
  end if;

  perform public.fn_auditar(
    v_uid, 'aplicar_sancion', 'sancion', v_row.id,
    jsonb_build_object(
      'empleado_id', p_empleado_id, 'tipo', p_tipo, 'dias', v_row.dias_suspension,
      'incidencias', coalesce(p_incidencia_ids, '{}')
    )
  );
  return v_row;
end;
$$;

revoke execute on function public.fn_aplicar_sancion(integer, text, date, text, integer, integer[], text, text) from public, anon;
grant execute on function public.fn_aplicar_sancion(integer, text, date, text, integer, integer[], text, text) to authenticated;

-- ─── 3. fn_anular_sancion ────────────────────────────────────────────
create or replace function public.fn_anular_sancion(
  p_id integer,
  p_motivo text
) returns public.sanciones
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.sanciones;
begin
  if not public.fn_tiene_permiso('rrhh_sanciones') then
    raise exception 'Solo Dirección puede anular sanciones.';
  end if;
  if v_uid is null then
    raise exception 'SESION_CAMBIO: la sesión no es válida. Volvé a iniciar sesión.';
  end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Indicá el motivo de la anulación.';
  end if;

  update public.sanciones
  set anulada_at = now(), anulada_por = v_uid, motivo_anulacion = trim(p_motivo)
  where id = p_id and anulada_at is null
  returning * into v_row;
  if not found then
    raise exception 'La sanción no existe o ya estaba anulada.';
  end if;

  perform public.fn_auditar(
    v_uid, 'anular_sancion', 'sancion', v_row.id,
    jsonb_build_object('empleado_id', v_row.empleado_id, 'motivo', trim(p_motivo))
  );
  return v_row;
end;
$$;

revoke execute on function public.fn_anular_sancion(integer, text) from public, anon;
grant execute on function public.fn_anular_sancion(integer, text) to authenticated;

notify pgrst, 'reload schema';

-- Chequeo T1 (debe dar 0 filas):
-- select proname, count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
-- where n.nspname='public' and proname like 'fn_%' group by proname having count(*)>1;
