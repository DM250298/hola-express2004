-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 218 · Identidad de sesión en turnos de caja y ventas     ║
-- ║                                                                     ║
-- ║  Problema (2026-09-24): ventas a nombre de otro usuario y turnos    ║
-- ║  que "se abren y cierran solos". Causa: el POS decide quién vende  ║
-- ║  (usuario horneado en el SSR) y la base lo aceptaba sin comparar   ║
-- ║  con auth.uid(); caja_turnos/ventas con RLS using(true); sin       ║
-- ║  índice único de turno abierto; cola offline que se reenvía con    ║
-- ║  la hora del reenvío; cierre calculado en el cliente (RLS deja     ║
-- ║  gastos/sangrías/fiado en 0 si no cierra el dueño).                ║
-- ║                                                                     ║
-- ║  Regla nueva: LA IDENTIDAD LA PONE LA SESIÓN Y LA BASE LA EXIGE.   ║
-- ║  Se controla solo cuando el JWT trae role 'authenticated';         ║
-- ║  service_role (webhook/conciliación MP) y NULL (SQL Editor,        ║
-- ║  clonado a prueba, tests) confían en lo que reciben.               ║
-- ║                                                                     ║
-- ║  1. caja_turnos.cerrado_por + un solo turno abierto por usuario    ║
-- ║     (cierra duplicados y crea índice único parcial).               ║
-- ║  2. Trigger de identidad en ventas/egresos/sangrias/devoluciones/  ║
-- ║     cuenta_corriente_* (usuario_id = auth.uid(), turno propio).    ║
-- ║  3. RPCs fn_abrir_turno / fn_resumen_turno / fn_cerrar_turno       ║
-- ║     (cierre atómico en el servidor, dueño o Finanzas).             ║
-- ║  4. fn_crear_venta v14: identidad, turno propio, p_fecha (cola     ║
-- ║     offline conserva la hora real), imputación tardía a turno      ║
-- ║     cerrado con recálculo del esperado, vuelto NO se guarda como   ║
-- ║     efectivo (pagos_venta = lo imputado).                          ║
-- ║  5. fn_registrar_venta_cobro_terminal pasa la hora del intento.    ║
-- ║  6. RLS de caja_turnos/ventas/items_venta/pagos_venta: SOLO        ║
-- ║     SELECT para authenticated; toda escritura va por RPC definer.  ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ║  Primero en PRUEBA, después en PRODUCCIÓN. Después: chequeo T1.     ║
-- ║  Rollback de la §4: reejecutar la §2 de la 171 (v13) tras dropear  ║
-- ║  la firma de 8 argumentos.                                          ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 0. Helpers de identidad
-- ─────────────────────────────────────────────────────────────────────

-- Role del JWT de la request ('authenticated' | 'anon' | 'service_role' | '').
-- Vacío = sin JWT (SQL Editor, psql, pg_cron): se confía.
create or replace function public.fn_rol_jwt() returns text
language sql stable set search_path = public as $$
  select coalesce(auth.jwt() ->> 'role', '')
$$;
grant execute on function public.fn_rol_jwt() to authenticated, anon, service_role;

-- Usuario efectivo de una operación: con sesión de usuario manda auth.uid();
-- desde el servidor o sin JWT se respeta el id recibido. Para que las RPCs
-- que hoy reciben p_usuario_id lo adopten de a poco.
create or replace function public.fn_usuario_efectivo(p_usuario_id uuid) returns uuid
language sql stable set search_path = public as $$
  select case when public.fn_rol_jwt() = 'authenticated' then auth.uid() else p_usuario_id end
$$;
grant execute on function public.fn_usuario_efectivo(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 1. caja_turnos: quién cerró + un solo turno abierto por usuario
-- ─────────────────────────────────────────────────────────────────────
alter table public.caja_turnos
  add column if not exists cerrado_por uuid references public.usuarios(id);
comment on column public.caja_turnos.cerrado_por is
  'auth.uid() de quien cerró el turno (dueño o Finanzas). NULL en cierres previos a la 218.';

-- Duplicados históricos: por usuario con más de un turno abierto se conserva
-- el que tiene la venta más reciente (la pestaña vieja pudo seguir vendiendo
-- en el turno viejo) y los demás se cierran con nota. Sin monto contado ni
-- diferencia: ese efectivo nunca pasó por arqueo, queda dicho en novedades.
do $$
declare
  r record;
  v_keep integer;
  v_cerrados text;
begin
  for r in
    select usuario_id from public.caja_turnos
    where estado = 'abierto' group by usuario_id having count(*) > 1
  loop
    select t.id into v_keep
      from public.caja_turnos t
      left join lateral (
        select max(v.fecha) as ultima from public.ventas v where v.turno_id = t.id
      ) uv on true
      where t.usuario_id = r.usuario_id and t.estado = 'abierto'
      order by uv.ultima desc nulls last, t.fecha_apertura desc
      limit 1;

    select string_agg(
             '#' || t.id || ' (abierto ' || to_char(t.fecha_apertura, 'DD/MM HH24:MI')
             || ', ventas $' || coalesce((
                  select round(sum(v.total), 2) from public.ventas v
                  where v.turno_id = t.id and v.estado = 'completada'), 0) || ')',
             ', ' order by t.id)
      into v_cerrados
      from public.caja_turnos t
      where t.usuario_id = r.usuario_id and t.estado = 'abierto' and t.id <> v_keep;

    update public.caja_turnos
      set estado = 'cerrado'::public.estado_turno,
          fecha_cierre = now(),
          novedades = concat_ws(' · ', novedades,
            'Cierre automático (mig 218): turno duplicado; sigue abierto el #' || v_keep
            || '. Cerrados: ' || v_cerrados || '. Este efectivo no pasó por arqueo.')
      where usuario_id = r.usuario_id and estado = 'abierto' and id <> v_keep;

    raise notice 'mig 218: usuario % tenía turnos duplicados; queda abierto el #% (cerrados: %)',
      r.usuario_id, v_keep, v_cerrados;
  end loop;
end $$;

create unique index if not exists caja_turnos_un_abierto_por_usuario
  on public.caja_turnos (usuario_id) where estado = 'abierto';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Trigger de identidad (defensa en profundidad)
--    Con sesión de usuario: usuario_id de la fila = auth.uid() y, si trae
--    turno_id, el turno es del usuario. Finanzas (admin incluido) puede
--    operar sobre turnos ajenos (cierre administrativo, replay de la cola
--    offline de otro cajero). Errores con prefijo para que el POS los
--    reconozca y recargue la pantalla.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_trg_control_identidad() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid;
  v_finanzas boolean;
begin
  if public.fn_rol_jwt() <> 'authenticated' then
    return new;
  end if;
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'SESION_CAMBIO: la sesión no es válida. Volvé a iniciar sesión.';
  end if;
  v_finanzas := coalesce((select public.fn_tiene_permiso('finanzas')), false);

  if new.usuario_id is null then
    new.usuario_id := v_uid;
  elsif new.usuario_id <> v_uid and not v_finanzas then
    raise exception 'SESION_CAMBIO: esta pantalla quedó con la sesión de otro usuario. Recargá la página e ingresá con tu usuario.';
  end if;

  if new.turno_id is not null and not v_finanzas and not exists (
    select 1 from public.caja_turnos t where t.id = new.turno_id and t.usuario_id = v_uid
  ) then
    raise exception 'TURNO_AJENO: el turno de caja #% no es tuyo. Recargá la página.', new.turno_id;
  end if;

  return new;
end $$;

drop trigger if exists trg_control_identidad on public.ventas;
create trigger trg_control_identidad before insert on public.ventas
  for each row execute function public.fn_trg_control_identidad();

drop trigger if exists trg_control_identidad on public.egresos;
create trigger trg_control_identidad before insert on public.egresos
  for each row execute function public.fn_trg_control_identidad();

drop trigger if exists trg_control_identidad on public.sangrias;
create trigger trg_control_identidad before insert on public.sangrias
  for each row execute function public.fn_trg_control_identidad();

drop trigger if exists trg_control_identidad on public.devoluciones;
create trigger trg_control_identidad before insert on public.devoluciones
  for each row execute function public.fn_trg_control_identidad();

-- Cuenta corriente: solo las filas de caja (fiado en la venta y cobros en el
-- mostrador). Los movimientos de tesorería/RRHH no traen turno_id.
drop trigger if exists trg_control_identidad on public.cuenta_corriente_cliente;
create trigger trg_control_identidad before insert on public.cuenta_corriente_cliente
  for each row when (new.turno_id is not null)
  execute function public.fn_trg_control_identidad();

drop trigger if exists trg_control_identidad on public.cuenta_corriente_empleado;
create trigger trg_control_identidad before insert on public.cuenta_corriente_empleado
  for each row when (new.turno_id is not null)
  execute function public.fn_trg_control_identidad();

-- ─────────────────────────────────────────────────────────────────────
-- 3. Turnos: abrir, resumir y cerrar en el servidor
-- ─────────────────────────────────────────────────────────────────────

-- Totales de caja de un turno. Uso interno (la llaman las definer de abajo,
-- que ya autorizaron): sin execute para los roles de la API.
create or replace function public.fn_totales_turno(p_turno_id integer)
returns table (efectivo numeric, cobros_fiado numeric, gastos numeric, sangrias numeric)
language sql stable security definer set search_path = public as $$
  select
    coalesce((
      select sum(pv.monto) from public.pagos_venta pv
      join public.ventas v on v.id = pv.venta_id
      where v.turno_id = p_turno_id and v.estado = 'completada' and pv.medio_pago = 'efectivo'
    ), 0),
    -- Cobros de fiado en efectivo en el mostrador (mismo criterio que
    -- fn_cobros_fiado_turno de la 141, sin su gate de permisos).
    coalesce((
      select -sum(monto) from (
        select monto from public.cuenta_corriente_cliente
          where turno_id = p_turno_id and monto < 0
        union all
        select monto from public.cuenta_corriente_empleado
          where turno_id = p_turno_id and monto < 0
      ) s
    ), 0),
    coalesce((select sum(monto) from public.egresos where turno_id = p_turno_id), 0),
    coalesce((select sum(monto) from public.sangrias where turno_id = p_turno_id), 0)
$$;
revoke all on function public.fn_totales_turno(integer) from public, anon, authenticated;

-- Abrir turno: la identidad es auth.uid(). Idempotente: si el usuario ya
-- tiene un turno abierto, lo devuelve (no crea otro). El índice único de la
-- §1 cubre la carrera entre dos pestañas.
create or replace function public.fn_abrir_turno(p_monto_apertura numeric)
returns public.caja_turnos
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_turno public.caja_turnos;
begin
  if v_uid is null then
    raise exception 'SESION_CAMBIO: la sesión no es válida. Volvé a iniciar sesión.';
  end if;
  if p_monto_apertura is null or p_monto_apertura < 0 or p_monto_apertura > 99999999 then
    raise exception 'Monto de apertura inválido.';
  end if;
  if not exists (select 1 from public.usuarios where id = v_uid and coalesce(activo, true)) then
    raise exception 'El usuario no está activo.';
  end if;

  select * into v_turno from public.caja_turnos
    where usuario_id = v_uid and estado = 'abierto'
    order by fecha_apertura desc limit 1;
  if found then
    return v_turno;
  end if;

  begin
    insert into public.caja_turnos (usuario_id, monto_apertura, estado)
    values (v_uid, round(p_monto_apertura, 2), 'abierto'::public.estado_turno)
    returning * into v_turno;
  exception when unique_violation then
    select * into v_turno from public.caja_turnos
      where usuario_id = v_uid and estado = 'abierto' limit 1;
  end;
  return v_turno;
end $$;
revoke all on function public.fn_abrir_turno(numeric) from public, anon;
grant execute on function public.fn_abrir_turno(numeric) to authenticated;

-- Resumen del turno para la vista previa del cierre (y el comprobante).
-- Dueño del turno o Finanzas. Reemplaza las 5 consultas del cliente: sin
-- tope de 1000 filas ni ceros por RLS.
create or replace function public.fn_resumen_turno(p_turno_id integer)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_turno public.caja_turnos;
  v_tot record;
  v_cant integer;
  v_total numeric;
  v_por_medio jsonb;
  v_productos jsonb;
  v_nombre text;
begin
  select * into v_turno from public.caja_turnos where id = p_turno_id;
  if not found then
    raise exception 'El turno #% no existe.', p_turno_id;
  end if;
  if public.fn_rol_jwt() = 'authenticated'
     and (v_uid is null or v_turno.usuario_id <> v_uid)
     and not coalesce((select public.fn_tiene_permiso('finanzas')), false) then
    raise exception 'TURNO_AJENO: solo el dueño del turno o Finanzas pueden ver el resumen.';
  end if;

  select count(*), coalesce(sum(total), 0) into v_cant, v_total
    from public.ventas where turno_id = p_turno_id and estado = 'completada';

  select coalesce(jsonb_agg(
           jsonb_build_object('codigo', m.medio, 'total', m.total, 'cantidad', m.cantidad)
           order by m.total desc), '[]'::jsonb)
    into v_por_medio
    from (
      select pv.medio_pago::text as medio, sum(pv.monto) as total, count(*) as cantidad
      from public.pagos_venta pv
      join public.ventas v on v.id = pv.venta_id
      where v.turno_id = p_turno_id and v.estado = 'completada'
      group by pv.medio_pago
    ) m;

  select coalesce(jsonb_agg(
           jsonb_build_object('nombre', x.nombre, 'cantidad', x.cantidad, 'unidad', x.unidad)
           order by x.nombre), '[]'::jsonb)
    into v_productos
    from (
      select p.nombre, sum(iv.cantidad) as cantidad, p.unidad
      from public.items_venta iv
      join public.ventas v on v.id = iv.venta_id
      join public.productos p on p.id = iv.producto_id
      where v.turno_id = p_turno_id and v.estado = 'completada'
      group by p.nombre, p.unidad
    ) x;

  select * into v_tot from public.fn_totales_turno(p_turno_id);
  select nombre into v_nombre from public.usuarios where id = v_turno.usuario_id;

  return jsonb_build_object(
    'turno_id', p_turno_id,
    'usuario_id', v_turno.usuario_id,
    'cajero_nombre', v_nombre,
    'estado', v_turno.estado,
    'fecha_apertura', v_turno.fecha_apertura,
    'fecha_cierre', v_turno.fecha_cierre,
    'monto_apertura', v_turno.monto_apertura,
    'cantidad_ventas', v_cant,
    'total_ventas', v_total,
    'por_medio', v_por_medio,
    'productos', v_productos,
    'total_ventas_efectivo', v_tot.efectivo,
    'cobros_fiado', v_tot.cobros_fiado,
    'gastos', v_tot.gastos,
    'sangrias', v_tot.sangrias,
    'monto_esperado', v_turno.monto_apertura + v_tot.efectivo + v_tot.cobros_fiado
                      - v_tot.gastos - v_tot.sangrias
  );
end $$;
revoke all on function public.fn_resumen_turno(integer) from public, anon;
grant execute on function public.fn_resumen_turno(integer) to authenticated;

-- Cerrar turno: una sola transacción. Solo un turno ABIERTO (re-cerrar ya no
-- pisa montos), dueño o Finanzas (cierre administrativo de turnos
-- abandonados), esperado calculado acá con la misma fórmula de siempre
-- (apertura + efectivo + fiado − gastos − sangrías), cerrado_por = auth.uid()
-- y la sangría automática del efectivo contado (al buzón) en la misma
-- transacción — antes era un insert aparte del cliente que fallaba por RLS
-- si la sesión no era la del dueño.
create or replace function public.fn_cerrar_turno(
  p_turno_id integer, p_monto_cierre_real numeric, p_novedades text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_rol text := public.fn_rol_jwt();
  v_turno public.caja_turnos;
  v_tot record;
  v_esperado numeric;
  v_dif numeric;
  v_nombre text;
  v_sangria_id integer;
begin
  if v_rol = 'authenticated' and v_uid is null then
    raise exception 'SESION_CAMBIO: la sesión no es válida. Volvé a iniciar sesión.';
  end if;
  if p_monto_cierre_real is null or p_monto_cierre_real < 0 or p_monto_cierre_real > 99999999 then
    raise exception 'Monto contado inválido.';
  end if;

  select * into v_turno from public.caja_turnos where id = p_turno_id for update;
  if not found then
    raise exception 'El turno #% no existe.', p_turno_id;
  end if;
  if v_turno.estado <> 'abierto' then
    raise exception 'El turno #% ya está cerrado.', p_turno_id;
  end if;
  if v_rol = 'authenticated' and v_turno.usuario_id <> v_uid
     and not coalesce((select public.fn_tiene_permiso('finanzas')), false) then
    raise exception 'TURNO_AJENO: solo el dueño del turno o Finanzas pueden cerrarlo.';
  end if;

  select * into v_tot from public.fn_totales_turno(p_turno_id);
  v_esperado := round(v_turno.monto_apertura + v_tot.efectivo + v_tot.cobros_fiado
                      - v_tot.gastos - v_tot.sangrias, 2);
  v_dif := round(p_monto_cierre_real - v_esperado, 2);

  update public.caja_turnos
    set fecha_cierre = now(),
        monto_cierre_real = round(p_monto_cierre_real, 2),
        monto_cierre_esperado = v_esperado,
        diferencia = v_dif,
        estado = 'cerrado'::public.estado_turno,
        novedades = concat_ws(' · ', nullif(btrim(p_novedades), ''), v_turno.novedades),
        cerrado_por = v_uid
    where id = p_turno_id
    returning * into v_turno;

  -- El efectivo contado va al buzón de la caja fuerte para el arqueo.
  if p_monto_cierre_real > 0 then
    insert into public.sangrias (turno_id, usuario_id, monto, nota, estado)
    values (p_turno_id, coalesce(v_uid, v_turno.usuario_id), round(p_monto_cierre_real, 2),
            'Cierre de turno #' || p_turno_id, 'en_buzon')
    returning id into v_sangria_id;
  end if;

  select nombre into v_nombre from public.usuarios where id = v_turno.usuario_id;

  return jsonb_build_object(
    'turno', to_jsonb(v_turno),
    'cajero_nombre', v_nombre,
    'monto_esperado', v_esperado,
    'diferencia', v_dif,
    'total_ventas_efectivo', v_tot.efectivo,
    'total_cobros_fiado', v_tot.cobros_fiado,
    'gastos', v_tot.gastos,
    'sangrias', v_tot.sangrias,
    'sangria_id', v_sangria_id
  );
end $$;
revoke all on function public.fn_cerrar_turno(integer, numeric, text) from public, anon;
grant execute on function public.fn_cerrar_turno(integer, numeric, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 4. fn_crear_venta v14 · v13 (mig 171) ÍNTEGRA + identidad + p_fecha +
--    imputación tardía + vuelto. Cambios marcados con "v14".
--    Firma nueva (8 args): se dropea la de 7 para no dejar una sobrecarga.
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_crear_venta(integer, uuid, jsonb, jsonb, uuid, integer, boolean);

create or replace function public.fn_crear_venta(
  p_turno_id integer, p_usuario_id uuid, p_pagos jsonb, p_items jsonb,
  p_cliente_uuid uuid default null, p_cliente_id integer default null,
  p_forzar_turno boolean default false,
  p_fecha timestamptz default null
) returns public.ventas
language plpgsql security definer set search_path = public
as $$
declare
  v_total numeric := 0; v_medio_principal text; v_venta public.ventas;
  v_hoy date := current_date; v_ahora timestamptz := now();
  v_pago jsonb; v_item jsonb; v_medio text; v_monto numeric;
  v_cuenta_id integer; v_comision numeric; v_comision_monto numeric;
  v_comision_override numeric; v_iibb_override numeric;
  v_iibb_pct numeric; v_iibb_monto numeric; v_dias_acred integer;
  v_desc_comision text; v_desc_iibb text;
  v_pago_venta_id integer; v_saldo numeric; v_saldo_nuevo numeric;
  v_nc record; v_nc_codigo text;
  v_prod_id integer; v_cantidad numeric; v_precio numeric;
  v_stock_ant numeric; v_stock_nuevo numeric; v_lote record;
  v_restante numeric; v_usar numeric; v_costo_unit numeric;
  v_controlar boolean;
  v_comp record; v_cant_comp numeric; v_nombre_combo text;
  v_total_costo numeric := 0; v_pagos_no_efec numeric := 0;
  v_neto numeric; v_iva numeric; v_efectivo numeric; v_no_efec numeric;
  v_asiento_id integer; v_orden integer := 0;
  v_cta_ventas integer; v_cta_iva integer; v_cta_caja integer;
  v_cta_banco integer; v_cta_cmv integer; v_cta_merc integer;
  -- v10: fiado (cuenta corriente)
  v_pagos_ctacte numeric := 0; v_ctacte numeric;
  v_deudor_tipo text; v_deudor_id integer;
  v_deudor_nombre text; v_deudor_activo boolean;
  v_limite numeric; v_saldo_deuda numeric;
  v_cta_deudores integer; v_cc_cliente_id integer;
  v_cc_ya_fiado boolean := false;
  -- v11: lista de precios de la venta y del ítem
  v_lista_venta text := 'minorista';
  v_item_lista text;
  -- v12: IVA débito solo sobre lo cobrado con medios que lo generan
  v_pagos_gravados numeric := 0;
  v_base_gravada numeric := 0;
  v_factor_iva numeric;
  -- v13: costo congelado por ítem (satélite costos_item_venta)
  v_item_id integer;
  v_costo_combo numeric;
  -- v14: identidad, turno, fecha real y vuelto
  v_uid uuid := auth.uid();
  v_rol text := public.fn_rol_jwt();
  v_finanzas boolean := false;
  v_turno public.caja_turnos;
  v_tardia boolean := false;
  v_pagos jsonb;
  v_suma_pagos numeric := 0;
  v_exceso numeric := 0;
  v_quitar numeric;
  v_efectivo_imputado numeric := 0;
begin
  if p_cliente_uuid is not null then
    select * into v_venta from public.ventas where cliente_uuid = p_cliente_uuid;
    if found then return v_venta; end if;
  end if;
  if p_pagos is null or jsonb_array_length(p_pagos) = 0 then
    raise exception 'La venta debe tener al menos un pago.';
  end if;

  -- ── v14 · IDENTIDAD ──────────────────────────────────────────────────
  -- Con sesión de usuario manda auth.uid(): el POS ya no decide quién vende.
  -- Finanzas puede reenviar la cola offline de otro cajero (replay con
  -- p_fecha). service_role (webhook/conciliación) y sin JWT confían en los
  -- parámetros. p_forzar_turno sigue reservado al servidor (idiom mig 088).
  if v_rol = 'authenticated' then
    if v_uid is null then
      raise exception 'SESION_CAMBIO: la sesión no es válida. Volvé a iniciar sesión.';
    end if;
    if p_forzar_turno then
      raise exception 'p_forzar_turno está reservado al servidor (service_role).';
    end if;
    v_finanzas := coalesce((select public.fn_tiene_permiso('finanzas')), false);
    if p_usuario_id is distinct from v_uid and not (v_finanzas and p_fecha is not null) then
      raise exception 'SESION_CAMBIO: esta pantalla quedó con la sesión de otro usuario. Recargá la página e ingresá con tu usuario.';
    end if;
  end if;

  -- ── v14 · TURNO: existe, es del vendedor y está abierto ──────────────
  -- FOR UPDATE: una venta y el cierre del mismo turno no se cruzan.
  -- Turno cerrado: lo acepta el webhook (p_forzar_turno, decisión 128) y una
  -- venta offline sincronizada tarde cuya hora real cae dentro del turno.
  -- En ambos casos el efectivo ya estaba en el cajón al contar: se recalcula
  -- el esperado del cierre (más abajo) en vez de perder la venta.
  select * into v_turno from public.caja_turnos where id = p_turno_id for update;
  if not found then
    raise exception 'El turno de caja #% no existe.', p_turno_id;
  end if;
  if v_rol = 'authenticated' and v_turno.usuario_id <> v_uid and not v_finanzas then
    raise exception 'TURNO_AJENO: el turno de caja #% no es tuyo. Recargá la página.', p_turno_id;
  end if;
  if v_turno.estado <> 'abierto' then
    if p_forzar_turno then
      v_tardia := true;
    elsif p_fecha is not null
          and p_fecha >= v_turno.fecha_apertura - interval '5 minutes'
          and p_fecha <= coalesce(v_turno.fecha_cierre, now()) + interval '5 minutes' then
      v_tardia := true;
    else
      raise exception 'TURNO_CERRADO: el turno #% ya está cerrado; no se puede registrar la venta.', p_turno_id;
    end if;
  end if;

  -- ── v14 · FECHA REAL de la venta (cola offline / webhook tardío) ─────
  -- Se acota al rango del turno (un reloj corrido no deja ventas eternas).
  -- Para ventas en línea p_fecha es null → now(), idéntico a la v13.
  v_ahora := least(greatest(coalesce(p_fecha, now()), v_turno.fecha_apertura),
                   coalesce(v_turno.fecha_cierre, now()));
  v_hoy := v_ahora::date;
  if public.fn_periodo_cerrado(v_hoy) then
    v_hoy := current_date;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_total := v_total + (v_item->>'precio_unitario')::numeric * (v_item->>'cantidad')::numeric;
    -- v11: payloads viejos (cola offline / cobros_terminal previos al deploy)
    -- no traen la clave → coalesce a minorista. Valor inválido = fail-loud.
    v_item_lista := coalesce(nullif(v_item->>'lista_precio', ''), 'minorista');
    if v_item_lista not in ('minorista', 'mayorista') then
      raise exception 'Lista de precios inválida: %', v_item_lista;
    end if;
    if v_item_lista = 'mayorista' then v_lista_venta := 'mayorista'; end if;
  end loop;

  -- ── v14 · VUELTO: pagos_venta guarda lo IMPUTADO, no lo entregado ────
  -- El POS manda lo que el cliente entregó (atajos de billetes). Si la suma
  -- supera el total, el exceso se descuenta de las líneas de efectivo (de
  -- la última a la primera); una línea que queda en 0 se descarta. Así el
  -- efectivo del arqueo es el que realmente quedó en el cajón.
  select coalesce(sum((pg->>'monto')::numeric), 0) into v_suma_pagos
    from jsonb_array_elements(p_pagos) pg;
  v_exceso := round(v_suma_pagos - v_total, 2);
  v_pagos := p_pagos;
  if v_exceso > 0.009 then
    v_pagos := '[]'::jsonb;
    for v_pago in
      select t.value from jsonb_array_elements(p_pagos) with ordinality as t(value, ord)
      order by t.ord desc
    loop
      if v_exceso > 0.009 and v_pago->>'medio_pago' = 'efectivo' then
        v_monto := (v_pago->>'monto')::numeric;
        v_quitar := least(v_monto, v_exceso);
        v_exceso := round(v_exceso - v_quitar, 2);
        v_monto := round(v_monto - v_quitar, 2);
        if v_monto <= 0.005 then
          continue;  -- la línea era todo vuelto
        end if;
        v_pago := jsonb_set(v_pago, '{monto}', to_jsonb(v_monto));
      end if;
      v_pagos := jsonb_build_array(v_pago) || v_pagos;
    end loop;
    if v_exceso > 0.009 then
      raise exception 'Los pagos superan el total de la venta ($%).', round(v_total, 2);
    end if;
    if jsonb_array_length(v_pagos) = 0 then
      raise exception 'La venta debe tener al menos un pago.';
    end if;
  end if;

  select p->>'medio_pago' into v_medio_principal
  from jsonb_array_elements(v_pagos) p order by (p->>'monto')::numeric desc limit 1;

  -- ── v12 · BASE GRAVADA ────────────────────────────────────────────────
  -- Solo la porción cobrada con medios marcados genera_iva_venta produce
  -- débito fiscal. left join + coalesce a true: un código que no esté en
  -- medios_pago ('nota_credito') debe seguir gravando, no desaparecer en
  -- silencio bajando la base sin aviso.
  select coalesce(sum((pg.pago->>'monto')::numeric), 0) into v_pagos_gravados
  from jsonb_array_elements(v_pagos) as pg(pago)
  left join public.medios_pago mp on mp.codigo = pg.pago->>'medio_pago'
  where coalesce(mp.genera_iva_venta, true);

  -- Alícuota real (antes: 1.21 hardcodeado, divergía de la tab Impuestos).
  select 1 + coalesce(iva_alicuota_general, 21) / 100 into v_factor_iva
    from public.config_fiscal where id = 1;
  v_factor_iva := coalesce(v_factor_iva, 1.21);

  -- least(): defensa por si algún payload viejo trae más que el total.
  v_base_gravada := least(v_pagos_gravados, v_total);
  v_neto := round(v_base_gravada / v_factor_iva, 2);
  v_iva  := round(v_base_gravada - v_neto, 2);

  -- El header se inserta atajando la carrera POS ↔ webhook: si otra
  -- transacción ya creó esta venta (mismo cliente_uuid, índice único parcial
  -- ventas_cliente_uuid_key de la mig 027), devolvemos la existente como éxito
  -- idempotente en vez de reventar con unique_violation.
  begin
    insert into public.ventas (turno_id, usuario_id, fecha, total, medio_pago, estado, cliente_uuid, cliente_id, lista_precio,
                               base_gravada, iva_debito)
    values (p_turno_id, p_usuario_id, v_ahora, v_total, v_medio_principal, 'completada', p_cliente_uuid, p_cliente_id, v_lista_venta,
            v_base_gravada, v_iva)
    returning * into v_venta;
  exception when unique_violation then
    select * into v_venta from public.ventas where cliente_uuid = p_cliente_uuid;
    return v_venta;
  end;

  for v_pago in select * from jsonb_array_elements(v_pagos) loop
    insert into public.pagos_venta (venta_id, medio_pago, monto)
    values (v_venta.id, v_pago->>'medio_pago', (v_pago->>'monto')::numeric)
    returning id into v_pago_venta_id;
    v_medio := v_pago->>'medio_pago'; v_monto := (v_pago->>'monto')::numeric;

    -- v10: el fiado no es efectivo NI banco → acumulador propio para que el
    -- asiento lo mande a Deudores por Ventas y no a Bancos.
    if v_medio = 'cuenta_corriente' then
      v_pagos_ctacte := v_pagos_ctacte + v_monto;
    elsif v_medio <> 'efectivo' then
      v_pagos_no_efec := v_pagos_no_efec + v_monto;
    else
      v_efectivo_imputado := v_efectivo_imputado + v_monto;  -- v14
    end if;

    if v_medio = 'nota_credito' then
      v_nc_codigo := v_pago->>'nc_codigo';
      if v_nc_codigo is null or btrim(v_nc_codigo) = '' then
        raise exception 'Falta el código de la nota de crédito.'; end if;
      select * into v_nc from public.notas_credito where codigo = v_nc_codigo and estado = 'activa' for update;
      if not found then raise exception 'Nota de crédito % no válida o ya usada.', v_nc_codigo; end if;
      if v_nc.saldo_disponible + 0.01 < v_monto then
        raise exception 'Saldo insuficiente en la nota de crédito (disp. %).', v_nc.saldo_disponible; end if;
      update public.notas_credito
        set saldo_disponible = saldo_disponible - v_monto,
            estado = case when saldo_disponible - v_monto <= 0.005 then 'usada' else 'activa' end
        where id = v_nc.id;
      continue;
    end if;

    -- ── v10 · CUENTA CORRIENTE (fiado). Molde: branch nota_credito. ──
    -- El pago NO mueve plata: genera deuda del cliente o del empleado.
    -- El medio existe en medios_pago con cuenta_id NULL, así que aun sin
    -- este branch nunca acreditaría nada — acá además valida y carga.
    if v_medio = 'cuenta_corriente' then
      if v_cc_ya_fiado then
        raise exception 'Solo puede haber una línea de cuenta corriente por venta.';
      end if;
      v_cc_ya_fiado := true;

      v_deudor_tipo := v_pago->>'deudor_tipo';
      v_deudor_id   := nullif(v_pago->>'deudor_id', '')::integer;

      if v_deudor_tipo is null or v_deudor_tipo not in ('cliente', 'empleado')
         or v_deudor_id is null then
        raise exception 'Falta indicar a quién se le fía (cliente o empleado).';
      end if;
      if v_monto is null or v_monto <= 0 then
        raise exception 'El monto de la cuenta corriente debe ser mayor a 0.';
      end if;

      -- FOR UPDATE sobre la fila del deudor: serializa dos fiados
      -- simultáneos al mismo deudor → el control de tope no se burla.
      if v_deudor_tipo = 'cliente' then
        select c.nombre, c.activo into v_deudor_nombre, v_deudor_activo
          from public.clientes c where c.id = v_deudor_id for update;
        v_cc_cliente_id := v_deudor_id;
      else
        select btrim(coalesce(e.nombre, '') || ' ' || coalesce(e.apellido, '')), e.activo
          into v_deudor_nombre, v_deudor_activo
          from public.empleados e where e.id = v_deudor_id for update;
      end if;
      if v_deudor_nombre is null then
        raise exception 'El deudor de la cuenta corriente no existe.';
      end if;
      if not coalesce(v_deudor_activo, false) then
        raise exception 'La cuenta de % está dada de baja; no se le puede fiar.', v_deudor_nombre;
      end if;

      -- Tope de crédito: BLOQUEA (decisión del dueño). Sin fila o 0 = no se fía.
      if v_deudor_tipo = 'cliente' then
        select coalesce(l.monto, 0) into v_limite from public.limite_credito l
          where l.cliente_id = v_deudor_id;
        select coalesce(sum(x.monto), 0) into v_saldo_deuda
          from public.cuenta_corriente_cliente x where x.cliente_id = v_deudor_id;
      else
        select coalesce(l.monto, 0) into v_limite from public.limite_credito l
          where l.empleado_id = v_deudor_id;
        select coalesce(sum(x.monto), 0) into v_saldo_deuda
          from public.cuenta_corriente_empleado x where x.empleado_id = v_deudor_id;
      end if;
      v_limite := coalesce(v_limite, 0);

      -- Tolerancia de centavo, como el resto del sistema (0.009). El prefijo
      -- CTACTE_LIMITE lo usa el front para un toast entendible.
      if v_saldo_deuda + v_monto > v_limite + 0.009 then
        raise exception
          'CTACTE_LIMITE: % no tiene cupo para fiar $%. Debe $% y su tope es $%.',
          v_deudor_nombre, round(v_monto, 2), round(v_saldo_deuda, 2), round(v_limite, 2);
      end if;

      if v_deudor_tipo = 'cliente' then
        insert into public.cuenta_corriente_cliente
          (cliente_id, fecha, tipo, concepto, monto, venta_id, turno_id, usuario_id)
        values (v_deudor_id, v_hoy, 'consumo', 'Venta #' || v_venta.id,
                v_monto, v_venta.id, p_turno_id, p_usuario_id);
      else
        insert into public.cuenta_corriente_empleado
          (empleado_id, fecha, tipo, concepto, monto, venta_id, turno_id, usuario_id)
        values (v_deudor_id, v_hoy, 'consumo', 'Venta #' || v_venta.id,
                v_monto, v_venta.id, p_turno_id, p_usuario_id);
      end if;

      continue;
    end if;

    select cuenta_id, coalesce(comision_porcentaje, 0), coalesce(dias_acreditacion, 0)
      into v_cuenta_id, v_comision, v_dias_acred from public.medios_pago where codigo = v_medio;
    if v_cuenta_id is null then continue; end if;

    -- Overrides reales de MP (pesos). Si no vienen, se calcula con la tabla.
    v_comision_override := nullif(v_pago->>'comision_monto', '')::numeric;
    v_iibb_override := nullif(v_pago->>'iibb_monto', '')::numeric;
    v_comision_monto := coalesce(v_comision_override, round(v_monto * v_comision) / 100);

    if v_dias_acred > 0 then
      insert into public.acreditaciones (
        venta_id, pago_venta_id, medio_pago, cuenta_id, monto_bruto, comision_pct,
        comision_monto, monto_neto, fecha_venta, fecha_estimada, estado, usuario_id
      ) values (
        v_venta.id, v_pago_venta_id, v_medio, v_cuenta_id, v_monto, v_comision,
        v_comision_monto, v_monto - v_comision_monto, v_hoy, v_hoy + v_dias_acred, 'pendiente', p_usuario_id);
    else
      select saldo_actual, coalesce(retencion_iibb_porcentaje, 0)
        into v_saldo, v_iibb_pct from public.cuentas where id = v_cuenta_id for update;
      if v_saldo is null then continue; end if;
      v_iibb_monto := coalesce(v_iibb_override, round(v_monto * v_iibb_pct) / 100);

      v_saldo_nuevo := v_saldo + v_monto;
      insert into public.movimientos_cuenta (cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
        descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha)
      values (v_cuenta_id, 'ingreso', v_monto, v_saldo, v_saldo_nuevo,
        'Venta #' || v_venta.id || ' · ' || v_medio, 'venta', 'venta', v_venta.id, p_usuario_id, v_hoy);

      if v_comision_monto > 0 then
        v_desc_comision := case
          when v_comision_override is not null
            then 'Comisión ' || v_medio || ' (MP real) · Venta #' || v_venta.id
          else 'Comision ' || v_medio || ' (' || v_comision || '%) Venta #' || v_venta.id
        end;
        insert into public.movimientos_cuenta (cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
          descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha)
        values (v_cuenta_id, 'egreso', v_comision_monto, v_saldo_nuevo, v_saldo_nuevo - v_comision_monto,
          v_desc_comision, 'comisiones', 'venta', v_venta.id, p_usuario_id, v_hoy);
        v_saldo_nuevo := v_saldo_nuevo - v_comision_monto;
      end if;

      if v_iibb_monto > 0 then
        v_desc_iibb := case
          when v_iibb_override is not null
            then 'Retención IIBB (MP real) · Venta #' || v_venta.id
          else 'Retención IIBB (' || v_iibb_pct || '%) · Venta #' || v_venta.id
        end;
        insert into public.movimientos_cuenta (cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
          descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha)
        values (v_cuenta_id, 'egreso', v_iibb_monto, v_saldo_nuevo, v_saldo_nuevo - v_iibb_monto,
          v_desc_iibb, 'iibb', 'venta', v_venta.id, p_usuario_id, v_hoy);
        v_saldo_nuevo := v_saldo_nuevo - v_iibb_monto;
      end if;

      update public.cuentas set saldo_actual = v_saldo_nuevo, updated_at = v_ahora where id = v_cuenta_id;
    end if;
  end loop;

  -- v10: si se fió a un cliente del CRM y la venta no traía cliente, se
  -- asocia solo — el historial de compras tiene que incluir lo fiado.
  if p_cliente_id is null and v_cc_cliente_id is not null then
    update public.ventas set cliente_id = v_cc_cliente_id where id = v_venta.id;
    v_venta.cliente_id := v_cc_cliente_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_prod_id := (v_item->>'producto_id')::integer;
    v_cantidad := (v_item->>'cantidad')::numeric;
    v_precio := (v_item->>'precio_unitario')::numeric;
    v_item_lista := coalesce(nullif(v_item->>'lista_precio', ''), 'minorista');  -- v11

    if exists (select 1 from public.producto_componentes where producto_id = v_prod_id) then
      -- ── Combo/pack: el item se registra con el combo, pero el stock,
      --    los lotes y el CMV salen de los COMPONENTES. ──
      insert into public.items_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal, lista_precio)
      values (v_venta.id, v_prod_id, v_cantidad, v_precio, v_precio * v_cantidad, v_item_lista)
      returning id into v_item_id;  -- v13

      select nombre into v_nombre_combo from public.productos where id = v_prod_id;

      v_costo_combo := 0;  -- v13
      for v_comp in
        select pc.componente_id, pc.cantidad
        from public.producto_componentes pc
        where pc.producto_id = v_prod_id
        order by pc.id
      loop
        v_cant_comp := v_comp.cantidad * v_cantidad;
        select stock_actual, coalesce(controlar_stock, true)
          into v_stock_ant, v_controlar from public.productos
          where id = v_comp.componente_id for update;
        v_stock_ant := coalesce(v_stock_ant, 0);
        if v_controlar then
          v_costo_unit := public.fn_costo(v_comp.componente_id);
          v_total_costo := v_total_costo + v_costo_unit * v_cant_comp;
          v_costo_combo := v_costo_combo + v_costo_unit * v_cant_comp;  -- v13
          v_stock_nuevo := v_stock_ant - v_cant_comp;
          update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora
            where id = v_comp.componente_id;
          insert into public.movimientos_stock (producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
            referencia_id, usuario_id, nota)
          values (v_comp.componente_id, 'venta', v_cant_comp, v_stock_ant, v_stock_nuevo, v_venta.id,
            p_usuario_id, 'Venta #' || v_venta.id || ' (combo ' || coalesce(v_nombre_combo, v_prod_id::text) || ')');
          v_restante := v_cant_comp;
          for v_lote in select id, cantidad_actual from public.lotes
              where producto_id = v_comp.componente_id and estado = 'activo'::public.estado_lote and cantidad_actual > 0
              order by fecha_vencimiento asc for update loop
            exit when v_restante <= 0;
            v_usar := least(v_lote.cantidad_actual, v_restante);
            update public.lotes set cantidad_actual = v_lote.cantidad_actual - v_usar,
              estado = (case when v_lote.cantidad_actual - v_usar = 0 then 'agotado' else 'activo' end)::public.estado_lote
              where id = v_lote.id;
            v_restante := v_restante - v_usar;
          end loop;
        end if;
      end loop;

      -- v13: costo del combo congelado, por UNIDAD de combo vendida (la suma
      -- de componentes que acaba de entrar al CMV ÷ cantidad de combos).
      if v_costo_combo > 0 and v_cantidad > 0 then
        insert into public.costos_item_venta (item_venta_id, costo_unitario)
        values (v_item_id, round(v_costo_combo / v_cantidad, 4));
      end if;
    else
      -- ── Producto común: idéntico a la v7 (072). ──
      select stock_actual, coalesce(controlar_stock, true)
        into v_stock_ant, v_controlar from public.productos where id = v_prod_id for update;
      v_stock_ant := coalesce(v_stock_ant, 0);

      -- El item se registra siempre.
      insert into public.items_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal, lista_precio)
      values (v_venta.id, v_prod_id, v_cantidad, v_precio, v_precio * v_cantidad, v_item_lista)
      returning id into v_item_id;  -- v13

      -- Solo los productos con control de stock afectan inventario, movimientos,
      -- lotes y CMV. Los demás (servicios, granel sin control) quedan afuera.
      if v_controlar then
        v_costo_unit := public.fn_costo(v_prod_id);
        -- v13: costo congelado. Solo si > 0: un 0 acá significa "sin costo
        -- cargado" y la fila ausente lo expresa mejor que un 0 ambiguo.
        if v_costo_unit > 0 then
          insert into public.costos_item_venta (item_venta_id, costo_unitario)
          values (v_item_id, v_costo_unit);
        end if;
        v_total_costo := v_total_costo + v_costo_unit * v_cantidad;
        v_stock_nuevo := v_stock_ant - v_cantidad;
        update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora where id = v_prod_id;
        insert into public.movimientos_stock (producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
          referencia_id, usuario_id, nota)
        values (v_prod_id, 'venta', v_cantidad, v_stock_ant, v_stock_nuevo, v_venta.id, p_usuario_id, 'Venta #' || v_venta.id);
        v_restante := v_cantidad;
        for v_lote in select id, cantidad_actual from public.lotes
            where producto_id = v_prod_id and estado = 'activo'::public.estado_lote and cantidad_actual > 0
            order by fecha_vencimiento asc for update loop
          exit when v_restante <= 0;
          v_usar := least(v_lote.cantidad_actual, v_restante);
          update public.lotes set cantidad_actual = v_lote.cantidad_actual - v_usar,
            estado = (case when v_lote.cantidad_actual - v_usar = 0 then 'agotado' else 'activo' end)::public.estado_lote
            where id = v_lote.id;
          v_restante := v_restante - v_usar;
        end loop;
      end if;
    end if;
  end loop;

  select id into v_cta_ventas from public.plan_cuentas where codigo = '4.1.01';
  select id into v_cta_iva from public.plan_cuentas where codigo = '2.1.02';
  select id into v_cta_caja from public.plan_cuentas where codigo = '1.1.01';
  select id into v_cta_banco from public.plan_cuentas where codigo = '1.1.02';
  select id into v_cta_deudores from public.plan_cuentas where codigo = '1.1.03';  -- v10
  select id into v_cta_cmv from public.plan_cuentas where codigo = '5.1.01';
  select id into v_cta_merc from public.plan_cuentas where codigo = '1.1.04';

  -- v10 fail-loud: si se fió y no existe 1.1.03, el asiento quedaría
  -- descuadrado en silencio. Mejor abortar la venta entera.
  if v_pagos_ctacte > 0 and v_cta_deudores is null then
    raise exception 'Falta la cuenta 1.1.03 Deudores por Ventas en el plan; no se puede fiar.';
  end if;

  if v_total > 0 and v_cta_ventas is not null and v_cta_iva is not null
     and v_cta_caja is not null and v_cta_banco is not null then
    -- v12: v_neto / v_iva ya vienen calculados arriba, sobre la BASE GRAVADA.
    -- v10 · Prelación: primero el fiado, después lo no-efectivo; el resto
    -- es efectivo (antes: no_efec y el resto efectivo).
    v_ctacte := least(v_pagos_ctacte, v_total);
    v_no_efec := least(v_pagos_no_efec, v_total - v_ctacte);
    v_efectivo := v_total - v_no_efec - v_ctacte;
    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (v_hoy, 'Venta #' || v_venta.id, 'automatico', 'venta', v_venta.id, p_usuario_id)
    returning id into v_asiento_id;
    if v_efectivo > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_caja, v_efectivo, 0, v_orden); v_orden := v_orden + 1; end if;
    if v_no_efec > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_banco, v_no_efec, 0, v_orden); v_orden := v_orden + 1; end if;
    if v_ctacte > 0 then   -- v10: el fiado debita Deudores por Ventas
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_deudores, v_ctacte, 0, v_orden); v_orden := v_orden + 1; end if;
    -- v12: Ventas absorbe el neto gravado + TODO lo no gravado (el efectivo
    -- que no genera débito fiscal). Sigue cuadrando: (v_total − v_iva) + v_iva.
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_ventas, 0, v_total - v_iva, v_orden); v_orden := v_orden + 1;
    if v_iva > 0 then   -- v12: sin IVA débito no se emite el renglón
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_iva, 0, v_iva, v_orden); v_orden := v_orden + 1; end if;
    if v_cta_cmv is not null and v_cta_merc is not null and v_total_costo > 0 then
      v_total_costo := round(v_total_costo, 2);
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_cmv, v_total_costo, 0, v_orden); v_orden := v_orden + 1;
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_merc, 0, v_total_costo, v_orden);
    end if;
  end if;

  -- Cierra el intento de cobro con terminal si esta venta vino de uno: su
  -- cliente_uuid ES el id del intento. Así el POS —que registra al instante—
  -- también deja el intento en 'registrada' y no queda como "sin conciliar"
  -- fantasma hasta que llegue el webhook. Para ventas normales (uuid random)
  -- no matchea ninguna fila → no-op. Security definer: bypassa la RLS.
  if p_cliente_uuid is not null then
    update public.cobros_terminal
      set venta_id = v_venta.id, estado = 'registrada', updated_at = v_ahora
      where id = p_cliente_uuid and venta_id is null;
  end if;

  -- ── v14 · IMPUTACIÓN TARDÍA a un turno ya cerrado ────────────────────
  -- El efectivo de esta venta ya estaba en el cajón cuando se contó el
  -- cierre: el esperado sube y la diferencia se corrige. Queda anotado.
  if v_tardia then
    update public.caja_turnos
      set monto_cierre_esperado = case
            when monto_cierre_esperado is null or v_efectivo_imputado <= 0 then monto_cierre_esperado
            else round(monto_cierre_esperado + v_efectivo_imputado, 2) end,
          diferencia = case
            when monto_cierre_esperado is null or monto_cierre_real is null or v_efectivo_imputado <= 0 then diferencia
            else round(monto_cierre_real - (monto_cierre_esperado + v_efectivo_imputado), 2) end,
          novedades = concat_ws(' · ', novedades,
            'Venta #' || v_venta.id || ' registrada después del cierre'
            || case when v_efectivo_imputado > 0
                    then ' (+$' || round(v_efectivo_imputado, 2) || ' efectivo al esperado)'
                    else '' end)
      where id = p_turno_id;
  end if;

  return v_venta;
end;
$$;

-- Postgres da EXECUTE a public al crear una función: se pisa explícitamente.
revoke all on function public.fn_crear_venta(integer, uuid, jsonb, jsonb, uuid, integer, boolean, timestamptz)
  from public, anon;
grant execute on function public.fn_crear_venta(integer, uuid, jsonb, jsonb, uuid, integer, boolean, timestamptz)
  to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 5. fn_registrar_venta_cobro_terminal · idéntica a la 128, pero pasa la
--    hora del intento como p_fecha: un webhook tardío ya no fecha la venta
--    en el momento de la conciliación.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_registrar_venta_cobro_terminal(
  p_cobro_id uuid
) returns public.ventas
language plpgsql security definer set search_path = public
as $$
declare
  v_cobro public.cobros_terminal;
  v_venta public.ventas;
  v_linea jsonb;
  v_pagos jsonb;
begin
  select * into v_cobro from public.cobros_terminal where id = p_cobro_id for update;
  if not found then
    raise exception 'El intento de cobro % no existe.', p_cobro_id;
  end if;

  -- Ya registrada: devolver la venta existente (idempotencia a nivel intento).
  if v_cobro.venta_id is not null then
    select * into v_venta from public.ventas where id = v_cobro.venta_id;
    return v_venta;
  end if;

  if v_cobro.medio_pago is null then
    raise exception 'El intento % todavía no tiene medio de pago resuelto.', p_cobro_id;
  end if;

  -- Línea de la maquinita con la comisión + IIBB REALES que reportó MP.
  v_linea := jsonb_build_object(
    'medio_pago', v_cobro.medio_pago,
    'monto', v_cobro.monto,
    'comision_monto', v_cobro.comision_real,
    'iibb_monto', v_cobro.iibb_real
  );
  v_pagos := coalesce(v_cobro.pagos_previos, '[]'::jsonb) || jsonb_build_array(v_linea);

  -- Fuerza el turno original aunque esté cerrado (decisión de negocio).
  -- v14: fecha = creación del intento (cuando el cajero cobró).
  v_venta := public.fn_crear_venta(
    v_cobro.turno_id, v_cobro.usuario_id, v_pagos, v_cobro.items,
    p_cobro_id, v_cobro.cliente_id, true, v_cobro.created_at
  );

  update public.cobros_terminal
    set estado = 'registrada', venta_id = v_venta.id, error = null, updated_at = now()
    where id = p_cobro_id;

  return v_venta;
end;
$$;

revoke all on function public.fn_registrar_venta_cobro_terminal(uuid) from public;
revoke all on function public.fn_registrar_venta_cobro_terminal(uuid) from anon, authenticated;
grant execute on function public.fn_registrar_venta_cobro_terminal(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 6. RLS: caja_turnos, ventas, items_venta, pagos_venta → SOLO SELECT.
--    Toda escritura pasa por las RPC security definer (fn_abrir_turno,
--    fn_cerrar_turno, fn_crear_venta, fn_anular_venta, fn_crear_devolucion).
--    Verificado en el repo: no quedan inserts/updates directos del cliente.
-- ─────────────────────────────────────────────────────────────────────
do $$
declare
  v_tabla text;
  v_pol text;
begin
  foreach v_tabla in array array['caja_turnos', 'ventas', 'items_venta', 'pagos_venta'] loop
    for v_pol in
      select policyname from pg_policies where schemaname = 'public' and tablename = v_tabla
    loop
      execute format('drop policy %I on public.%I', v_pol, v_tabla);
    end loop;
    execute format('alter table public.%I enable row level security', v_tabla);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      v_tabla || '_select', v_tabla
    );
  end loop;
end $$;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- Chequeos post-migración (correr a mano, deben cumplirse):
--   T1 (0 filas):
--     select proname, count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and proname like 'fn_%' group by proname having count(*) > 1;
--   anon sin acceso (false):
--     select has_function_privilege('anon',
--       'public.fn_crear_venta(integer,uuid,jsonb,jsonb,uuid,integer,boolean,timestamptz)', 'execute');
--   policies (solo *_select):
--     select tablename, policyname, cmd from pg_policies
--     where tablename in ('caja_turnos','ventas','items_venta','pagos_venta');
--   turnos abiertos (uno por usuario como máximo):
--     select usuario_id, count(*) from caja_turnos where estado = 'abierto' group by 1 having count(*) > 1;
-- ─────────────────────────────────────────────────────────────────────
