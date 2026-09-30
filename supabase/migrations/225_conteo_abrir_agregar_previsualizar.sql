-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 225 · Conteo físico: tareas con alcance (4/7)           ║
-- ║                                                                    ║
-- ║  1. fn_abrir_sesion_conteo v3 (base 176 ÍNTEGRA): delega las zonas ║
-- ║     en fn_conteo_crear_tareas (mig 224). Misma firma → create or   ║
-- ║     replace. El payload viejo ({nombre, responsable_user_id,       ║
-- ║     ubicacion_id}) sigue funcionando.                              ║
-- ║  2. fn_agregar_tareas_conteo: sumar tareas a la sesión ABIERTA sin ║
-- ║     cerrarla (mandar a contar otra cosa en el mismo inventario).   ║
-- ║  3. fn_conteo_previsualizar_tareas: cuántos productos le tocan a   ║
-- ║     cada tarea ANTES de crearla. Corre el armado de verdad y lo    ║
-- ║     deshace, así el número de la vista previa es exactamente el    ║
-- ║     que se va a crear. No deja nada guardado.                      ║
-- ║                                                                    ║
-- ║  REQUIERE: migs 222 a 224. Correr el chequeo T1 después.           ║
-- ║  Ejecutar UNA sola vez, COMPLETO. Primero PRUEBA, después          ║
-- ║  PRODUCCIÓN (HEX-V1).                                              ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. fn_abrir_sesion_conteo v3 · base 176 íntegra; el loop de zonas pasa
--    a fn_conteo_crear_tareas. Cambios marcados con "v3".
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
  v_productos integer;
  v_ts timestamptz;
  v_tareas jsonb;  -- v3
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
  if p_zonas is null or jsonb_typeof(p_zonas) <> 'array'
     or jsonb_array_length(p_zonas) = 0 then
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

  -- Snapshot del teórico: todos los productos activos con control de stock,
  -- aunque la sesión cuente solo una parte (lo no contado no se ajusta).
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

  -- v3: las tareas (con o sin alcance) las arma la función compartida.
  v_tareas := public.fn_conteo_crear_tareas(v_sesion.id, p_zonas, true);

  -- Auditoría best-effort: si fn_auditar no está en esta base (o cambió de
  -- firma), no debe tumbar la apertura del conteo.
  begin
    perform public.fn_auditar(v_uid, 'abrir_conteo_sesion', 'conteo_sesion', v_sesion.id,
      jsonb_build_object('nombre', v_sesion.nombre, 'zonas', jsonb_array_length(p_zonas),
                         'productos_snapshot', v_productos, 'tareas', v_tareas));
  exception when others then null; end;
  return v_sesion;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. fn_agregar_tareas_conteo · sumar tareas a la sesión abierta.
--    Devuelve lo mismo que fn_conteo_crear_tareas (un renglón por tarea).
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_agregar_tareas_conteo(integer, jsonb);

create function public.fn_agregar_tareas_conteo(p_sesion_id integer, p_zonas jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sesion public.conteo_sesiones;
  v_tareas jsonb;
begin
  if v_uid is null then
    raise exception 'No se pudo identificar al usuario.';
  end if;
  if not public.fn_tiene_permiso('conteo_cierre') then
    raise exception 'No tenés permiso para gestionar sesiones de conteo.';
  end if;
  if p_zonas is null or jsonb_typeof(p_zonas) <> 'array'
     or jsonb_array_length(p_zonas) = 0 then
    raise exception 'No hay tareas para agregar.';
  end if;
  -- FOR UPDATE: no se suman tareas en el medio de un pase a revisión, y los
  -- conteos en vuelo (FOR SHARE) terminan antes de calcular qué está tomado.
  select * into v_sesion from public.conteo_sesiones
   where id = p_sesion_id for update;
  if v_sesion.id is null then
    raise exception 'La sesión de conteo no existe.';
  end if;
  if v_sesion.estado <> 'abierta' then
    raise exception 'Solo se pueden agregar tareas con la sesión abierta.';
  end if;

  v_tareas := public.fn_conteo_crear_tareas(p_sesion_id, p_zonas, true);

  begin
    perform public.fn_auditar(v_uid, 'agregar_tareas_conteo', 'conteo_sesion', p_sesion_id,
      jsonb_build_object('tareas', v_tareas));
  exception when others then null; end;
  return v_tareas;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. fn_conteo_previsualizar_tareas
--    Con una sesión abierta calcula contra ella (lo que ya está tomado no
--    entra). Sin sesión, simula la apertura. Todo lo que escribe queda
--    adentro de un bloque que termina SIEMPRE en error propio: Postgres lo
--    deshace entero y solo sobrevive el resultado en la variable.
--    Devuelve { "tareas": [...], "fecha_abc": "2026-09-28" | null }.
--    fecha_abc = día del snapshot del que sale la clase ABC, para avisar
--    si está viejo o si todavía no hay ninguno.
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_conteo_previsualizar_tareas(jsonb);

create function public.fn_conteo_previsualizar_tareas(p_zonas jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sesion_id integer;
  v_estado text;
  v_tareas jsonb := '[]'::jsonb;
  v_fecha date;
begin
  if v_uid is null then
    raise exception 'No se pudo identificar al usuario.';
  end if;
  if not public.fn_tiene_permiso('conteo_cierre') then
    raise exception 'No tenés permiso para armar tareas de conteo.';
  end if;
  select max(m.fecha) into v_fecha from public.metricas_sku_diarias m;
  if p_zonas is null or jsonb_typeof(p_zonas) <> 'array'
     or jsonb_array_length(p_zonas) = 0 then
    return jsonb_build_object('tareas', v_tareas, 'fecha_abc', v_fecha);
  end if;

  select s.id, s.estado into v_sesion_id, v_estado
    from public.conteo_sesiones s where s.estado <> 'cerrada' limit 1;
  if v_estado = 'en_revision' then
    raise exception 'La sesión está en revisión: volvé a abrirla para sumar tareas.';
  end if;

  begin
    if v_sesion_id is null then
      insert into public.conteo_sesiones (nombre, estado, abierta_por)
      values ('(vista previa)', 'abierta', v_uid)
      returning id into v_sesion_id;
      insert into public.conteo_snapshot (sesion_id, producto_id, stock_teorico)
      select v_sesion_id, p.id, 0
        from public.productos p
       where p.activo and coalesce(p.controlar_stock, true);
    end if;
    v_tareas := public.fn_conteo_crear_tareas(v_sesion_id, p_zonas, false);
    raise exception using errcode = 'CTVP0', message = 'vista previa';
  exception when sqlstate 'CTVP0' then
    null;
  end;

  return jsonb_build_object('tareas', v_tareas, 'fecha_abc', v_fecha);
end;
$$;

revoke execute on function public.fn_agregar_tareas_conteo(integer, jsonb) from public, anon;
grant execute on function public.fn_agregar_tareas_conteo(integer, jsonb) to authenticated;
revoke execute on function public.fn_conteo_previsualizar_tareas(jsonb) from public, anon;
grant execute on function public.fn_conteo_previsualizar_tareas(jsonb) to authenticated;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- Verificación (las dos columnas deben dar true) + chequeo T1 (0 filas):
--   select proname, count(*) from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and proname like 'fn_%'
--   group by proname having count(*) > 1;
-- ─────────────────────────────────────────────────────────────────────
select
  to_regprocedure('public.fn_agregar_tareas_conteo(integer,jsonb)') is not null as agregar_tareas,
  to_regprocedure('public.fn_conteo_previsualizar_tareas(jsonb)') is not null as vista_previa;
