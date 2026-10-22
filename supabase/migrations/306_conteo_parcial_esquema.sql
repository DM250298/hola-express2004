-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 306 · Conteo parcial y cíclico (1/4): esquema y helpers ║
-- ║                                                                    ║
-- ║  El dueño quiere contar las clases A, B y C de a partes ("contá 50 ║
-- ║  de los 505") y saber qué falta hasta completar cada clase. Una    ║
-- ║  tarea puede llevar un TOPE de productos y una VENTANA en días: lo ║
-- ║  contado en una sesión CERRADA dentro de la ventana se saltea, y   ║
-- ║  del resto se toman los primeros N del recorrido del mapa.         ║
-- ║                                                                    ║
-- ║  Acá: las dos columnas en conteo_zonas y tres helpers internos:    ║
-- ║   · fn_conteo_ultimos()      último conteo cerrado por producto    ║
-- ║   · fn_conteo_responsables() los responsables de una tarea (texto  ║
-- ║                              de la 224, sacado para acortarla)     ║
-- ║   · fn_conteo_repartir()     el reparto en tramos (ídem)           ║
-- ║  Ninguno lo llama la app. Después: 307, 308 y 309.                 ║
-- ║  Ejecutar UNA sola vez, COMPLETO. Primero PRUEBA, después          ║
-- ║  PRODUCCIÓN (HEX-V1). Última línea: "notify pgrst, 'reload schema';"║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.conteo_zonas
  add column if not exists cantidad_max integer check (cantidad_max > 0),
  add column if not exists sin_contar_dias integer check (sin_contar_dias > 0);

comment on column public.conteo_zonas.cantidad_max is
  'Conteo parcial (mig 306): tope de productos de la tarea; se toman los
   primeros del recorrido. NULL = toda la lista.';
comment on column public.conteo_zonas.sin_contar_dias is
  'Conteo cíclico (mig 306): se saltea lo contado en una sesión cerrada
   hace menos de N días. NULL = no se saltea nada.';

-- ─────────────────────────────────────────────────────────────────────
-- 1. Último conteo por producto: la sesión CERRADA más reciente donde se
--    cargó (sin reconteos). Se mide por el cierre de la sesión, que es
--    cuando el stock quedó ajustado. Interna: expone sesiones cerradas que
--    la RLS le oculta al empleado.
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_conteo_ultimos();

create function public.fn_conteo_ultimos()
returns table (
  producto_id integer,
  ultimo_ts timestamptz,
  sesion_id integer,
  sesion_nombre text
)
language sql stable security definer set search_path = public
as $$
  select distinct on (d.producto_id)
         d.producto_id, s.ts_cierre, s.id, s.nombre
    from public.conteo_detalle d
    join public.conteo_zonas z on z.id = d.zona_id
    join public.conteo_sesiones s on s.id = z.sesion_id
   where s.estado = 'cerrada'
     and s.ts_cierre is not null
     and not d.es_reconteo
   order by d.producto_id, s.ts_cierre desc
$$;

revoke execute on function public.fn_conteo_ultimos()
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Responsables de una tarea del JSON: el arreglo nuevo o el campo único
--    de las migs 098/176. Sin repetidos (una persona, una tarea), sin
--    vacíos y todos usuarios activos. Texto de la 224, líneas 69 a 87.
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_conteo_responsables(jsonb, text);

create function public.fn_conteo_responsables(p_item jsonb, p_nombre text)
returns uuid[]
language plpgsql stable security definer set search_path = public
as $$
declare
  c_uuid constant text := '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$';
  v_resps uuid[] := '{}';
  v_resp uuid;
begin
  if jsonb_typeof(p_item->'responsables') = 'array' then
    select coalesce(array_agg(t.x::uuid order by t.n), '{}') into v_resps
      from (select lower(e.x) as x, min(e.n) as n
              from jsonb_array_elements_text(p_item->'responsables')
                   with ordinality as e(x, n)
             where e.x ~* c_uuid
             group by lower(e.x)) t;
  elsif coalesce(p_item->>'responsable_user_id', '') ~* c_uuid then
    v_resps := array[(p_item->>'responsable_user_id')::uuid];
  end if;
  foreach v_resp in array v_resps loop
    if not exists (select 1 from public.usuarios u
                    where u.id = v_resp and u.activo) then
      raise exception 'Un responsable de la tarea "%" no es un usuario activo.', p_nombre;
    end if;
  end loop;
  return v_resps;
end;
$$;

revoke execute on function public.fn_conteo_responsables(jsonb, text)
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Reparto de una lista (ya en orden de recorrido) entre N personas, en
--    tramos seguidos. "corte" es el tramo por cantidad; un lugar (isla de
--    renglones seguidos del mismo lugar) que entra en un tramo se queda
--    entero en el tramo donde cae su mayoría. Solo se parte un lugar más
--    grande que un tramo. dense_rank deja las partes sin huecos.
--    Devuelve la parte (1..k) de cada renglón; k = max del arreglo.
--    Texto de la 224, líneas 150 a 178.
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_conteo_repartir(text[], integer);

create function public.fn_conteo_repartir(p_dondes text[], p_personas integer)
returns integer[]
language plpgsql immutable
as $$
declare
  v_total integer := coalesce(cardinality(p_dondes), 0);
  v_n integer;
  v_partes integer[] := '{}';
begin
  if v_total = 0 then
    return v_partes;
  end if;
  v_n := least(greatest(coalesce(p_personas, 0), 1), v_total);
  with filas as (
    select t.n, split_part(t.donde, ' · ', 1) as lugar,
           (((t.n - 1) * v_n) / v_total + 1)::integer as corte,
           t.n - row_number() over (
             partition by split_part(t.donde, ' · ', 1) order by t.n) as isla
      from unnest(p_dondes) with ordinality as t(donde, n)
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
  return v_partes;
end;
$$;

revoke execute on function public.fn_conteo_repartir(text[], integer)
  from public, anon, authenticated;

-- Verificación: las 5 filas tienen que dar true.
-- select 'cantidad_max' as que, exists (select 1 from information_schema.columns
--          where table_name = 'conteo_zonas' and column_name = 'cantidad_max') as ok
-- union all select 'sin_contar_dias', exists (select 1 from information_schema.columns
--          where table_name = 'conteo_zonas' and column_name = 'sin_contar_dias')
-- union all select 'fn_conteo_ultimos', to_regprocedure('public.fn_conteo_ultimos()') is not null
-- union all select 'fn_conteo_responsables', to_regprocedure('public.fn_conteo_responsables(jsonb,text)') is not null
-- union all select 'fn_conteo_repartir', to_regprocedure('public.fn_conteo_repartir(text[],integer)') is not null;

notify pgrst, 'reload schema';
