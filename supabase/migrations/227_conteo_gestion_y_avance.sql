-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 227 · Conteo físico: tareas con alcance (6/7)           ║
-- ║                                                                    ║
-- ║  1. fn_reasignar_tarea_conteo: cambiar quién cuenta.               ║
-- ║  2. fn_quitar_tarea_conteo: sacar una tarea que nadie empezó.      ║
-- ║  3. fn_reabrir_sesion_conteo: volver de "en revisión" a "abierta". ║
-- ║     Sin esto, el aviso de conteo a medias que aparece al revisar   ║
-- ║     no se podía resolver: en revisión no se suman tareas y el      ║
-- ║     personal no puede cargar.                                      ║
-- ║  4. fn_conteo_avance: cuánto lleva cada tarea (contados / lista),  ║
-- ║     en una sola consulta. Cada uno ve sus tareas; el gestor, todas.║
-- ║                                                                    ║
-- ║  100 % aditiva. REQUIERE: mig 222.                                 ║
-- ║  Ejecutar UNA sola vez, COMPLETO. Primero PRUEBA, después          ║
-- ║  PRODUCCIÓN (HEX-V1).                                              ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. fn_reasignar_tarea_conteo · p_responsable NULL = dejarla libre
--    (la toma quien la inicie). Lo ya contado no se toca.
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_reasignar_tarea_conteo(integer, uuid);

create function public.fn_reasignar_tarea_conteo(p_zona_id integer, p_responsable uuid)
returns public.conteo_zonas
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_zona public.conteo_zonas;
  v_antes uuid;
  v_estado text;
begin
  if v_uid is null then
    raise exception 'No se pudo identificar al usuario.';
  end if;
  if not public.fn_tiene_permiso('conteo_cierre') then
    raise exception 'No tenés permiso para gestionar sesiones de conteo.';
  end if;
  select * into v_zona from public.conteo_zonas where id = p_zona_id;
  if v_zona.id is null then
    raise exception 'La tarea no existe.';
  end if;
  -- Sesión primero, zona después (orden de locks del módulo, mig 098).
  select estado into v_estado from public.conteo_sesiones
   where id = v_zona.sesion_id for share;
  if v_estado = 'cerrada' then
    raise exception 'La sesión de conteo ya está cerrada.';
  end if;
  select * into v_zona from public.conteo_zonas where id = p_zona_id for update;
  if v_zona.estado = 'cerrada' then
    raise exception 'La tarea ya está cerrada: reabrila antes de reasignarla.';
  end if;
  if p_responsable is not null
     and not exists (select 1 from public.usuarios u
                      where u.id = p_responsable and u.activo) then
    raise exception 'El responsable elegido no es un usuario activo.';
  end if;
  -- Una tarea en curso no puede quedar sin responsable: nadie podría cargarla.
  if p_responsable is null and v_zona.estado = 'en_curso' then
    raise exception 'La tarea ya está en curso: elegí a quién pasársela.';
  end if;

  v_antes := v_zona.responsable_user_id;
  update public.conteo_zonas
     set responsable_user_id = p_responsable
   where id = p_zona_id
   returning * into v_zona;

  begin
    perform public.fn_auditar(v_uid, 'reasignar_tarea_conteo', 'conteo_sesion', v_zona.sesion_id,
      jsonb_build_object('tarea', v_zona.nombre, 'antes', v_antes, 'ahora', p_responsable));
  exception when others then null; end;
  return v_zona;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. fn_quitar_tarea_conteo · solo si nadie cargó nada en ella
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_quitar_tarea_conteo(integer);

create function public.fn_quitar_tarea_conteo(p_zona_id integer)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_zona public.conteo_zonas;
  v_estado text;
begin
  if v_uid is null then
    raise exception 'No se pudo identificar al usuario.';
  end if;
  if not public.fn_tiene_permiso('conteo_cierre') then
    raise exception 'No tenés permiso para gestionar sesiones de conteo.';
  end if;
  select * into v_zona from public.conteo_zonas where id = p_zona_id;
  if v_zona.id is null then
    raise exception 'La tarea no existe.';
  end if;
  -- FOR UPDATE: espera a los conteos en vuelo (FOR SHARE) antes de mirar si
  -- la tarea tiene algo cargado.
  select estado into v_estado from public.conteo_sesiones
   where id = v_zona.sesion_id for update;
  if v_estado <> 'abierta' then
    raise exception 'Solo se pueden quitar tareas con la sesión abierta.';
  end if;
  if exists (select 1 from public.conteo_detalle d where d.zona_id = p_zona_id) then
    raise exception 'Esta tarea ya tiene productos contados: no se puede quitar. Cerrala como está.';
  end if;
  if (select count(*) from public.conteo_zonas z
       where z.sesion_id = v_zona.sesion_id) <= 1 then
    raise exception 'Es la única tarea de la sesión: agregá otra antes de quitarla.';
  end if;

  -- La lista (conteo_zona_productos) se va en cascada: sus productos quedan
  -- libres para otra tarea.
  delete from public.conteo_zonas where id = p_zona_id;

  begin
    perform public.fn_auditar(v_uid, 'quitar_tarea_conteo', 'conteo_sesion', v_zona.sesion_id,
      jsonb_build_object('tarea', v_zona.nombre));
  exception when others then null; end;
  return p_zona_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. fn_reabrir_sesion_conteo · en_revision → abierta
--    Los reconteos ya pedidos siguen en pie (se pueden cargar con la
--    sesión abierta). Una sesión CERRADA no se reabre: ya ajustó stock.
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_reabrir_sesion_conteo(integer);

create function public.fn_reabrir_sesion_conteo(p_sesion_id integer)
returns public.conteo_sesiones
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sesion public.conteo_sesiones;
begin
  if v_uid is null then
    raise exception 'No se pudo identificar al usuario.';
  end if;
  if not public.fn_tiene_permiso('conteo_cierre') then
    raise exception 'No tenés permiso para gestionar sesiones de conteo.';
  end if;
  select * into v_sesion from public.conteo_sesiones
   where id = p_sesion_id for update;
  if v_sesion.id is null then
    raise exception 'La sesión de conteo no existe.';
  end if;
  if v_sesion.estado <> 'en_revision' then
    raise exception 'Solo una sesión en revisión se puede volver a abrir.';
  end if;

  update public.conteo_sesiones
     set estado = 'abierta'
   where id = p_sesion_id
   returning * into v_sesion;

  begin
    perform public.fn_auditar(v_uid, 'reabrir_conteo_sesion', 'conteo_sesion', p_sesion_id,
      jsonb_build_object('nombre', v_sesion.nombre));
  exception when others then null; end;
  return v_sesion;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. fn_conteo_avance
--    contados       = renglones cargados en la tarea (sin reconteos)
--    contados_lista = los que además están en su lista (el resto son
--                     productos encontrados en el lugar, fuera de lista)
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_conteo_avance(integer);

create function public.fn_conteo_avance(p_sesion_id integer)
returns table (
  zona_id integer,
  en_lista integer,
  contados integer,
  contados_lista integer
)
language sql stable security definer set search_path = public
as $$
  select z.id,
         (select count(*) from public.conteo_zona_productos zp
           where zp.zona_id = z.id)::integer,
         (select count(*) from public.conteo_detalle d
           where d.zona_id = z.id and not d.es_reconteo)::integer,
         (select count(*) from public.conteo_detalle d
            join public.conteo_zona_productos zp
              on zp.zona_id = d.zona_id and zp.producto_id = d.producto_id
           where d.zona_id = z.id and not d.es_reconteo)::integer
    from public.conteo_zonas z
   where z.sesion_id = p_sesion_id
     and ((select public.fn_tiene_permiso('conteo_cierre'))
          or z.responsable_user_id = (select auth.uid())
          or z.reconteo_user_id = (select auth.uid())
          or (z.responsable_user_id is null
              and (select public.fn_tiene_permiso('inventario'))))
   order by z.orden, z.id
$$;

revoke execute on function public.fn_reasignar_tarea_conteo(integer, uuid) from public, anon;
grant execute on function public.fn_reasignar_tarea_conteo(integer, uuid) to authenticated;
revoke execute on function public.fn_quitar_tarea_conteo(integer) from public, anon;
grant execute on function public.fn_quitar_tarea_conteo(integer) to authenticated;
revoke execute on function public.fn_reabrir_sesion_conteo(integer) from public, anon;
grant execute on function public.fn_reabrir_sesion_conteo(integer) to authenticated;
revoke execute on function public.fn_conteo_avance(integer) from public, anon;
grant execute on function public.fn_conteo_avance(integer) to authenticated;

notify pgrst, 'reload schema';

-- Verificación (las cuatro columnas deben dar true):
select
  to_regprocedure('public.fn_reasignar_tarea_conteo(integer,uuid)') is not null as reasignar,
  to_regprocedure('public.fn_quitar_tarea_conteo(integer)') is not null as quitar,
  to_regprocedure('public.fn_reabrir_sesion_conteo(integer)') is not null as reabrir,
  to_regprocedure('public.fn_conteo_avance(integer)') is not null as avance;
