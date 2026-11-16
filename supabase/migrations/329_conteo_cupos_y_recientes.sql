-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 329 · Conteo físico: cantidad por persona y lo contado  ║
-- ║  hace poco                                                         ║
-- ║                                                                    ║
-- ║  Reemite fn_conteo_crear_tareas (cuerpo de la 224, MISMA firma)    ║
-- ║  con dos claves nuevas y opcionales por tarea en p_zonas:          ║
-- ║                                                                    ║
-- ║   · "excluir_dias": 15  → no entran los productos que ya se        ║
-- ║     contaron (conteo_detalle, sin reconteos) en OTRA sesión de     ║
-- ║     Conteo físico en los últimos N días. Ausente o 0 = no excluye. ║
-- ║     El Conteo rápido del celular y los ajustes NO cuentan: solo    ║
-- ║     dejan rastro cuando hubo diferencia.                           ║
-- ║                                                                    ║
-- ║   · "cantidades": [100, 60] → cuántos productos cuenta cada uno,   ║
-- ║     en el mismo orden que "responsables". null o 0 = sin número.   ║
-- ║     Con algún número:                                              ║
-- ║       - el que no tiene número se lleva (en partes iguales con los ║
-- ║         otros sin número) lo que sobra; si todos tienen número, lo ║
-- ║         que sobra queda sin asignar para otra sesión;              ║
-- ║       - entran primero los MÁS ATRASADOS (nunca contados, después  ║
-- ║         los de conteo más viejo; desempata el recorrido);          ║
-- ║       - los elegidos se reparten en tramos seguidos del recorrido  ║
-- ║         del tamaño exacto pedido (acá la cantidad manda: no rige   ║
-- ║         la regla de no partir un estante).                         ║
-- ║     Sin ningún número: el reparto de la 224, sin cambios.          ║
-- ║                                                                    ║
-- ║  La salida por tarea suma "recientes" (los que dejó afuera la      ║
-- ║  ventana) y "sin_asignar" (los que dejó afuera la cantidad).       ║
-- ║  "ya_asignados" sigue siendo lo que ya es de otra tarea.           ║
-- ║                                                                    ║
-- ║  REQUIERE: migs 222 a 228. No cambia tablas, RLS ni las funciones  ║
-- ║  de la 225 (abrir, agregar y vista previa la llaman igual).        ║
-- ║  Compatible con el front viejo (no manda las claves).              ║
-- ║  Ejecutar UNA sola vez, COMPLETO. Primero PRUEBA, después          ║
-- ║  PRODUCCIÓN (HEX-V1).                                              ║
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
  c_uuid constant text := '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$';
  v_item jsonb;
  v_indice integer := -1;
  v_nombre text;
  v_crit jsonb;
  v_resps uuid[];
  v_pos integer[];      -- posición de cada responsable en el arreglo recibido
  v_cupos integer[];    -- cantidad pedida por responsable (null = sin número)
  v_tams integer[];     -- cantidad que le toca a cada responsable
  v_duenos integer[];   -- responsable (índice) de cada parte que se crea
  v_resp uuid;
  v_ubic integer;
  v_areas integer[];
  v_tipo text;
  v_dias integer;       -- ventana de "ya contado"; 0 = no excluye
  v_pids integer[];
  v_dondes text[];
  v_ubics text[];
  v_ultimos timestamptz[];
  v_con_otros boolean[];
  v_partes integer[];
  v_criterio integer;   -- cumplen el criterio
  v_tomados integer;    -- de esos, ya son de otra tarea
  v_recientes integer;  -- de los libres, se contaron dentro de la ventana
  v_total integer;      -- quedan para esta tarea
  v_sin_asignar integer;-- quedaron afuera por la cantidad pedida
  v_otros integer;      -- de los que entran, viven también fuera del área
  v_fijo integer;
  v_sin_cupo integer;
  v_resto integer;
  v_k integer;
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

    -- Responsables: el arreglo nuevo o el campo único de las migs 098/176.
    -- Sin repetidos (una persona, una tarea) y sin vacíos.
    v_resps := '{}';
    v_pos := '{}';
    if jsonb_typeof(v_item->'responsables') = 'array' then
      select coalesce(array_agg(t.x::uuid order by t.n), '{}'),
             coalesce(array_agg(t.n::integer order by t.n), '{}')
        into v_resps, v_pos
        from (select lower(e.x) as x, min(e.n) as n
                from jsonb_array_elements_text(v_item->'responsables')
                     with ordinality as e(x, n)
               where e.x ~* c_uuid
               group by lower(e.x)) t;
    elsif coalesce(v_item->>'responsable_user_id', '') ~* c_uuid then
      v_resps := array[(v_item->>'responsable_user_id')::uuid];
      v_pos := array[1];
    end if;
    foreach v_resp in array v_resps loop
      if not exists (select 1 from public.usuarios u
                      where u.id = v_resp and u.activo) then
        raise exception 'Un responsable de la tarea "%" no es un usuario activo.', v_nombre;
      end if;
    end loop;

    -- Cantidad por responsable, alineada con el arreglo recibido. Sin
    -- responsables hay una sola parte: vale la primera cantidad.
    v_k := greatest(cardinality(v_resps), 1);
    if cardinality(v_pos) = 0 then
      v_pos := array[1];
    end if;
    select array_agg(
             case when jsonb_typeof(v_item->'cantidades') = 'array'
                       and (v_item->'cantidades'->>(t.pos - 1)) ~ '^[0-9]{1,6}$'
                  then nullif((v_item->'cantidades'->>(t.pos - 1))::integer, 0) end
             order by t.i)
      into v_cupos
      from unnest(v_pos) with ordinality as t(pos, i);

    v_dias := case when coalesce(v_item->>'excluir_dias', '') ~ '^[0-9]{1,3}$'
                   then (v_item->>'excluir_dias')::integer else 0 end;

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
        'recientes', 0, 'sin_asignar', 0,
        'con_otros_lugares', 0, 'partes', 1, 'por_parte', '[]'::jsonb);
      continue;
    end if;

    -- Candidatos: los del criterio, menos lo que ya tomó otra tarea, menos
    -- (si se pidió) lo que ya se contó en otra sesión dentro de la ventana.
    select coalesce(array_agg(c.producto_id order by c.orden) filter (where c.queda), '{}'),
           coalesce(array_agg(c.lugar order by c.orden) filter (where c.queda), '{}'),
           coalesce(array_agg(c.libres::text order by c.orden) filter (where c.queda), '{}'),
           coalesce(array_agg(c.ultimo order by c.orden) filter (where c.queda), '{}'),
           coalesce(array_agg(c.otros is not null order by c.orden) filter (where c.queda), '{}'),
           count(*)::integer,
           (count(*) filter (where not c.entra))::integer,
           (count(*) filter (where c.entra and not c.queda))::integer
      into v_pids, v_dondes, v_ubics, v_ultimos, v_con_otros,
           v_criterio, v_tomados, v_recientes
      from (
        select k.*,
               (k.entra and not (v_dias > 0 and k.ultimo is not null
                                 and k.ultimo >= now() - make_interval(days => v_dias))) as queda
          from (
            select cand.producto_id, cand.orden, cand.lugar, cand.libres,
                   cand.otros, cand.entra,
                   (select max(d.ts)
                      from public.conteo_detalle d
                      join public.conteo_zonas z on z.id = d.zona_id
                     where d.producto_id = cand.producto_id
                       and z.sesion_id <> p_sesion_id
                       and not d.es_reconteo) as ultimo
              from public.fn_conteo_candidatos(p_sesion_id, v_crit, v_tipo) cand
          ) k
      ) c;
    v_total := cardinality(v_pids);
    v_sin_asignar := 0;

    if v_total = 0 then
      if p_estricto then
        if v_recientes > 0 then
          raise exception 'La tarea "%" quedó sin productos: los que cumplen el criterio ya se contaron en los últimos % días. Para volver a contarlos, tildá "Incluir los ya contados".', v_nombre, v_dias;
        end if;
        raise exception 'La tarea "%" quedó sin productos: ninguno cumple el criterio o ya están todos en otra tarea de esta sesión.', v_nombre;
      end if;
      v_salida := v_salida || jsonb_build_object(
        'indice', v_indice, 'nombre', v_nombre, 'tipo', v_tipo, 'libre', false,
        'en_criterio', v_criterio, 'productos', 0, 'ya_asignados', v_tomados,
        'recientes', v_recientes, 'sin_asignar', 0,
        'con_otros_lugares', 0, 'partes', 0, 'por_parte', '[]'::jsonb);
      continue;
    end if;

    select coalesce(sum(u.c), 0)::integer, (count(*) filter (where u.c is null))::integer
      into v_fijo, v_sin_cupo
      from unnest(v_cupos) as u(c);

    if v_fijo > 0 then
      -- Con cantidades. Quien no tiene número se reparte lo que sobra.
      v_resto := greatest(v_total - v_fijo, 0);
      select array_agg(
               coalesce(t.c,
                 v_resto / nullif(v_sin_cupo, 0)
                 + case when t.libre <= v_resto % nullif(v_sin_cupo, 0) then 1 else 0 end)
               order by t.i)
        into v_tams
        from (select u.c, u.i,
                     count(*) filter (where u.c is null) over (order by u.i) as libre
                from unnest(v_cupos) with ordinality as u(c, i)) t;
      select least(sum(x), v_total)::integer into v_n from unnest(v_tams) x;
      v_sin_asignar := v_total - v_n;

      -- Los v_n más atrasados, vueltos a poner en orden de recorrido y
      -- cortados en tramos seguidos del tamaño de cada uno.
      with base as (
        select t.pid, t.donde, t.ubics, t.otro, t.n,
               row_number() over (order by t.ultimo asc nulls first, t.n) as atraso
          from unnest(v_pids, v_dondes, v_ubics, v_ultimos, v_con_otros)
               with ordinality as t(pid, donde, ubics, ultimo, otro, n)
      ),
      elegidos as (
        select b.pid, b.donde, b.ubics, b.otro,
               row_number() over (order by b.n) as m
          from base b
         where b.atraso <= v_n
      ),
      topes as (
        select u.i::integer as i, sum(u.x) over (order by u.i) as hasta
          from unnest(v_tams) with ordinality as u(x, i)
      )
      select array_agg(e.pid order by e.m),
             array_agg(e.donde order by e.m),
             array_agg(e.ubics order by e.m),
             array_agg(e.otro order by e.m),
             array_agg((select min(tp.i) from topes tp where tp.hasta >= e.m)
                       order by e.m)
        into v_pids, v_dondes, v_ubics, v_con_otros, v_partes
        from elegidos e;
      v_total := v_n;
    else
      -- Reparto parejo (mig 224). "corte" es el tramo por cantidad; un lugar
      -- (isla de renglones seguidos del mismo lugar) que entra en un tramo se
      -- queda entero en el tramo donde cae su mayoría. Solo se parte un lugar
      -- más grande que un tramo. dense_rank deja las partes sin huecos.
      v_n := least(v_k, v_total);
      with filas as (
        select t.n, split_part(t.donde, ' · ', 1) as lugar,
               (((t.n - 1) * v_n) / v_total + 1)::integer as corte,
               t.n - row_number() over (
                 partition by split_part(t.donde, ' · ', 1) order by t.n) as isla
          from unnest(v_dondes) with ordinality as t(donde, n)
      ),
      grupos as (
        select f.lugar, f.isla, count(*) as tam,
               mode() within group (order by f.corte) as moda
          from filas f
         group by f.lugar, f.isla
      )
      select coalesce(array_agg(x.parte order by x.n), '{}')
        into v_partes
        from (
          select f.n,
                 dense_rank() over (order by
                   case when g.tam * v_n <= v_total then g.moda
                        else f.corte end)::integer as parte
            from filas f
            join grupos g on g.lugar = f.lugar and g.isla = f.isla
        ) x;
    end if;

    -- Partes sin huecos: v_duenos[i] es el responsable de la parte i. En el
    -- reparto parejo ya vienen 1..n; con cantidades puede faltar alguno (al
    -- que no le llegó nada) y su lugar no se le pasa a otro.
    select coalesce(array_agg(d.p order by d.p), '{}') into v_duenos
      from (select distinct p from unnest(v_partes) p) d;
    select array_agg(array_position(v_duenos, t.p) order by t.n) into v_partes
      from unnest(v_partes) with ordinality as t(p, n);
    v_n := cardinality(v_duenos);
    select count(*)::integer into v_otros from unnest(v_con_otros) o where o;

    for v_i in 1..v_n loop
      insert into public.conteo_zonas
        (sesion_id, nombre, responsable_user_id, orden, ubicacion_id, tipo, criterios)
      values (
        p_sesion_id,
        case when v_n > 1 then v_nombre || ' (' || v_i || '/' || v_n || ')'
             else v_nombre end,
        v_resps[v_duenos[v_i]], v_orden, v_ubic, v_tipo, v_crit)
      returning id into v_id;

      insert into public.conteo_zona_productos
        (zona_id, producto_id, orden, donde, ubicacion_ids)
      select v_id, t.pid, t.n::integer, nullif(t.donde, ''), t.ubics::integer[]
        from unnest(v_pids, v_dondes, v_ubics, v_partes)
             with ordinality as t(pid, donde, ubics, parte, n)
       where t.parte = v_i;

      v_orden := v_orden + 1;
    end loop;

    v_salida := v_salida || jsonb_build_object(
      'indice', v_indice, 'nombre', v_nombre, 'tipo', v_tipo, 'libre', false,
      'en_criterio', v_criterio, 'productos', v_total,
      'ya_asignados', v_tomados,
      'recientes', v_recientes, 'sin_asignar', v_sin_asignar,
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

notify pgrst, 'reload schema';

-- Verificación (debe dar true y una sola firma):
select to_regprocedure('public.fn_conteo_crear_tareas(integer,jsonb,boolean)') is not null
         as crear_tareas,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'fn_conteo_crear_tareas') = 1
         as una_sola_firma;
