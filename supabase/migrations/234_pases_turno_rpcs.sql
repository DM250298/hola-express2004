-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 234 · RPCs del pase de turno                             ║
-- ║                                                                     ║
-- ║  · fn_entregar_pase_turno: guarda borrador o entrega. El saliente   ║
-- ║    es el legajo del usuario logueado (fn_mi_empleado_id); quien     ║
-- ║    tiene 'rrhh' puede cargarlo a nombre de otro (encargada que     ║
-- ║    completa por un cajero). Al entregar exige los 3 bloques de      ║
-- ║    texto y pendientes completos (texto + responsable).              ║
-- ║  · fn_recibir_pase_turno: el entrante marca los 4 conformes; si     ║
-- ║    alguno es "no conforme" las observaciones son obligatorias. No   ║
-- ║    puede recibir su propio pase.                                    ║
-- ║  Ambas auditan con fn_auditar. REQUIERE: mig 233.                   ║
-- ║  Ejecutar UNA sola vez. Primero PRUEBA, después PRODUCCIÓN.         ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. Entregar (o guardar borrador) ────────────────────────────────
create or replace function public.fn_entregar_pase_turno(
  p_fecha date,
  p_turno_saliente_id integer,
  p_turno_entrante_id integer,
  p_reposicion text,
  p_orden_limpieza text,
  p_novedades text,
  p_pendientes jsonb default '[]'::jsonb,
  p_entregar boolean default true,
  p_saliente_empleado_id integer default null
) returns public.pases_turno
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_mio integer := public.fn_mi_empleado_id();
  v_saliente integer;
  v_pend jsonb := coalesce(p_pendientes, '[]'::jsonb);
  v_item jsonb;
  v_row public.pases_turno;
begin
  if v_uid is null then
    raise exception 'SESION_CAMBIO: la sesión no es válida. Volvé a iniciar sesión.';
  end if;

  -- Quién entrega: el propio legajo, o el indicado si tiene 'rrhh'.
  if p_saliente_empleado_id is not null and p_saliente_empleado_id <> coalesce(v_mio, -1) then
    if not public.fn_tiene_permiso('rrhh') then
      raise exception 'Solo podés entregar el pase de tu propio turno.';
    end if;
    v_saliente := p_saliente_empleado_id;
  else
    v_saliente := v_mio;
  end if;
  if v_saliente is null then
    raise exception 'Tu usuario no está vinculado a un legajo. Pedile al encargado que lo vincule.';
  end if;
  if not exists (select 1 from public.empleados where id = v_saliente and activo) then
    raise exception 'El empleado saliente no existe o está dado de baja.';
  end if;
  if not exists (select 1 from public.turnos_plantilla where id = p_turno_saliente_id) then
    raise exception 'Turno saliente inválido.';
  end if;
  if p_turno_entrante_id is not null
     and not exists (select 1 from public.turnos_plantilla where id = p_turno_entrante_id) then
    raise exception 'Turno entrante inválido.';
  end if;
  if jsonb_typeof(v_pend) <> 'array' then
    raise exception 'Los pendientes deben ser una lista.';
  end if;

  if p_entregar then
    if coalesce(trim(p_reposicion), '') = '' then
      raise exception 'Completá el bloque "Reposición" antes de entregar.';
    end if;
    if coalesce(trim(p_orden_limpieza), '') = '' then
      raise exception 'Completá el bloque "Orden y limpieza" antes de entregar.';
    end if;
    if coalesce(trim(p_novedades), '') = '' then
      raise exception 'Completá el bloque "Novedades / incidencias" antes de entregar.';
    end if;
    for v_item in select * from jsonb_array_elements(v_pend) loop
      if coalesce(trim(v_item->>'texto'), '') = '' then
        raise exception 'Hay un pendiente sin descripción.';
      end if;
      if (v_item->>'responsable_empleado_id') is null then
        raise exception 'El pendiente "%" no tiene responsable.', left(v_item->>'texto', 40);
      end if;
      if not exists (
        select 1 from public.empleados
        where id = (v_item->>'responsable_empleado_id')::integer and activo
      ) then
        raise exception 'El responsable del pendiente "%" no es un empleado activo.', left(v_item->>'texto', 40);
      end if;
    end loop;
  end if;

  -- Un pase por (fecha, turno saliente). Solo se reescribe mientras es borrador.
  select * into v_row from public.pases_turno
  where fecha = p_fecha and turno_saliente_id = p_turno_saliente_id
  for update;

  if found then
    if v_row.estado <> 'borrador' then
      raise exception 'El pase del turno % del % ya fue entregado.', p_turno_saliente_id, p_fecha;
    end if;
    update public.pases_turno
    set turno_entrante_id = p_turno_entrante_id,
        saliente_empleado_id = v_saliente,
        reposicion = p_reposicion,
        orden_limpieza = p_orden_limpieza,
        novedades = p_novedades,
        pendientes = v_pend,
        estado = case when p_entregar then 'entregado' else 'borrador' end,
        entregado_at = case when p_entregar then now() else null end,
        updated_at = now()
    where id = v_row.id
    returning * into v_row;
  else
    insert into public.pases_turno (
      fecha, turno_saliente_id, turno_entrante_id, saliente_empleado_id,
      reposicion, orden_limpieza, novedades, pendientes, estado, entregado_at
    ) values (
      p_fecha, p_turno_saliente_id, p_turno_entrante_id, v_saliente,
      p_reposicion, p_orden_limpieza, p_novedades, v_pend,
      case when p_entregar then 'entregado' else 'borrador' end,
      case when p_entregar then now() else null end
    ) returning * into v_row;
  end if;

  if p_entregar then
    perform public.fn_auditar(
      v_uid, 'entregar_pase_turno', 'pase_turno', v_row.id,
      jsonb_build_object(
        'fecha', p_fecha, 'turno_saliente_id', p_turno_saliente_id,
        'saliente_empleado_id', v_saliente, 'pendientes', jsonb_array_length(v_pend)
      )
    );
  end if;
  return v_row;
end;
$$;

revoke execute on function public.fn_entregar_pase_turno(date, integer, integer, text, text, text, jsonb, boolean, integer) from public, anon;
grant execute on function public.fn_entregar_pase_turno(date, integer, integer, text, text, text, jsonb, boolean, integer) to authenticated;

-- ─── 2. Recibir ──────────────────────────────────────────────────────
create or replace function public.fn_recibir_pase_turno(
  p_pase_id integer,
  p_conforme_reposicion boolean,
  p_conforme_orden boolean,
  p_conforme_novedades boolean,
  p_conforme_pendientes boolean,
  p_observaciones text default null,
  p_entrante_empleado_id integer default null
) returns public.pases_turno
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_mio integer := public.fn_mi_empleado_id();
  v_entrante integer;
  v_row public.pases_turno;
  v_obs text := nullif(trim(coalesce(p_observaciones, '')), '');
  v_hay_no_conforme boolean;
begin
  if v_uid is null then
    raise exception 'SESION_CAMBIO: la sesión no es válida. Volvé a iniciar sesión.';
  end if;
  if p_entrante_empleado_id is not null and p_entrante_empleado_id <> coalesce(v_mio, -1) then
    if not public.fn_tiene_permiso('rrhh') then
      raise exception 'Solo podés recibir el pase a tu propio nombre.';
    end if;
    v_entrante := p_entrante_empleado_id;
  else
    v_entrante := v_mio;
  end if;
  if v_entrante is null then
    raise exception 'Tu usuario no está vinculado a un legajo. Pedile al encargado que lo vincule.';
  end if;

  select * into v_row from public.pases_turno where id = p_pase_id for update;
  if not found then
    raise exception 'El pase no existe.';
  end if;
  if v_row.estado <> 'entregado' then
    raise exception 'Este pase no está pendiente de recepción (estado: %).', v_row.estado;
  end if;
  if v_row.saliente_empleado_id = v_entrante then
    raise exception 'No podés recibir tu propio pase de turno.';
  end if;

  v_hay_no_conforme := not (
    coalesce(p_conforme_reposicion, false) and coalesce(p_conforme_orden, false)
    and coalesce(p_conforme_novedades, false) and coalesce(p_conforme_pendientes, false)
  );
  if v_hay_no_conforme and v_obs is null then
    raise exception 'Explicá la no conformidad en las observaciones.';
  end if;

  update public.pases_turno
  set estado = 'recibido',
      entrante_empleado_id = v_entrante,
      conforme_reposicion = coalesce(p_conforme_reposicion, false),
      conforme_orden = coalesce(p_conforme_orden, false),
      conforme_novedades = coalesce(p_conforme_novedades, false),
      conforme_pendientes = coalesce(p_conforme_pendientes, false),
      observaciones_entrante = v_obs,
      recibido_at = now(),
      updated_at = now()
  where id = p_pase_id
  returning * into v_row;

  perform public.fn_auditar(
    v_uid, 'recibir_pase_turno', 'pase_turno', v_row.id,
    jsonb_build_object(
      'entrante_empleado_id', v_entrante, 'no_conforme', v_hay_no_conforme
    )
  );
  return v_row;
end;
$$;

revoke execute on function public.fn_recibir_pase_turno(integer, boolean, boolean, boolean, boolean, text, integer) from public, anon;
grant execute on function public.fn_recibir_pase_turno(integer, boolean, boolean, boolean, boolean, text, integer) to authenticated;

notify pgrst, 'reload schema';

-- Chequeo T1 (debe dar 0 filas):
-- select proname, count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
-- where n.nspname='public' and proname like 'fn_%' group by proname having count(*)>1;
