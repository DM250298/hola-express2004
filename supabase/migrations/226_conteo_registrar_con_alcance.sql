-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 226 · Conteo físico: tareas con alcance (5/7)           ║
-- ║                                                                    ║
-- ║  fn_registrar_conteo v2 (base 098 ÍNTEGRA + bloques "226"): la     ║
-- ║  base hace cumplir el alcance, no solo la pantalla.                ║
-- ║   · Tarea 'lista': solo se cargan los productos de su lista.       ║
-- ║   · Tarea por área: la lista es una GUÍA. Lo que aparezca en el    ║
-- ║     lugar y no esté en la lista se puede cargar igual, salvo que:  ║
-- ║       – sea de una tarea 'lista' (o ya se haya contado en una);    ║
-- ║       – esté en la lista de otra tarea para ESTE mismo lugar;      ║
-- ║       – ya lo haya cargado otra tarea que cubre ESTE mismo lugar   ║
-- ║         (dos personas repartiéndose una góndola).                  ║
-- ║     En los tres casos se contaría dos veces.                       ║
-- ║   · La tarea se vuelve a leer DESPUÉS de tomar el lock de la       ║
-- ║     sesión: si en el medio la reasignaron o la quitaron, manda lo  ║
-- ║     nuevo (antes salía un error crudo de clave foránea).           ║
-- ║  Los reconteos no cambian. Misma firma → create or replace.        ║
-- ║                                                                    ║
-- ║  REQUIERE: mig 222. Correr el chequeo T1 después.                  ║
-- ║  Ejecutar UNA sola vez, COMPLETO. Primero PRUEBA, después          ║
-- ║  PRODUCCIÓN (HEX-V1).                                              ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_registrar_conteo(
  p_zona_id integer,
  p_producto_id integer,
  p_cantidad numeric,
  p_observacion text default null,
  p_es_reconteo boolean default false
) returns public.conteo_detalle
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_zona public.conteo_zonas;
  v_sesion public.conteo_sesiones;
  v_original public.conteo_detalle;
  v_detalle public.conteo_detalle;
  v_cant numeric;
  v_gestor boolean;
  v_rama integer[];  -- 226
  v_otra text;       -- 226
begin
  if v_uid is null then
    raise exception 'No se pudo identificar al usuario.';
  end if;
  if p_cantidad is null or p_cantidad < 0 then
    raise exception 'La cantidad contada no puede ser negativa.';
  end if;
  v_cant := round(p_cantidad, 3);

  select * into v_zona from public.conteo_zonas where id = p_zona_id;
  if v_zona.id is null then
    raise exception 'La zona no existe.';
  end if;
  -- FOR SHARE: un conteo no puede colarse en el medio de un cierre de sesión
  -- (el cierre toma FOR UPDATE de la sesión y recalcula las diferencias).
  select * into v_sesion from public.conteo_sesiones where id = v_zona.sesion_id for share;

  -- 226: releer con el lock tomado (quitar y agregar tareas toman FOR UPDATE).
  select * into v_zona from public.conteo_zonas where id = p_zona_id;
  if v_zona.id is null then
    raise exception 'Esta tarea ya no existe: la quitaron del conteo.';
  end if;

  -- El producto tiene que estar en el snapshot de la sesión: si no está,
  -- no participa del cálculo de diferencias ni del ajuste.
  if not exists (
    select 1 from public.conteo_snapshot s
    where s.sesion_id = v_sesion.id and s.producto_id = p_producto_id
  ) then
    raise exception 'Ese producto no forma parte de esta sesión (se creó después de abrirla o no controla stock). Anotalo aparte.';
  end if;

  v_gestor := public.fn_tiene_permiso('conteo_cierre');

  if not p_es_reconteo then
    if v_sesion.estado = 'abierta' then
      null; -- ok
    elsif v_sesion.estado = 'en_revision' and v_gestor then
      null; -- gestores pueden corregir/completar durante la revisión
    else
      raise exception 'La sesión no admite más conteos en este estado.';
    end if;
    if v_zona.estado <> 'en_curso' then
      raise exception 'La zona no está en curso. Iniciala antes de contar.';
    end if;
    if not v_gestor and v_zona.responsable_user_id is distinct from v_uid then
      raise exception 'Solo el responsable asignado puede contar en esta zona.';
    end if;

    -- ── 226 · Alcance de la tarea ──
    if not exists (
      select 1 from public.conteo_zona_productos zp
       where zp.zona_id = p_zona_id and zp.producto_id = p_producto_id
    ) then
      if v_zona.tipo = 'lista' then
        raise exception 'Ese producto no está en la lista de esta tarea.';
      end if;
      v_rama := public.fn_conteo_rama_zona(v_zona.criterios, v_zona.ubicacion_id);

      select z.nombre into v_otra
        from public.conteo_zona_productos zp
        join public.conteo_zonas z on z.id = zp.zona_id
       where z.sesion_id = v_sesion.id
         and z.id <> p_zona_id
         and zp.producto_id = p_producto_id
         and (z.tipo = 'lista' or zp.ubicacion_ids && v_rama)
       limit 1;
      if v_otra is not null then
        raise exception 'Ese producto se cuenta en la tarea "%": no lo cargues acá.', v_otra;
      end if;

      select z.nombre into v_otra
        from public.conteo_detalle d
        join public.conteo_zonas z on z.id = d.zona_id
       where z.sesion_id = v_sesion.id
         and z.id <> p_zona_id
         and d.producto_id = p_producto_id
         and not d.es_reconteo
         and (z.tipo = 'lista'
              or (cardinality(v_rama) > 0
                  and public.fn_conteo_rama_zona(z.criterios, z.ubicacion_id) && v_rama))
       limit 1;
      if v_otra is not null then
        raise exception 'Ese producto ya se cargó en la tarea "%", que cubre este mismo lugar.', v_otra;
      end if;
    end if;
    -- ── fin 226 ──

    insert into public.conteo_detalle
      (zona_id, producto_id, cantidad_contada, contado_por, ts, es_reconteo, observacion)
    values (p_zona_id, p_producto_id, v_cant, v_uid, now(), false, nullif(btrim(coalesce(p_observacion, '')), ''))
    on conflict (zona_id, producto_id) where not es_reconteo
    do update set cantidad_contada = excluded.cantidad_contada,
                  contado_por = excluded.contado_por,
                  ts = excluded.ts,
                  observacion = excluded.observacion
    returning * into v_detalle;
  else
    if v_sesion.estado not in ('abierta', 'en_revision') then
      raise exception 'La sesión ya está cerrada.';
    end if;
    select * into v_original from public.conteo_detalle
     where zona_id = p_zona_id and producto_id = p_producto_id and not es_reconteo;
    if v_original.id is null or not v_original.reconteo_pedido then
      raise exception 'Ese producto no tiene reconteo solicitado en esta zona.';
    end if;
    if v_original.contado_por = v_uid then
      raise exception 'El reconteo lo tiene que hacer una persona distinta a la que contó originalmente.';
    end if;
    if not v_gestor
       and v_zona.reconteo_user_id is distinct from v_uid
       and v_zona.responsable_user_id is distinct from v_uid then
      raise exception 'No estás asignado para recontar en esta zona.';
    end if;

    insert into public.conteo_detalle
      (zona_id, producto_id, cantidad_contada, contado_por, ts, es_reconteo, observacion)
    values (p_zona_id, p_producto_id, v_cant, v_uid, now(), true, nullif(btrim(coalesce(p_observacion, '')), ''))
    on conflict (zona_id, producto_id) where es_reconteo
    do update set cantidad_contada = excluded.cantidad_contada,
                  contado_por = excluded.contado_por,
                  ts = excluded.ts,
                  observacion = excluded.observacion
    returning * into v_detalle;
  end if;

  return v_detalle;
end;
$$;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- Chequeo T1 (debe dar 0 filas):
--   select proname, count(*) from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and proname like 'fn_%'
--   group by proname having count(*) > 1;
-- ─────────────────────────────────────────────────────────────────────
-- Verificación (debe dar true: la función vigente ya es la v2):
select pg_get_functiondef('public.fn_registrar_conteo(integer,integer,numeric,text,boolean)'::regprocedure)
       like '%fn_conteo_rama_zona%' as registrar_v2;
