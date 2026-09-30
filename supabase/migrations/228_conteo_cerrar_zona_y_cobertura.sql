-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 228 · Conteo físico: tareas con alcance (7/7)           ║
-- ║                                                                    ║
-- ║  1. fn_cerrar_zona v3 (base 176 ÍNTEGRA + bloque "v3").            ║
-- ║     La v2 ubicaba en el ancla TODO lo contado. Con una tarea       ║
-- ║     anclada a una góndola, un producto que ya vivía en un estante  ║
-- ║     de ESA góndola ganaba una segunda ubicación (la góndola): el   ║
-- ║     mapa se llenaba de duplicados y cada producto pasaba a "vivir  ║
-- ║     en dos lugares". Ahora solo ubica lo que todavía no tiene      ║
-- ║     ningún lugar DENTRO del ancla. Misma firma → create or replace.║
-- ║                                                                    ║
-- ║  2. fn_conteo_cobertura: el aviso que hace confiable contar por    ║
-- ║     área. El total de un producto es la suma de los lugares donde  ║
-- ║     se contó; si vive en la góndola Y en el depósito y solo se     ║
-- ║     contó la góndola, lo contado es una PARTE y al cerrar daría un ║
-- ║     faltante que no existe. Devuelve, por producto contado a       ║
-- ║     medias, cada lugar que falta y por qué:                        ║
-- ║       sin_tarea  → nadie tiene ese lugar en su tarea               ║
-- ║       sin_contar → estaba en la tarea X, que cerró sin cargarlo    ║
-- ║     Lo que está en una tarea todavía abierta no se informa: es     ║
-- ║     trabajo en curso. Es solo informativa: no cambia el cierre ni  ║
-- ║     las diferencias. No opina sobre productos contados en zonas    ║
-- ║     libres sin ancla (no se sabe qué lugar cubrieron).             ║
-- ║                                                                    ║
-- ║  REQUIERE: migs 176 y 222. Correr el chequeo T1 después.           ║
-- ║  Ejecutar UNA sola vez, COMPLETO. Primero PRUEBA, después          ║
-- ║  PRODUCCIÓN (HEX-V1).                                              ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. fn_cerrar_zona v3
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_cerrar_zona(p_zona_id integer)
returns public.conteo_zonas
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_zona public.conteo_zonas;
  v_rama integer[];  -- v3
begin
  if v_uid is null then
    raise exception 'No se pudo identificar al usuario.';
  end if;
  select * into v_zona from public.conteo_zonas where id = p_zona_id;
  if v_zona.id is null then
    raise exception 'La zona no existe.';
  end if;
  -- Sesión primero, zona después (orden de locks del módulo); FOR SHARE
  -- serializa contra pasar_a_revision/cierre (ver fn_iniciar_zona).
  perform 1 from public.conteo_sesiones where id = v_zona.sesion_id for share;
  select * into v_zona from public.conteo_zonas where id = p_zona_id for update;
  if v_zona.estado <> 'en_curso' then
    raise exception 'Solo se puede cerrar una zona en curso.';
  end if;
  if not public.fn_tiene_permiso('conteo_cierre')
     and v_zona.responsable_user_id is distinct from v_uid then
    raise exception 'Solo el responsable asignado puede cerrar esta zona.';
  end if;

  update public.conteo_zonas
     set estado = 'cerrada', ts_fin = now()
   where id = p_zona_id
   returning * into v_zona;

  -- ── Mapeo best-effort (v2): la zona anclada asigna sus productos
  -- contados a la ubicación. Regla: PRINCIPAL solo si el producto no
  -- tenía ninguna (no se pisan asignaciones a mano); si ya tenía, queda
  -- como secundaria. Cualquier error acá NO tumba el cierre de la zona.
  -- v3: solo los que NO tienen ya un lugar dentro del ancla. ──
  if v_zona.ubicacion_id is not null then
    begin
      v_rama := public.fn_conteo_rama(array[v_zona.ubicacion_id]);

      -- 1) Asegura la fila producto↔ubicación (como secundaria, inocuo).
      insert into public.producto_ubicacion (producto_id, ubicacion_id, es_principal)
      select d.producto_id, v_zona.ubicacion_id, false
      from (
        select distinct producto_id
        from public.conteo_detalle
        where zona_id = p_zona_id and cantidad_contada > 0
      ) d
      where not exists (
        select 1 from public.producto_ubicacion pu
        where pu.producto_id = d.producto_id
          and pu.ubicacion_id = any(v_rama)
      )
      on conflict (producto_id, ubicacion_id) do nothing;

      -- 2) Promueve a principal a los que no tenían ninguna.
      update public.producto_ubicacion pu
         set es_principal = true
       where pu.ubicacion_id = v_zona.ubicacion_id
         and not pu.es_principal
         and pu.producto_id in (
           select distinct producto_id from public.conteo_detalle
           where zona_id = p_zona_id and cantidad_contada > 0
         )
         and not exists (
           select 1 from public.producto_ubicacion pu2
           where pu2.producto_id = pu.producto_id and pu2.es_principal
         );
    exception when others then null;
    end;
  end if;

  return v_zona;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. fn_conteo_cobertura
--    Un renglón por (producto, lugar que falta).
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_conteo_cobertura(integer);

create function public.fn_conteo_cobertura(p_sesion_id integer)
returns table (
  producto_id integer,
  nombre text,
  ubicacion_id integer,
  ubicacion text,
  motivo text,
  tarea text
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.fn_tiene_permiso('conteo_cierre') then
    raise exception 'No tenés permiso para ver la cobertura del conteo.';
  end if;

  return query
  with recursive arbol as (
    select u.id, u.activo from public.ubicaciones u where u.parent_id is null
    union all
    select h.id, (h.activo and a.activo)
      from public.ubicaciones h join arbol a on h.parent_id = a.id
  ),
  zonas as (
    select z.id, z.nombre as tarea, z.tipo, z.estado,
           public.fn_conteo_rama_zona(z.criterios, z.ubicacion_id) as rama
      from public.conteo_zonas z
     where z.sesion_id = p_sesion_id
  ),
  cargas as (
    select d.producto_id as pid, z.id as zid, z.tipo, z.rama
      from public.conteo_detalle d
      join zonas z on z.id = d.zona_id
     where not d.es_reconteo
  ),
  contados as (
    -- Contados en algún área con lugar conocido, y en ninguna 'lista'
    -- (total del local) ni zona libre sin ancla (lugar desconocido).
    select c.pid
      from cargas c
     group by c.pid
    having bool_or(c.tipo = 'area' and cardinality(c.rama) > 0)
       and not bool_or(c.tipo = 'lista' or cardinality(c.rama) = 0)
  ),
  faltan as (
    select pu.producto_id as pid, pu.ubicacion_id as uid
      from public.producto_ubicacion pu
      join arbol a on a.id = pu.ubicacion_id and a.activo
      join contados co on co.pid = pu.producto_id
     where not exists (
       select 1 from cargas c
        where c.pid = pu.producto_id and pu.ubicacion_id = any(c.rama)
     )
  )
  select p.id,
         p.nombre::text,
         f.uid,
         public.fn_conteo_ruta(f.uid),
         case when r.tarea is null then 'sin_tarea' else 'sin_contar' end,
         r.tarea::text
    from faltan f
    join public.productos p on p.id = f.pid
    left join lateral (
      -- La tarea que tenía este producto en este lugar (si la hay).
      select z.tarea, z.estado
        from public.conteo_zona_productos zp
        join zonas z on z.id = zp.zona_id
       where zp.producto_id = f.pid and f.uid = any(zp.ubicacion_ids)
       order by (z.estado <> 'cerrada') desc, z.id
       limit 1
    ) r on true
   where r.estado is null or r.estado = 'cerrada'
   order by p.id, f.uid;
end;
$$;

revoke execute on function public.fn_conteo_cobertura(integer) from public, anon;
grant execute on function public.fn_conteo_cobertura(integer) to authenticated;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- Verificación (las dos columnas deben dar true) + chequeo T1 (0 filas):
--   select proname, count(*) from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and proname like 'fn_%'
--   group by proname having count(*) > 1;
-- ─────────────────────────────────────────────────────────────────────
select
  to_regprocedure('public.fn_conteo_cobertura(integer)') is not null as cobertura,
  pg_get_functiondef('public.fn_cerrar_zona(integer)'::regprocedure)
    like '%fn_conteo_rama%' as cerrar_zona_v3;
