-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 231 · RPCs de incidencias                                ║
-- ║                                                                     ║
-- ║  · fn_resumen_reincidencias: cuántas de la misma tipología tuvo el  ║
-- ║    empleado en los 30 días previos y qué instancia le tocaría. La   ║
-- ║    usa el modal para avisar ANTES de guardar.                       ║
-- ║  · fn_registrar_incidencia: alta con cálculo de instancia/escalada. ║
-- ║    Única vía de alta (la tabla no tiene policy de insert).          ║
-- ║  · fn_cerrar_incidencia: cierra con acción correctiva.              ║
-- ║  Gate: permiso 'rrhh' (encargadas y Dirección). Identidad: lo que   ║
-- ║  queda registrado es auth.uid(), no un parámetro.                   ║
-- ║  REQUIERE: mig 230. Firmas nuevas → create or replace sin           ║
-- ║  sobrecargas. Ejecutar UNA sola vez. Primero PRUEBA, después PROD.  ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. Preview de reincidencia ──────────────────────────────────────
create or replace function public.fn_resumen_reincidencias(
  p_empleado_id integer,
  p_tipologia_id integer,
  p_fecha date default null
) returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_fecha date := coalesce(p_fecha, (timezone('America/Argentina/Buenos_Aires', now()))::date);
  v_previas integer;
  v_gravedad text;
begin
  if not public.fn_tiene_permiso('rrhh') then
    raise exception 'Sin permiso para consultar incidencias.';
  end if;

  select count(*) into v_previas
  from public.incidencias
  where empleado_id = p_empleado_id
    and tipologia_id = p_tipologia_id
    and fecha between v_fecha - 30 and v_fecha;

  select gravedad_default into v_gravedad
  from public.tipologias_incidencia where id = p_tipologia_id;

  return jsonb_build_object(
    'previas', v_previas,
    'instancia_sugerida', least(3, v_previas + 1),
    'gravedad_default', coalesce(v_gravedad, 'leve')
  );
end;
$$;

revoke execute on function public.fn_resumen_reincidencias(integer, integer, date) from public, anon;
grant execute on function public.fn_resumen_reincidencias(integer, integer, date) to authenticated;

-- ─── 2. Registrar incidencia ─────────────────────────────────────────
create or replace function public.fn_registrar_incidencia(
  p_empleado_id integer,
  p_tipologia_id integer,
  p_descripcion text,
  p_fecha date default null,
  p_turno_id integer default null,
  p_tarea_turno_id uuid default null,
  p_gravedad text default null,
  p_accion_correctiva text default null
) returns public.incidencias
language plpgsql security definer set search_path = public
as $$
declare
  v_fecha date := coalesce(p_fecha, (timezone('America/Argentina/Buenos_Aires', now()))::date);
  v_uid uuid := auth.uid();
  v_tip public.tipologias_incidencia;
  v_previas integer;
  v_instancia smallint;
  v_gravedad text;
  v_escalada boolean;
  v_row public.incidencias;
begin
  if not public.fn_tiene_permiso('rrhh') then
    raise exception 'Sin permiso para registrar incidencias.';
  end if;
  if v_uid is null then
    raise exception 'SESION_CAMBIO: la sesión no es válida. Volvé a iniciar sesión.';
  end if;
  if p_descripcion is null or length(trim(p_descripcion)) = 0 then
    raise exception 'Describí objetivamente qué pasó (qué, cuándo, dónde).';
  end if;
  if not exists (select 1 from public.empleados where id = p_empleado_id and activo) then
    raise exception 'El empleado no existe o está dado de baja.';
  end if;

  select * into v_tip from public.tipologias_incidencia
  where id = p_tipologia_id and activa;
  if not found then
    raise exception 'Tipología de incidencia inválida.';
  end if;

  v_gravedad := coalesce(p_gravedad, v_tip.gravedad_default);
  if v_gravedad not in ('leve', 'grave') then
    raise exception 'Gravedad inválida (leve o grave).';
  end if;

  -- Reincidencia: misma tipología, mismo empleado, 30 días hacia atrás.
  select count(*) into v_previas
  from public.incidencias
  where empleado_id = p_empleado_id
    and tipologia_id = p_tipologia_id
    and fecha between v_fecha - 30 and v_fecha;

  v_instancia := least(3, v_previas + 1);
  v_escalada := (v_gravedad = 'grave') or (v_instancia >= 3);

  insert into public.incidencias (
    empleado_id, tipologia_id, fecha, turno_id, tarea_turno_id, descripcion,
    gravedad, instancia, reincidencias_30d, escalada, accion_correctiva,
    registrada_por
  ) values (
    p_empleado_id, p_tipologia_id, v_fecha, p_turno_id, p_tarea_turno_id,
    trim(p_descripcion), v_gravedad, v_instancia, v_previas, v_escalada,
    nullif(trim(coalesce(p_accion_correctiva, '')), ''), v_uid
  ) returning * into v_row;

  perform public.fn_auditar(
    v_uid, 'registrar_incidencia', 'incidencia', v_row.id,
    jsonb_build_object(
      'empleado_id', p_empleado_id, 'tipologia', v_tip.codigo,
      'instancia', v_instancia, 'gravedad', v_gravedad, 'escalada', v_escalada
    )
  );
  return v_row;
end;
$$;

revoke execute on function public.fn_registrar_incidencia(integer, integer, text, date, integer, uuid, text, text) from public, anon;
grant execute on function public.fn_registrar_incidencia(integer, integer, text, date, integer, uuid, text, text) to authenticated;

-- ─── 3. Cerrar incidencia ────────────────────────────────────────────
create or replace function public.fn_cerrar_incidencia(
  p_id integer,
  p_accion_correctiva text default null
) returns public.incidencias
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.incidencias;
begin
  if not public.fn_tiene_permiso('rrhh') then
    raise exception 'Sin permiso para cerrar incidencias.';
  end if;
  if v_uid is null then
    raise exception 'SESION_CAMBIO: la sesión no es válida. Volvé a iniciar sesión.';
  end if;

  update public.incidencias
  set estado = 'cerrada',
      cerrada_at = now(),
      cerrada_por = v_uid,
      accion_correctiva = coalesce(
        nullif(trim(coalesce(p_accion_correctiva, '')), ''), accion_correctiva
      ),
      updated_at = now()
  where id = p_id and estado = 'abierta'
  returning * into v_row;

  if not found then
    raise exception 'La incidencia no existe o ya estaba cerrada.';
  end if;

  perform public.fn_auditar(
    v_uid, 'cerrar_incidencia', 'incidencia', v_row.id,
    jsonb_build_object('empleado_id', v_row.empleado_id)
  );
  return v_row;
end;
$$;

revoke execute on function public.fn_cerrar_incidencia(integer, text) from public, anon;
grant execute on function public.fn_cerrar_incidencia(integer, text) to authenticated;

notify pgrst, 'reload schema';

-- Chequeo T1 (debe dar 0 filas):
-- select proname, count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
-- where n.nspname='public' and proname like 'fn_%' group by proname having count(*)>1;
