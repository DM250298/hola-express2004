-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 331 · Conteo físico: sesiones programadas (2/4)         ║
-- ║                                                                    ║
-- ║  Qué puede hacer el gestor con una programación antes de que se    ║
-- ║  abra (decisión del dueño, 2026-11-17):                            ║
-- ║   · fn_conteo_reprogramar_sesion: otra fecha y hora (sobre una     ║
-- ║     programada o una que no se pudo abrir). Para cambiar tareas o  ║
-- ║     nombre se cancela y se arma otra.                              ║
-- ║   · fn_conteo_cancelar_programacion.                               ║
-- ║   · fn_conteo_abrir_programada: "Abrir ahora". Adelanta una futura ║
-- ║     o reintenta una fallida con la fn_abrir_sesion_conteo de       ║
-- ║     siempre, a nombre de quien aprieta el botón.                   ║
-- ║                                                                    ║
-- ║  REQUIERE: mig 330. Ejecutar UNA sola vez, COMPLETO. Primero       ║
-- ║  PRUEBA, después PRODUCCIÓN (HEX-V1). Última línea: el select.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1 · Reprogramar ──────────────────────────────────────────────────
drop function if exists public.fn_conteo_reprogramar_sesion(integer, timestamptz);

create function public.fn_conteo_reprogramar_sesion(p_id integer, p_programada_para timestamptz)
returns public.conteo_programaciones
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_fila public.conteo_programaciones;
  v_antes timestamptz;
begin
  if v_uid is null then
    raise exception 'No se pudo identificar al usuario.';
  end if;
  if not public.fn_tiene_permiso('conteo_cierre') then
    raise exception 'No tenés permiso para gestionar sesiones de conteo.';
  end if;
  perform public.fn_conteo_validar_programada_para(p_programada_para);
  select * into v_fila from public.conteo_programaciones where id = p_id for update;
  if v_fila.id is null then
    raise exception 'La programación no existe.';
  end if;
  if v_fila.estado not in ('programada', 'fallida') then
    raise exception 'Esta programación ya está % y no se puede reprogramar.', v_fila.estado;
  end if;
  v_antes := v_fila.programada_para;
  update public.conteo_programaciones
     set programada_para = p_programada_para, estado = 'programada',
         intentos = 0, ultimo_intento_at = null, ultimo_error = null
   where id = p_id
  returning * into v_fila;
  begin
    perform public.fn_auditar(v_uid, 'reprogramar_conteo_sesion', 'conteo_programacion', p_id,
      jsonb_build_object('antes', v_antes, 'despues', p_programada_para));
  exception when others then null; end;
  return v_fila;
end;
$$;

-- ─── 2 · Cancelar ─────────────────────────────────────────────────────
drop function if exists public.fn_conteo_cancelar_programacion(integer);

create function public.fn_conteo_cancelar_programacion(p_id integer)
returns public.conteo_programaciones
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_fila public.conteo_programaciones;
begin
  if v_uid is null then
    raise exception 'No se pudo identificar al usuario.';
  end if;
  if not public.fn_tiene_permiso('conteo_cierre') then
    raise exception 'No tenés permiso para gestionar sesiones de conteo.';
  end if;
  select * into v_fila from public.conteo_programaciones where id = p_id for update;
  if v_fila.id is null then
    raise exception 'La programación no existe.';
  end if;
  if v_fila.estado not in ('programada', 'fallida') then
    raise exception 'Esta programación ya está % y no se puede cancelar.', v_fila.estado;
  end if;
  update public.conteo_programaciones
     set estado = 'cancelada', cancelada_at = now(), cancelada_por = v_uid
   where id = p_id
  returning * into v_fila;
  begin
    perform public.fn_auditar(v_uid, 'cancelar_conteo_programacion', 'conteo_programacion', p_id,
      jsonb_build_object('nombre', v_fila.nombre, 'programada_para', v_fila.programada_para));
  exception when others then null; end;
  return v_fila;
end;
$$;

-- ─── 3 · Abrir ahora ──────────────────────────────────────────────────
drop function if exists public.fn_conteo_abrir_programada(integer);

create function public.fn_conteo_abrir_programada(p_id integer)
returns public.conteo_sesiones
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_fila public.conteo_programaciones;
  v_sesion public.conteo_sesiones;
begin
  if v_uid is null then
    raise exception 'No se pudo identificar al usuario.';
  end if;
  if not public.fn_tiene_permiso('conteo_cierre') then
    raise exception 'No tenés permiso para abrir sesiones de conteo.';
  end if;
  -- FOR UPDATE sin skip locked: si el proceso automático la agarró en este
  -- mismo instante, esperamos y después vemos que ya quedó abierta.
  select * into v_fila from public.conteo_programaciones where id = p_id for update;
  if v_fila.id is null then
    raise exception 'La programación no existe.';
  end if;
  if v_fila.estado = 'abierta' then
    raise exception 'Esta programación ya se abrió a las %.',
      to_char(v_fila.abierta_at at time zone 'America/Argentina/La_Rioja', 'HH24:MI');
  end if;
  if v_fila.estado not in ('programada', 'fallida') then
    raise exception 'Esta programación está % y no se puede abrir.', v_fila.estado;
  end if;
  -- La apertura real es la de siempre (snapshot + listas), a nombre de quien
  -- aprieta el botón. Si hay una sesión viva, el error de la 225 sube tal cual.
  v_sesion := public.fn_abrir_sesion_conteo(v_fila.nombre, v_fila.umbral_pesos, v_fila.zonas, v_fila.notas);
  update public.conteo_programaciones
     set estado = 'abierta', sesion_id = v_sesion.id, abierta_at = now(), abierta_por = v_uid,
         intentos = intentos + 1, ultimo_intento_at = now(), ultimo_error = null
   where id = p_id;
  begin
    perform public.fn_auditar(v_uid, 'abrir_conteo_programada', 'conteo_programacion', p_id,
      jsonb_build_object('sesion_id', v_sesion.id, 'programada_para', v_fila.programada_para));
  exception when others then null; end;
  return v_sesion;
end;
$$;

revoke execute on function public.fn_conteo_reprogramar_sesion(integer, timestamptz) from public, anon;
grant execute on function public.fn_conteo_reprogramar_sesion(integer, timestamptz) to authenticated;
revoke execute on function public.fn_conteo_cancelar_programacion(integer) from public, anon;
grant execute on function public.fn_conteo_cancelar_programacion(integer) to authenticated;
revoke execute on function public.fn_conteo_abrir_programada(integer) from public, anon;
grant execute on function public.fn_conteo_abrir_programada(integer) to authenticated;

notify pgrst, 'reload schema';

-- Verificación (las tres columnas deben dar true) + chequeo T1.
select
  to_regprocedure('public.fn_conteo_reprogramar_sesion(integer,timestamptz)') is not null as reprogramar,
  to_regprocedure('public.fn_conteo_cancelar_programacion(integer)') is not null as cancelar,
  to_regprocedure('public.fn_conteo_abrir_programada(integer)') is not null as abrir_ahora;
