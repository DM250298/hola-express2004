-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 309 · Conteo parcial y cíclico (4/4): qué falta contar  ║
-- ║                                                                    ║
-- ║  fn_conteo_pendientes(criterios, días): los productos del criterio ║
-- ║  (mismo filtro y mismo orden de recorrido que las tareas, por      ║
-- ║  fn_conteo_alcance) con su último conteo cerrado y dos marcas:     ║
-- ║   · contado_en_ventana → se contó en una sesión cerrada hace menos ║
-- ║                          de N días (ya está hecho en este ciclo)   ║
-- ║   · en_tarea_abierta   → está en una tarea de la sesión viva (no   ║
-- ║                          cuenta como hecho, pero tampoco se puede  ║
-- ║                          volver a mandar)                          ║
-- ║  La app arma con esto la tarjeta "Avance por clase ABC" (pidiendo  ║
-- ║  las clases A, B, C y N) y la lista de pendientes de cada clase.   ║
-- ║  Solo gestores (conteo_cierre), como fn_conteo_alcance.            ║
-- ║                                                                    ║
-- ║  REQUIERE: mig 306. Ejecutar UNA sola vez, COMPLETO. Primero       ║
-- ║  PRUEBA, después PRODUCCIÓN (HEX-V1).                              ║
-- ║  Última línea: "notify pgrst, 'reload schema';"                    ║
-- ╚════════════════════════════════════════════════════════════════════╝

drop function if exists public.fn_conteo_pendientes(jsonb, integer);

create function public.fn_conteo_pendientes(
  p_criterios jsonb,
  p_dias integer default 30
) returns table (
  producto_id integer,
  nombre text,
  codigo_barras text,
  clase_abc text,
  donde text,
  orden integer,
  ultimo_ts timestamptz,
  ultima_sesion text,
  contado_en_ventana boolean,
  en_tarea_abierta boolean
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.fn_tiene_permiso('conteo_cierre') then
    raise exception 'No tenés permiso para ver el avance del conteo.';
  end if;
  if p_dias is null or p_dias <= 0 then
    raise exception 'La ventana tiene que ser de al menos un día.';
  end if;

  return query
  select a.producto_id, a.nombre, a.codigo_barras, a.clase_abc, a.donde, a.orden,
         u.ultimo_ts, u.sesion_nombre,
         coalesce(u.ultimo_ts >= now() - make_interval(days => p_dias), false),
         exists (select 1
                   from public.conteo_zona_productos zp
                   join public.conteo_zonas z on z.id = zp.zona_id
                   join public.conteo_sesiones s on s.id = z.sesion_id
                  where s.estado <> 'cerrada'
                    and zp.producto_id = a.producto_id)
    from public.fn_conteo_alcance(p_criterios) a
    left join public.fn_conteo_ultimos() u on u.producto_id = a.producto_id
   order by a.orden;
end;
$$;

revoke execute on function public.fn_conteo_pendientes(jsonb, integer) from public, anon;
grant execute on function public.fn_conteo_pendientes(jsonb, integer) to authenticated;

-- Verificación (tiene que dar true):
-- select to_regprocedure('public.fn_conteo_pendientes(jsonb,integer)') is not null;
-- Chequeo T1 (0 filas):
-- select proname, count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and proname like 'fn_%' group by proname having count(*) > 1;

notify pgrst, 'reload schema';
