-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 222 · Conteo físico: tareas con alcance (1/7)           ║
-- ║                                                                    ║
-- ║  Hasta acá una "zona" del conteo (mig 098) era un nombre libre con ║
-- ║  un responsable: no se podía mandar a contar "los productos de tal ║
-- ║  proveedor" o "la clase A", y quien contaba no sabía QUÉ le tocaba.║
-- ║                                                                    ║
-- ║  Ahora cada zona es una TAREA con alcance:                         ║
-- ║   · tipo 'area'  → se cuenta lo que se VE en un lugar del mapa     ║
-- ║                    (mig 170). El total del producto es la suma de  ║
-- ║                    las áreas donde se contó, igual que siempre.    ║
-- ║   · tipo 'lista' → sin lugar fijo (proveedor, clase ABC, categoría,║
-- ║                    marca, alertas): se cuenta el TOTAL del producto║
-- ║                    en todo el local y es exclusivo de la tarea.    ║
-- ║  conteo_zona_productos guarda la lista de cada tarea ya ordenada   ║
-- ║  por el recorrido del local. Las zonas viejas (sin criterios)      ║
-- ║  siguen igual: tipo 'area' sin lista = se escanea lo que haya.     ║
-- ║                                                                    ║
-- ║  100 % aditiva: no toca ninguna función existente.                 ║
-- ║  REQUIERE: migs 098, 170 y 175.                                    ║
-- ║  Después: migs 223 a 228 + types/database.ts.                      ║
-- ║  Ejecutar UNA sola vez, COMPLETO. Primero PRUEBA, después          ║
-- ║  PRODUCCIÓN (HEX-V1).                                              ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. La zona pasa a ser una tarea con alcance
-- ─────────────────────────────────────────────────────────────────────
alter table public.conteo_zonas
  add column if not exists tipo text not null default 'area'
    check (tipo in ('area', 'lista')),
  add column if not exists criterios jsonb;

comment on column public.conteo_zonas.tipo is
  'area = se cuenta lo que hay en un lugar (suma con otras áreas).
   lista = se cuenta el total del producto en todo el local (exclusivo).';
comment on column public.conteo_zonas.criterios is
  'Filtro con el que se armó la lista (ver fn_conteo_alcance, mig 223).
   NULL = zona libre: sin lista, comportamiento de la 098.';

create table if not exists public.conteo_zona_productos (
  zona_id       integer not null references public.conteo_zonas(id) on delete cascade,
  producto_id   integer not null references public.productos(id) on delete cascade,
  orden         integer not null default 0,
  donde         text,
  ubicacion_ids integer[] not null default '{}',
  primary key (zona_id, producto_id)
);

comment on table public.conteo_zona_productos is
  'Lista de productos de cada tarea de conteo, en orden de recorrido. NO
   guarda stock: el conteo sigue siendo ciego.';
comment on column public.conteo_zona_productos.donde is
  'Dónde está el producto según el mapa ("Salón › Góndola 3 · Depósito").';
comment on column public.conteo_zona_productos.ubicacion_ids is
  'Nodos del mapa que esta tarea cubre para el producto. Evita que dos
   tareas por área cuenten el mismo producto en el mismo lugar.';

create index if not exists conteo_zona_productos_prod_idx
  on public.conteo_zona_productos(producto_id);

-- Lectura: gestores, el responsable / recontador de la tarea, o el staff con
-- 'inventario' si la tarea está libre. Escritura: solo las fn_* (definer).
alter table public.conteo_zona_productos enable row level security;
drop policy if exists "conteo_zona_productos_select" on public.conteo_zona_productos;
create policy "conteo_zona_productos_select" on public.conteo_zona_productos
  for select to authenticated
  using (
    (select public.fn_tiene_permiso('conteo_cierre'))
    or exists (
      select 1 from public.conteo_zonas z
       where z.id = conteo_zona_productos.zona_id
         and (z.responsable_user_id = (select auth.uid())
              or z.reconteo_user_id = (select auth.uid())
              or (z.responsable_user_id is null
                  and (select public.fn_tiene_permiso('inventario'))))
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 2. Helpers
-- ─────────────────────────────────────────────────────────────────────
-- Arreglo jsonb → integer[]. Lo que no sea un entero (null, "1.5", texto)
-- se descarta; si no es un arreglo, vacío.
create or replace function public.fn_jsonb_enteros(p jsonb)
returns integer[]
language sql immutable
as $$
  select case when jsonb_typeof(p) = 'array'
    then coalesce(
      (select array_agg(distinct x::integer)
         from jsonb_array_elements_text(p) x
        where x ~ '^[0-9]{1,9}$'),
      '{}'::integer[])
    else '{}'::integer[] end
$$;

-- Arreglo jsonb de textos → text[] (sin vacíos). Si no es un arreglo, vacío.
create or replace function public.fn_jsonb_textos(p jsonb)
returns text[]
language sql immutable
as $$
  select case when jsonb_typeof(p) = 'array'
    then coalesce(
      (select array_agg(distinct btrim(x))
         from jsonb_array_elements_text(p) x
        where btrim(x) <> ''),
      '{}'::text[])
    else '{}'::text[] end
$$;

-- Los nodos pedidos más todo lo que cuelga de ellos.
create or replace function public.fn_conteo_rama(p_ids integer[])
returns integer[]
language sql stable security definer set search_path = public
as $$
  with recursive rama as (
    select u.id from public.ubicaciones u where u.id = any(p_ids)
    union
    select h.id from public.ubicaciones h join rama r on h.parent_id = r.id
  )
  select coalesce(array_agg(rama.id), '{}'::integer[]) from rama
$$;

-- El lugar que cubre una tarea: sus áreas (criterios) y/o su ancla, con
-- todo lo que cuelga. Vacío = zona libre sin ancla (no se sabe qué lugar es).
create or replace function public.fn_conteo_rama_zona(p_criterios jsonb, p_ubicacion_id integer)
returns integer[]
language sql stable security definer set search_path = public
as $$
  select public.fn_conteo_rama(
    public.fn_jsonb_enteros(p_criterios->'ubicacion_ids')
    || case when p_ubicacion_id is null then '{}'::integer[]
            else array[p_ubicacion_id] end)
$$;

-- Ruta legible de un nodo: "Salón › Góndola 3 › Estante 2" (sin la sucursal).
create or replace function public.fn_conteo_ruta(p_ubicacion_id integer)
returns text
language sql stable security definer set search_path = public
as $$
  with recursive cadena as (
    select u.id, u.parent_id, u.tipo, u.nombre, 0 as nivel
      from public.ubicaciones u where u.id = p_ubicacion_id
    union all
    select p.id, p.parent_id, p.tipo, p.nombre, c.nivel + 1
      from public.ubicaciones p join cadena c on c.parent_id = p.id
  )
  select string_agg(c.nombre, ' › ' order by c.nivel desc)
    from cadena c where c.tipo <> 'sucursal'
$$;

revoke execute on function public.fn_conteo_rama(integer[]) from public, anon;
grant execute on function public.fn_conteo_rama(integer[]) to authenticated;
revoke execute on function public.fn_conteo_rama_zona(jsonb, integer) from public, anon;
grant execute on function public.fn_conteo_rama_zona(jsonb, integer) to authenticated;
revoke execute on function public.fn_conteo_ruta(integer) from public, anon;
grant execute on function public.fn_conteo_ruta(integer) to authenticated;

notify pgrst, 'reload schema';

-- Verificación (las tres columnas deben dar true):
select
  to_regclass('public.conteo_zona_productos') is not null as tabla_creada,
  to_regprocedure('public.fn_conteo_rama_zona(jsonb,integer)') is not null as helpers_creados,
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'conteo_zonas'
             and column_name = 'criterios') as columnas_creadas;
