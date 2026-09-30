-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 224 · Conteo físico: tareas con alcance (3/7)           ║
-- ║                                                                    ║
-- ║  fn_conteo_crear_tareas (interna): crea las tareas de una sesión   ║
-- ║  y arma la lista de cada una. Reglas:                              ║
-- ║   · Se procesan en el orden recibido: el producto es de la PRIMERA ║
-- ║     tarea que lo pide (qué queda libre lo decide                   ║
-- ║     fn_conteo_candidatos, mig 223).                                ║
-- ║   · Con varios responsables la lista se reparte en tramos seguidos ║
-- ║     del recorrido y, si se puede, el corte cae entre dos lugares:  ║
-- ║     no se le parte un estante a dos personas.                      ║
-- ║                                                                    ║
-- ║  p_zonas: [{ "nombre": "Clase A", "responsables": ["<uuid>", …],   ║
-- ║              "criterios": { "clases_abc": ["A"] } }, …]            ║
-- ║  Sin "criterios" es una zona libre (payload de las migs 098/176).  ║
-- ║  p_estricto = false (vista previa): una tarea sin productos no     ║
-- ║  corta todo, se informa con productos = 0.                         ║
-- ║  Devuelve un renglón por tarea pedida, con sus cantidades.         ║
-- ║                                                                    ║
-- ║  REQUIERE: migs 222 y 223. No la llama la app: la usan las         ║
-- ║  funciones de la mig 225.                                          ║
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
  v_resp uuid;
  v_ubic integer;
  v_areas integer[];
  v_tipo text;
  v_pids integer[];
  v_dondes text[];
  v_ubics text[];
  v_partes integer[];
  v_criterio integer;  -- cumplen el criterio
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

    -- Responsables: el arreglo nuevo o el campo único de las migs 098/176.
    -- Sin repetidos (una persona, una tarea) y sin vacíos.
    v_resps := '{}';
    if jsonb_typeof(v_item->'responsables') = 'array' then
      select coalesce(array_agg(t.x::uuid order by t.n), '{}') into v_resps
        from (select lower(e.x) as x, min(e.n) as n
                from jsonb_array_elements_text(v_item->'responsables')
                     with ordinality as e(x, n)
               where e.x ~* c_uuid
               group by lower(e.x)) t;
    elsif coalesce(v_item->>'responsable_user_id', '') ~* c_uuid then
      v_resps := array[(v_item->>'responsable_user_id')::uuid];
    end if;
    foreach v_resp in array v_resps loop
      if not exists (select 1 from public.usuarios u
                      where u.id = v_resp and u.activo) then
        raise exception 'Un responsable de la tarea "%" no es un usuario activo.', v_nombre;
      end if;
    end loop;

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
        'con_otros_lugares', 0, 'partes', 1, 'por_parte', '[]'::jsonb);
      continue;
    end if;

    -- Candidatos: los del criterio, menos lo que ya tomó otra tarea.
    select coalesce(array_agg(c.producto_id order by c.orden) filter (where c.entra), '{}'),
           coalesce(array_agg(c.lugar order by c.orden) filter (where c.entra), '{}'),
           coalesce(array_agg(c.libres::text order by c.orden) filter (where c.entra), '{}'),
           count(*)::integer,
           (count(*) filter (where c.entra and c.otros is not null))::integer
      into v_pids, v_dondes, v_ubics, v_criterio, v_otros
      from public.fn_conteo_candidatos(p_sesion_id, v_crit, v_tipo) c;
    v_total := cardinality(v_pids);

    if v_total = 0 then
      if p_estricto then
        raise exception 'La tarea "%" quedó sin productos: ninguno cumple el criterio o ya están todos en otra tarea de esta sesión.', v_nombre;
      end if;
      v_salida := v_salida || jsonb_build_object(
        'indice', v_indice, 'nombre', v_nombre, 'tipo', v_tipo, 'libre', false,
        'en_criterio', v_criterio, 'productos', 0, 'ya_asignados', v_criterio,
        'con_otros_lugares', 0, 'partes', 0, 'por_parte', '[]'::jsonb);
      continue;
    end if;

    -- Reparto. "corte" es el tramo por cantidad; un lugar (isla de renglones
    -- seguidos del mismo lugar) que entra en un tramo se queda entero en el
    -- tramo donde cae su mayoría. Solo se parte un lugar más grande que un
    -- tramo. dense_rank deja las partes sin huecos.
    v_n := least(greatest(cardinality(v_resps), 1), v_total);
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
    select coalesce(array_agg(x.parte order by x.n), '{}'),
           coalesce(max(x.parte), 0)
      into v_partes, v_n
      from (
        select f.n,
               dense_rank() over (order by
                 case when g.tam * v_n <= v_total then g.moda
                      else f.corte end)::integer as parte
          from filas f
          join grupos g on g.lugar = f.lugar and g.isla = f.isla
      ) x;

    for v_i in 1..v_n loop
      insert into public.conteo_zonas
        (sesion_id, nombre, responsable_user_id, orden, ubicacion_id, tipo, criterios)
      values (
        p_sesion_id,
        case when v_n > 1 then v_nombre || ' (' || v_i || '/' || v_n || ')'
             else v_nombre end,
        v_resps[v_i], v_orden, v_ubic, v_tipo, v_crit)
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
      'ya_asignados', v_criterio - v_total,
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

-- Verificación (debe dar true):
select to_regprocedure('public.fn_conteo_crear_tareas(integer,jsonb,boolean)') is not null
  as crear_tareas;
