-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 307 · Conteo parcial y cíclico (2/4): armar la lista    ║
-- ║                                                                    ║
-- ║  fn_conteo_armar_lista (interna): la lista de una tarea, en este   ║
-- ║  orden:                                                            ║
-- ║   a) candidatos: los del criterio menos lo que ya tomó otra tarea  ║
-- ║      de la sesión (fn_conteo_candidatos, mig 223), por recorrido;  ║
-- ║   b) ventana: si viene p_sin_contar_dias, se sacan los contados en ║
-- ║      una sesión CERRADA hace menos de N días (fn_conteo_ultimos);  ║
-- ║   c) tope: si viene p_cantidad_max y quedan más, se toman los      ║
-- ║      primeros N del recorrido (los arreglos ya vienen ordenados).  ║
-- ║  Devuelve los arreglos paralelos de la lista final más los conteos ║
-- ║  para la vista previa: en_criterio (cumplen el criterio), libres   ║
-- ║  (no son de otra tarea), ya_contados (salteados por la ventana),   ║
-- ║  pendientes (lo que quedaba antes del tope) y limitado.            ║
-- ║                                                                    ║
-- ║  REQUIERE: mig 306. La llama fn_conteo_crear_tareas v2 (mig 308).  ║
-- ║  Ejecutar UNA sola vez, COMPLETO. Primero PRUEBA, después          ║
-- ║  PRODUCCIÓN (HEX-V1). Última línea: "notify pgrst, 'reload schema';"║
-- ╚════════════════════════════════════════════════════════════════════╝

drop function if exists public.fn_conteo_armar_lista(integer, jsonb, text, integer, integer);

create function public.fn_conteo_armar_lista(
  p_sesion_id integer,
  p_criterios jsonb,
  p_tipo text,
  p_sin_contar_dias integer,
  p_cantidad_max integer
) returns table (
  pids integer[],
  dondes text[],
  ubics text[],
  con_otros boolean[],
  en_criterio integer,
  libres integer,
  ya_contados integer,
  pendientes integer,
  limitado boolean
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_recientes integer[] := '{}';
begin
  -- a) Candidatos, igual que la 224, más el arreglo paralelo "vive también
  --    fuera del área" (antes se contaba acá; ahora se cuenta sobre la
  --    lista final, después de la ventana y el tope).
  select coalesce(array_agg(c.producto_id order by c.orden) filter (where c.entra), '{}'),
         coalesce(array_agg(c.lugar order by c.orden) filter (where c.entra), '{}'),
         coalesce(array_agg(c.libres::text order by c.orden) filter (where c.entra), '{}'),
         coalesce(array_agg((c.otros is not null) order by c.orden) filter (where c.entra), '{}'),
         count(*)::integer
    into pids, dondes, ubics, con_otros, en_criterio
    from public.fn_conteo_candidatos(p_sesion_id, p_criterios, p_tipo) c;
  libres := cardinality(pids);

  -- b) Ventana: fuera lo contado en una sesión cerrada hace menos de N días.
  if p_sin_contar_dias is not null and libres > 0 then
    select coalesce(array_agg(u.producto_id), '{}') into v_recientes
      from public.fn_conteo_ultimos() u
     where u.producto_id = any(pids)
       and u.ultimo_ts >= now() - make_interval(days => p_sin_contar_dias);
    if cardinality(v_recientes) > 0 then
      select coalesce(array_agg(t.pid order by t.n), '{}'),
             coalesce(array_agg(t.donde order by t.n), '{}'),
             coalesce(array_agg(t.ubic order by t.n), '{}'),
             coalesce(array_agg(t.otro order by t.n), '{}')
        into pids, dondes, ubics, con_otros
        from unnest(pids, dondes, ubics, con_otros)
             with ordinality as t(pid, donde, ubic, otro, n)
       where not (t.pid = any(v_recientes));
    end if;
  end if;
  pendientes := cardinality(pids);
  ya_contados := libres - pendientes;

  -- c) Tope: los primeros N del recorrido.
  limitado := p_cantidad_max is not null and pendientes > p_cantidad_max;
  if limitado then
    pids := pids[1:p_cantidad_max];
    dondes := dondes[1:p_cantidad_max];
    ubics := ubics[1:p_cantidad_max];
    con_otros := con_otros[1:p_cantidad_max];
  end if;

  return next;
end;
$$;

revoke execute on function public.fn_conteo_armar_lista(integer, jsonb, text, integer, integer)
  from public, anon, authenticated;

-- Verificación (tiene que dar true):
-- select to_regprocedure('public.fn_conteo_armar_lista(integer,jsonb,text,integer,integer)') is not null;

notify pgrst, 'reload schema';
