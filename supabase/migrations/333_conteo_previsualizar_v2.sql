-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 333 · Conteo físico: sesiones programadas (4/4)         ║
-- ║                                                                    ║
-- ║  fn_conteo_previsualizar_tareas v2 (cuerpo de la 225 §3 íntegro)   ║
-- ║  con un parámetro nuevo y opcional, p_nueva:                       ║
-- ║   · false (default, lo que manda el front viejo): igual que hoy.   ║
-- ║     Con una sesión viva calcula contra ella y, si está en          ║
-- ║     revisión, corta.                                               ║
-- ║   · true: simula SIEMPRE una sesión nueva, aunque hoy haya una     ║
-- ║     viva o en revisión. Es lo que necesita el wizard para          ║
-- ║     PROGRAMAR la próxima sesión mientras corre la actual: la       ║
-- ║     sesión ficticia se inserta 'cerrada' (no choca con el índice   ║
-- ║     de "una sola viva"; el armado de listas no mira el estado) y   ║
-- ║     se deshace entera con el error CTVP0, como siempre.            ║
-- ║                                                                    ║
-- ║  Se dropea la firma de un argumento: con las dos, PostgREST no     ║
-- ║  sabría cuál llamar. La llamada vieja (solo p_zonas) sigue andando ║
-- ║  por el default. REQUIERE: migs 225 y 329. Última línea: select.   ║
-- ╚════════════════════════════════════════════════════════════════════╝

drop function if exists public.fn_conteo_previsualizar_tareas(jsonb);
drop function if exists public.fn_conteo_previsualizar_tareas(jsonb, boolean);

create function public.fn_conteo_previsualizar_tareas(p_zonas jsonb, p_nueva boolean default false)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sesion_id integer;
  v_estado text;
  v_tareas jsonb := '[]'::jsonb;
  v_fecha date;
begin
  if v_uid is null then
    raise exception 'No se pudo identificar al usuario.';
  end if;
  if not public.fn_tiene_permiso('conteo_cierre') then
    raise exception 'No tenés permiso para armar tareas de conteo.';
  end if;
  select max(m.fecha) into v_fecha from public.metricas_sku_diarias m;
  if p_zonas is null or jsonb_typeof(p_zonas) <> 'array'
     or jsonb_array_length(p_zonas) = 0 then
    return jsonb_build_object('tareas', v_tareas, 'fecha_abc', v_fecha);
  end if;

  -- v2: con p_nueva no se mira la sesión viva: se simula la que se va a abrir.
  if not coalesce(p_nueva, false) then
    select s.id, s.estado into v_sesion_id, v_estado
      from public.conteo_sesiones s where s.estado <> 'cerrada' limit 1;
    if v_estado = 'en_revision' then
      raise exception 'La sesión está en revisión: volvé a abrirla para sumar tareas.';
    end if;
  end if;

  begin
    if v_sesion_id is null then
      -- v2: ficticia y 'cerrada' (antes 'abierta', que solo podía insertarse
      -- sin otra viva). Se deshace entera abajo.
      insert into public.conteo_sesiones (nombre, estado, abierta_por)
      values ('(vista previa)', 'cerrada', v_uid)
      returning id into v_sesion_id;
      insert into public.conteo_snapshot (sesion_id, producto_id, stock_teorico)
      select v_sesion_id, p.id, 0
        from public.productos p
       where p.activo and coalesce(p.controlar_stock, true);
    end if;
    v_tareas := public.fn_conteo_crear_tareas(v_sesion_id, p_zonas, false);
    raise exception using errcode = 'CTVP0', message = 'vista previa';
  exception when sqlstate 'CTVP0' then
    null;
  end;

  return jsonb_build_object('tareas', v_tareas, 'fecha_abc', v_fecha);
end;
$$;

revoke execute on function public.fn_conteo_previsualizar_tareas(jsonb, boolean) from public, anon;
grant execute on function public.fn_conteo_previsualizar_tareas(jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';

-- Verificación (las dos columnas deben dar true) + chequeo T1 (0 filas).
select
  to_regprocedure('public.fn_conteo_previsualizar_tareas(jsonb,boolean)') is not null as vista_previa_v2,
  to_regprocedure('public.fn_conteo_previsualizar_tareas(jsonb)') is null as firma_vieja_borrada;
