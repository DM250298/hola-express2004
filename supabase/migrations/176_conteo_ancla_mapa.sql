-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 176 · El conteo físico carga el mapa (Fase B2)           ║
-- ║                                                                     ║
-- ║  Dos reissues sobre la base ÍNTEGRA de la mig 098:                  ║
-- ║                                                                     ║
-- ║  1. fn_abrir_sesion_conteo v2: cada zona del wizard puede venir     ║
-- ║     anclada a un nodo del árbol físico (p_zonas[].ubicacion_id,     ║
-- ║     opcional — mig 175). Misma firma → create or replace limpio.    ║
-- ║                                                                     ║
-- ║  2. fn_cerrar_zona v2: si la zona está anclada, al cerrarla los     ║
-- ║     productos contados (cantidad > 0) se asignan a esa ubicación    ║
-- ║     en producto_ubicacion: como PRINCIPAL si el producto no tenía   ║
-- ║     ninguna, como secundaria si ya tenía (no se pisan asignaciones  ║
-- ║     hechas a mano). El mapeo es BEST-EFFORT: un error ahí nunca     ║
-- ║     tumba el cierre de la zona (patrón fn_auditar de la 098).       ║
-- ║                                                                     ║
-- ║  Así, el conteo — trabajo que el equipo ya hace — puebla el mapa    ║
-- ║  del local sin ninguna carga extra.                                 ║
-- ║                                                                     ║
-- ║  Correr el chequeo T1 después (0 duplicados).                       ║
-- ║  types/database.ts: sin cambios de firma (el payload de zonas es    ║
-- ║  jsonb). REQUIERE: migs 098, 170 y 175.                             ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. fn_abrir_sesion_conteo v2 · base 098 ÍNTEGRA + ancla opcional.
--    p_zonas: [{ "nombre": "Góndola 1", "responsable_user_id": "<uuid>|null",
--                "orden": 0, "ubicacion_id": 12|null }, ...]
--    Cambios marcados con "v2".
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_abrir_sesion_conteo(
  p_nombre text,
  p_umbral numeric default 5000,
  p_zonas jsonb default '[]'::jsonb,
  p_notas text default null
) returns public.conteo_sesiones
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sesion public.conteo_sesiones;
  v_zona jsonb;
  v_resp uuid;
  v_orden integer := 0;
  v_productos integer;
  v_ts timestamptz;
  v_ubic integer;  -- v2
begin
  if v_uid is null then
    raise exception 'No se pudo identificar al usuario.';
  end if;
  if not public.fn_tiene_permiso('conteo_cierre') then
    raise exception 'No tenés permiso para abrir sesiones de conteo.';
  end if;
  if p_nombre is null or btrim(p_nombre) = '' then
    raise exception 'Poné un nombre a la sesión (ej. "Inventario Julio 2026").';
  end if;
  if p_zonas is null or jsonb_array_length(p_zonas) = 0 then
    raise exception 'Definí al menos una zona para contar.';
  end if;
  if exists (select 1 from public.conteo_sesiones where estado <> 'cerrada') then
    raise exception 'Ya hay una sesión de conteo en curso. Cerrala antes de abrir otra.';
  end if;

  -- El índice único parcial es la garantía real contra aperturas concurrentes;
  -- acá se traduce el duplicate_key a un mensaje entendible.
  begin
    insert into public.conteo_sesiones (nombre, estado, abierta_por, umbral_pesos, notas)
    values (btrim(p_nombre), 'abierta', v_uid, coalesce(p_umbral, 5000), p_notas)
    returning * into v_sesion;
  exception when unique_violation then
    raise exception 'Ya hay una sesión de conteo en curso. Cerrala antes de abrir otra.';
  end;

  -- Snapshot del teórico: todos los productos activos con control de stock.
  -- ts_apertura se fija con clock_timestamp() inmediatamente antes del INSERT
  -- para que el inicio de la ventana de compensación coincida con el snapshot
  -- MVCC de este statement (now() sería el inicio de la transacción y ventas
  -- commiteadas en el medio se compensarían doble). Limitación residual
  -- documentada: una venta EN VUELO (sin commitear) en este instante exacto
  -- queda fuera del snapshot y de la ventana → puede aparecer como faltante
  -- fantasma. Abrir la sesión en un momento tranquilo de caja.
  v_ts := clock_timestamp();
  insert into public.conteo_snapshot (sesion_id, producto_id, stock_teorico, ts_snapshot)
  select v_sesion.id, p.id, coalesce(p.stock_actual, 0), v_ts
    from public.productos p
   where p.activo and coalesce(p.controlar_stock, true);
  get diagnostics v_productos = row_count;

  update public.conteo_sesiones set ts_apertura = v_ts where id = v_sesion.id;
  v_sesion.ts_apertura := v_ts;

  for v_zona in select * from jsonb_array_elements(p_zonas) loop
    if v_zona->>'nombre' is null or btrim(v_zona->>'nombre') = '' then
      raise exception 'Todas las zonas necesitan un nombre.';
    end if;
    v_resp := nullif(v_zona->>'responsable_user_id', '')::uuid;
    if v_resp is not null
       and not exists (select 1 from public.usuarios where id = v_resp and activo) then
      raise exception 'El responsable de la zona "%" no es un usuario activo.', v_zona->>'nombre';
    end if;
    -- v2: ancla opcional al árbol físico (mig 170/175).
    v_ubic := nullif(v_zona->>'ubicacion_id', '')::integer;
    if v_ubic is not null
       and not exists (select 1 from public.ubicaciones u where u.id = v_ubic and u.activo) then
      raise exception 'La ubicación anclada a la zona "%" no existe o está inactiva.', v_zona->>'nombre';
    end if;
    insert into public.conteo_zonas (sesion_id, nombre, responsable_user_id, orden, ubicacion_id)
    values (v_sesion.id, btrim(v_zona->>'nombre'), v_resp,
            coalesce(nullif(v_zona->>'orden', '')::integer, v_orden), v_ubic);
    v_orden := v_orden + 1;
  end loop;

  -- Auditoría best-effort: si fn_auditar no está en esta base (o cambió de
  -- firma), no debe tumbar la apertura del conteo.
  begin
    perform public.fn_auditar(v_uid, 'abrir_conteo_sesion', 'conteo_sesion', v_sesion.id,
      jsonb_build_object('nombre', v_sesion.nombre, 'zonas', jsonb_array_length(p_zonas),
                         'productos_snapshot', v_productos));
  exception when others then null; end;
  return v_sesion;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. fn_cerrar_zona v2 · base 098 ÍNTEGRA + mapeo best-effort.
--    Cambios marcados con "v2".
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_cerrar_zona(p_zona_id integer)
returns public.conteo_zonas
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_zona public.conteo_zonas;
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

  -- ── v2 · Mapeo best-effort: la zona anclada asigna sus productos
  -- contados a la ubicación. Regla: PRINCIPAL solo si el producto no
  -- tenía ninguna (no se pisan asignaciones a mano); si ya tenía, queda
  -- como secundaria. Cualquier error acá NO tumba el cierre de la zona. ──
  if v_zona.ubicacion_id is not null then
    begin
      -- 1) Asegura la fila producto↔ubicación (como secundaria, inocuo).
      insert into public.producto_ubicacion (producto_id, ubicacion_id, es_principal)
      select d.producto_id, v_zona.ubicacion_id, false
      from (
        select distinct producto_id
        from public.conteo_detalle
        where zona_id = p_zona_id and cantidad_contada > 0
      ) d
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

-- Reload PostgREST schema cache.
notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- Verificación post-migración:
--
-- 1. Chequeo T1 (0 filas):
--    select proname, count(*) from pg_proc p
--    join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and proname like 'fn_%'
--    group by proname having count(*) > 1;
--
-- 2. Smoke: abrir una sesión con una zona anclada a una góndola del mapa,
--    contar 2-3 productos en esa zona, cerrarla, y verificar:
--    select * from public.producto_ubicacion
--    where ubicacion_id = <id de la góndola> order by id desc limit 5;
-- ─────────────────────────────────────────────────────────────────────
