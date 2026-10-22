-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 308 · Conteo parcial y cíclico (3/4): crear tareas v2   ║
-- ║                                                                    ║
-- ║  fn_conteo_crear_tareas v2 (interna, misma firma que la 224). Lo   ║
-- ║  nuevo por tarea del JSON:                                         ║
-- ║   · "sin_contar_dias": N  → saltea lo contado en una sesión        ║
-- ║                            cerrada hace menos de N días            ║
-- ║   · "cantidad_max": N     → se queda con los primeros N del        ║
-- ║                            recorrido                               ║
-- ║  Ambos opcionales (NULL/0 = como antes). Los guarda en conteo_zonas║
-- ║  y la salida suma 'ya_contados', 'pendientes' y 'limitado'. Las    ║
-- ║  claves de siempre no cambian; 'ya_asignados' = los que son de     ║
-- ║  otra tarea de la sesión (sin ventana ni tope da lo mismo que hoy).║
-- ║  Responsables y reparto salieron a helpers (mig 306); la lista la  ║
-- ║  arma fn_conteo_armar_lista (mig 307). La 225 no cambia: pasa el   ║
-- ║  JSON tal cual.                                                    ║
-- ║                                                                    ║
-- ║  REQUIERE: migs 306 y 307. Ejecutar UNA sola vez, COMPLETO.        ║
-- ║  Primero PRUEBA, después PRODUCCIÓN (HEX-V1).                      ║
-- ║  Última línea: "notify pgrst, 'reload schema';"                    ║
-- ╚════════════════════════════════════════════════════════════════════╝

drop function if exists public.fn_conteo_crear_tareas(integer, jsonb, boolean);

create function public.fn_conteo_crear_tareas(
  p_sesion_id integer,
  p_zonas jsonb,
  p_estricto boolean default true
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_item jsonb;
  v_indice integer := -1;
  v_nombre text;
  v_crit jsonb;
  v_resps uuid[];
  v_ubic integer;
  v_areas integer[];
  v_tipo text;
  v_dias integer;      -- ventana en días (null = sin ventana)
  v_cant integer;      -- tope de productos (null = sin tope)
  v_l record;          -- fila de fn_conteo_armar_lista
  v_partes integer[];
  v_total integer;     -- quedan para esta tarea
  v_otros integer;     -- de esos, viven también fuera del área
  v_n integer;
  v_i integer;
  v_id integer;
  v_orden integer;
  v_salida jsonb := '[]'::jsonb;
begin
  select coalesce(max(z.orden), -1) + 1 into v_orden
    from public.conteo_zonas z where z.sesion_id = p_sesion_id;

  for v_item in select * from jsonb_array_elements(p_zonas) loop
    v_indice := v_indice + 1;
    v_nombre := btrim(coalesce(v_item->>'nombre', ''));
    if v_nombre = '' then
      raise exception 'Todas las tareas necesitan un nombre.';
    end if;
    v_resps := public.fn_conteo_responsables(v_item, v_nombre);

    v_crit := v_item->'criterios';
    if v_crit is not null and jsonb_typeof(v_crit) <> 'object' then
      v_crit := null;
    end if;
    v_areas := public.fn_jsonb_enteros(v_crit->'ubicacion_ids');
    v_tipo := case when v_crit is null or cardinality(v_areas) > 0
                   then 'area' else 'lista' end;

    -- Ancla al mapa: la que venga, o el área si la tarea es de UNA sola.
    -- Una 'lista' no se ancla: al cerrarla ubicaría toda la lista ahí.
    v_ubic := case when coalesce(v_item->>'ubicacion_id', '') ~ '^[0-9]{1,9}$'
                   then (v_item->>'ubicacion_id')::integer end;
    if v_ubic is null and cardinality(v_areas) = 1 then
      v_ubic := v_areas[1];
    end if;
    if v_tipo = 'lista' then
      v_ubic := null;
    end if;
    if v_ubic is not null
       and not exists (select 1 from public.ubicaciones u
                        where u.id = v_ubic and u.activo) then
      raise exception 'La ubicación de la tarea "%" no existe o está inactiva.', v_nombre;
    end if;

    if v_crit is null then
      -- Zona libre: sin lista, se escanea lo que haya (098/176).
      if cardinality(v_resps) > 1 then
        raise exception 'La zona libre "%" lleva un solo responsable: sin lista no hay qué repartir.', v_nombre;
      end if;
      insert into public.conteo_zonas
        (sesion_id, nombre, responsable_user_id, orden, ubicacion_id)
      values (p_sesion_id, v_nombre, v_resps[1], v_orden, v_ubic);
      v_orden := v_orden + 1;
      v_salida := v_salida || jsonb_build_object(
        'indice', v_indice, 'nombre', v_nombre, 'tipo', 'area', 'libre', true,
        'en_criterio', 0, 'productos', 0, 'ya_asignados', 0,
        'ya_contados', 0, 'pendientes', 0, 'limitado', false,
        'con_otros_lugares', 0, 'partes', 1, 'por_parte', '[]'::jsonb);
      continue;
    end if;

    -- Conteo parcial (mig 306): solo dígitos; 0 o ausente = sin efecto.
    v_dias := case when coalesce(v_item->>'sin_contar_dias', '') ~ '^[0-9]{1,4}$'
                   then nullif((v_item->>'sin_contar_dias')::integer, 0) end;
    v_cant := case when coalesce(v_item->>'cantidad_max', '') ~ '^[0-9]{1,7}$'
                   then nullif((v_item->>'cantidad_max')::integer, 0) end;

    select * into v_l
      from public.fn_conteo_armar_lista(p_sesion_id, v_crit, v_tipo, v_dias, v_cant);
    v_total := cardinality(v_l.pids);
    v_otros := (select count(*) from unnest(v_l.con_otros) x where x);

    if v_total = 0 then
      if p_estricto and v_l.ya_contados > 0 then
        raise exception 'La tarea "%" quedó sin productos: los que cumplen el criterio ya son de otra tarea de esta sesión o ya se contaron en los últimos % días.', v_nombre, v_dias;
      elsif p_estricto then
        raise exception 'La tarea "%" quedó sin productos: ninguno cumple el criterio o ya están todos en otra tarea de esta sesión.', v_nombre;
      end if;
      v_salida := v_salida || jsonb_build_object(
        'indice', v_indice, 'nombre', v_nombre, 'tipo', v_tipo, 'libre', false,
        'en_criterio', v_l.en_criterio, 'productos', 0,
        'ya_asignados', v_l.en_criterio - v_l.libres,
        'ya_contados', v_l.ya_contados, 'pendientes', 0, 'limitado', false,
        'con_otros_lugares', 0, 'partes', 0, 'por_parte', '[]'::jsonb);
      continue;
    end if;

    -- Reparto entre responsables sobre la lista ya recortada: el tope es
    -- de la tarea, no de cada persona.
    v_partes := public.fn_conteo_repartir(v_l.dondes, cardinality(v_resps));
    v_n := (select max(p) from unnest(v_partes) p);

    for v_i in 1..v_n loop
      insert into public.conteo_zonas
        (sesion_id, nombre, responsable_user_id, orden, ubicacion_id, tipo, criterios,
         cantidad_max, sin_contar_dias)
      values (
        p_sesion_id,
        case when v_n > 1 then v_nombre || ' (' || v_i || '/' || v_n || ')'
             else v_nombre end,
        v_resps[v_i], v_orden, v_ubic, v_tipo, v_crit, v_cant, v_dias)
      returning id into v_id;

      insert into public.conteo_zona_productos
        (zona_id, producto_id, orden, donde, ubicacion_ids)
      select v_id, t.pid, t.n::integer, nullif(t.donde, ''), t.ubics::integer[]
        from unnest(v_l.pids, v_l.dondes, v_l.ubics, v_partes)
             with ordinality as t(pid, donde, ubics, parte, n)
       where t.parte = v_i;

      v_orden := v_orden + 1;
    end loop;

    v_salida := v_salida || jsonb_build_object(
      'indice', v_indice, 'nombre', v_nombre, 'tipo', v_tipo, 'libre', false,
      'en_criterio', v_l.en_criterio, 'productos', v_total,
      'ya_asignados', v_l.en_criterio - v_l.libres,
      'ya_contados', v_l.ya_contados, 'pendientes', v_l.pendientes,
      'limitado', v_l.limitado,
      'con_otros_lugares', v_otros, 'partes', v_n,
      'por_parte', (select coalesce(jsonb_agg(q.cant order by q.parte), '[]'::jsonb)
                      from (select p as parte, count(*) as cant
                              from unnest(v_partes) p group by p) q));
  end loop;

  return v_salida;
end;
$$;

revoke execute on function public.fn_conteo_crear_tareas(integer, jsonb, boolean)
  from public, anon, authenticated;

-- Verificación (tiene que dar true): la función viva ya usa la lista nueva.
-- select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'fn_conteo_crear_tareas'
--     and p.prosrc like '%fn_conteo_armar_lista%');

notify pgrst, 'reload schema';
