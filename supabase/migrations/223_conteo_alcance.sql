-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 223 · Conteo físico: tareas con alcance (2/7)           ║
-- ║                                                                    ║
-- ║  1. fn_conteo_alcance: qué productos entran en un criterio.        ║
-- ║  2. fn_conteo_candidatos (interna): de esos, cuáles quedan libres  ║
-- ║     para una tarea nueva de la sesión (ver reglas en el punto 2).  ║
-- ║                                                                    ║
-- ║  p_criterios: { "ubicacion_ids": [12], "proveedor_ids": [3, 8],    ║
-- ║                 "categoria_ids": [4], "marca_ids": [9],            ║
-- ║                 "clases_abc": ["A", "B"],                          ║
-- ║                 "reglas_alerta": ["stock_desfasado"],              ║
-- ║                 "sin_ubicar": true }                               ║
-- ║  Entre criterios es Y; dentro de cada uno es O.                    ║
-- ║   · ubicacion_ids: el área y todo lo que cuelga de ella.           ║
-- ║   · proveedor_ids: el proveedor del producto o el catálogo N:M.    ║
-- ║   · clases_abc: último snapshot diario (mig 173), la misma clase   ║
-- ║     que muestran el mapa y el tablero. 'N' = sin ventas en 30 días.║
-- ║   · reglas_alerta: productos con una alerta VIVA de esas reglas.   ║
-- ║   · sin_ubicar: productos que el mapa todavía no tiene ubicados    ║
-- ║     (si no, un inventario por áreas los deja siempre afuera).      ║
-- ║  Quedan afuera los combos (se cuentan sus componentes, mig 112),   ║
-- ║  los inactivos y los que no controlan stock.                       ║
-- ║  No devuelve stock ni costos: el conteo es ciego.                  ║
-- ║                                                                    ║
-- ║  REQUIERE: migs 112, 173, 177, 183 y 222. 100 % aditiva.           ║
-- ║  Ejecutar UNA sola vez, COMPLETO. Primero PRUEBA, después          ║
-- ║  PRODUCCIÓN (HEX-V1).                                              ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. fn_conteo_alcance
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_conteo_alcance(jsonb);

create function public.fn_conteo_alcance(p_criterios jsonb)
returns table (
  producto_id integer,
  nombre text,
  codigo_barras text,
  venta_por_peso boolean,
  clase_abc text,
  -- Dónde está, DENTRO del área pedida (o en todo el local si no hay área).
  donde text,
  ubicacion_ids integer[],
  -- Dónde más vive, FUERA del área pedida: contarlo solo acá es contarlo
  -- a medias. NULL si no hay área o si no vive en otro lado.
  otros text,
  orden integer
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_ubic integer[] := public.fn_jsonb_enteros(p_criterios->'ubicacion_ids');
  v_prov integer[] := public.fn_jsonb_enteros(p_criterios->'proveedor_ids');
  v_cat integer[] := public.fn_jsonb_enteros(p_criterios->'categoria_ids');
  v_marca integer[] := public.fn_jsonb_enteros(p_criterios->'marca_ids');
  -- upper() sobre el texto del arreglo: ["a"] y ["A"] piden la misma clase.
  v_clases text[] := public.fn_jsonb_textos(
    upper((p_criterios->'clases_abc')::text)::jsonb);
  v_reglas text[] := public.fn_jsonb_textos(p_criterios->'reglas_alerta');
  v_sin_ubicar boolean := coalesce(p_criterios->>'sin_ubicar', '') = 'true';
  v_rama integer[];
  v_fecha date;
begin
  if not public.fn_tiene_permiso('conteo_cierre') then
    raise exception 'No tenés permiso para armar tareas de conteo.';
  end if;
  if cardinality(v_ubic) + cardinality(v_prov) + cardinality(v_cat)
     + cardinality(v_marca) + cardinality(v_clases) + cardinality(v_reglas) = 0
     and not v_sin_ubicar then
    raise exception 'Elegí al menos un criterio para armar la tarea.';
  end if;
  v_rama := public.fn_conteo_rama(v_ubic);
  select max(m.fecha) into v_fecha from public.metricas_sku_diarias m;

  return query
  with recursive arbol as (
    -- clave: texto ordenable con el recorrido del local (orden + id por
    -- nivel). Un nodo bajo un padre inactivo cuenta como inactivo: el mapa
    -- oculta toda la rama.
    select u.id, u.activo,
           to_char(u.orden, 'FM00000') || to_char(u.id, 'FM0000000') as clave,
           case when u.tipo = 'sucursal' then '' else u.nombre end as ruta
      from public.ubicaciones u
     where u.parent_id is null
    union all
    select h.id, (h.activo and a.activo),
           a.clave || to_char(h.orden, 'FM00000') || to_char(h.id, 'FM0000000'),
           case when a.ruta = '' then h.nombre else a.ruta || ' › ' || h.nombre end
      from public.ubicaciones h
      join arbol a on h.parent_id = a.id
  ),
  ubic as (
    select pu.producto_id as pid, pu.ubicacion_id as uid,
           pu.es_principal as principal, pu.orden as pos, a.clave, a.ruta,
           (cardinality(v_ubic) = 0 or pu.ubicacion_id = any(v_rama)) as adentro
      from public.producto_ubicacion pu
      join arbol a on a.id = pu.ubicacion_id
     where a.activo
  ),
  lugar as (
    select u.pid,
           string_agg(u.ruta, ' · ' order by u.principal desc, u.clave)
             filter (where u.adentro) as texto,
           array_agg(u.uid) filter (where u.adentro) as uids,
           (array_agg(u.clave order by u.principal desc, u.clave)
             filter (where u.adentro))[1] as clave,
           min(u.pos) filter (where u.adentro) as pos,
           string_agg(u.ruta, ' · ' order by u.clave)
             filter (where not u.adentro) as afuera
      from ubic u
     group by u.pid
  ),
  clase as (
    select m.producto_id as pid, m.clase_abc::text as letra
      from public.metricas_sku_diarias m
     where m.fecha = v_fecha
  )
  select p.id,
         p.nombre::text,
         p.codigo_barras::text,
         coalesce(p.venta_por_peso, false),
         coalesce(cl.letra, 'N'),
         l.texto,
         coalesce(l.uids, '{}'::integer[]),
         l.afuera,
         (row_number() over (
            order by l.clave nulls last, l.pos, lower(p.nombre), p.id))::integer
    from public.productos p
    left join lugar l on l.pid = p.id
    left join clase cl on cl.pid = p.id
   where p.activo
     and coalesce(p.controlar_stock, true)
     and not exists (select 1 from public.producto_componentes pc
                      where pc.producto_id = p.id)
     and (cardinality(v_ubic) = 0 or l.uids is not null)
     and (not v_sin_ubicar or l.pid is null)
     and (cardinality(v_prov) = 0
          or p.proveedor_id = any(v_prov)
          or exists (select 1 from public.proveedor_producto pp
                      where pp.producto_id = p.id
                        and pp.proveedor_id = any(v_prov)))
     and (cardinality(v_cat) = 0 or p.categoria_id = any(v_cat))
     and (cardinality(v_marca) = 0 or p.marca_id = any(v_marca))
     and (cardinality(v_clases) = 0 or coalesce(cl.letra, 'N') = any(v_clases))
     and (cardinality(v_reglas) = 0
          or exists (select 1 from public.alertas al
                      where al.producto_id = p.id
                        and al.estado <> 'resuelta'
                        and al.regla_codigo = any(v_reglas)))
   order by 9;
end;
$$;

revoke execute on function public.fn_conteo_alcance(jsonb) from public, anon;
grant execute on function public.fn_conteo_alcance(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 2. fn_conteo_candidatos (interna) · el alcance, menos lo que ya tomó
--    otra tarea de la sesión. "entra" dice si el producto queda para la
--    tarea nueva; "libres" son los lugares que le quedan. Reglas:
--     · Lo que ya es de una tarea 'lista', o ya se contó en una, no entra
--       en ninguna otra. Una 'lista' nueva tampoco se lleva lo que ya es
--       de otra tarea o ya se contó en cualquier lado.
--     · Dos tareas por área comparten un producto solo en lugares
--       DISTINTOS: a la nueva le quedan las ubicaciones que nadie tomó
--       (ni por lista, ni por haberlo contado en una tarea de ese lugar).
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_conteo_candidatos(integer, jsonb, text);

create function public.fn_conteo_candidatos(
  p_sesion_id integer, p_criterios jsonb, p_tipo text
)
returns table (
  producto_id integer,
  orden integer,
  lugar text,
  libres integer[],
  otros text,
  entra boolean
)
language sql stable security definer set search_path = public
as $$
  select b.producto_id, b.orden,
         case when p_tipo = 'lista'
                   or cardinality(b.libres) = cardinality(b.ubicacion_ids)
              then coalesce(b.donde, '')
              else coalesce((select string_agg(public.fn_conteo_ruta(u), ' · ')
                               from unnest(b.libres) u), '') end,
         b.libres, b.otros,
         (not b.tomado and (p_tipo = 'lista' or cardinality(b.libres) > 0))
    from (
      select a.producto_id, a.orden, a.donde, a.otros, a.ubicacion_ids,
             (exists (select 1
                        from public.conteo_zona_productos zp
                        join public.conteo_zonas z on z.id = zp.zona_id
                       where z.sesion_id = p_sesion_id
                         and zp.producto_id = a.producto_id
                         and (z.tipo = 'lista' or p_tipo = 'lista'))
              or exists (select 1
                           from public.conteo_detalle d
                           join public.conteo_zonas z on z.id = d.zona_id
                          where z.sesion_id = p_sesion_id
                            and d.producto_id = a.producto_id
                            and not d.es_reconteo
                            and (z.tipo = 'lista' or p_tipo = 'lista'))) as tomado,
             case when p_tipo = 'area' then array(
               select u from unnest(a.ubicacion_ids) u
               except
               select unnest(zp.ubicacion_ids)
                 from public.conteo_zona_productos zp
                 join public.conteo_zonas z on z.id = zp.zona_id
                where z.sesion_id = p_sesion_id
                  and zp.producto_id = a.producto_id
               except
               select unnest(public.fn_conteo_rama_zona(z.criterios, z.ubicacion_id))
                 from public.conteo_detalle d
                 join public.conteo_zonas z on z.id = d.zona_id
                where z.sesion_id = p_sesion_id
                  and d.producto_id = a.producto_id
                  and not d.es_reconteo
             ) else a.ubicacion_ids end as libres
        from public.fn_conteo_alcance(p_criterios) a
        -- Solo lo que está en el snapshot: lo demás no entra en las diferencias.
        join public.conteo_snapshot s
          on s.sesion_id = p_sesion_id and s.producto_id = a.producto_id
    ) b
$$;

revoke execute on function public.fn_conteo_candidatos(integer, jsonb, text)
  from public, anon, authenticated;

notify pgrst, 'reload schema';

-- Verificación (las dos columnas deben dar true). fn_conteo_alcance se prueba
-- desde la app: en el SQL Editor no hay usuario logueado y rechaza por permiso.
select
  to_regprocedure('public.fn_conteo_alcance(jsonb)') is not null as alcance_creada,
  to_regprocedure('public.fn_conteo_candidatos(integer,jsonb,text)') is not null as candidatos_creada;
