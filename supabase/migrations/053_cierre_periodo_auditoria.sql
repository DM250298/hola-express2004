-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 053 · R5 — Cierre de período + Auditoría                 ║
-- ║                                                                     ║
-- ║  A) periodos_contables: candar un mes. Con un mes cerrado no se      ║
-- ║     puede anular una venta ni reeditar una factura de ese período.  ║
-- ║  B) auditoria: log de anulaciones, arqueos, remesas y cierres, con   ║
-- ║     usuario, fecha e IP.                                            ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── Tablas ──────────────────────────────────────────────────────────
create table if not exists public.periodos_contables (
  id             serial primary key,
  anio           integer not null,
  mes            integer not null,
  estado         text not null default 'abierto',  -- 'abierto' | 'cerrado'
  fecha_cierre   timestamptz,
  usuario_cierre uuid references public.usuarios(id),
  unique (anio, mes)
);
alter table public.periodos_contables enable row level security;
do $$ begin
  create policy "gate" on public.periodos_contables for all to authenticated
    using (public.fn_tiene_permiso('contabilidad'))
    with check (public.fn_tiene_permiso('contabilidad'));
exception when duplicate_object then null; end $$;

create table if not exists public.auditoria (
  id          serial primary key,
  usuario_id  uuid references public.usuarios(id),
  accion      text not null,
  entidad     text,
  entidad_id  integer,
  detalle     jsonb,
  ip          text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_auditoria_fecha on public.auditoria(created_at desc);
create index if not exists idx_auditoria_accion on public.auditoria(accion);
alter table public.auditoria enable row level security;
do $$ begin
  create policy "gate" on public.auditoria for all to authenticated
    using (public.fn_tiene_permiso('contabilidad'))
    with check (public.fn_tiene_permiso('contabilidad'));
exception when duplicate_object then null; end $$;

-- ─── Helpers ─────────────────────────────────────────────────────────
create or replace function public.fn_ip() returns text
language plpgsql stable as $$
declare v_h text; v_j json;
begin
  v_h := current_setting('request.headers', true);
  if v_h is null or v_h = '' then return null; end if;
  v_j := v_h::json;
  return coalesce(
    nullif(split_part(coalesce(v_j->>'x-forwarded-for', ''), ',', 1), ''),
    v_j->>'x-real-ip'
  );
exception when others then return null;
end $$;

create or replace function public.fn_auditar(
  p_usuario_id uuid, p_accion text, p_entidad text,
  p_entidad_id integer, p_detalle jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.auditoria (usuario_id, accion, entidad, entidad_id, detalle, ip)
  values (p_usuario_id, p_accion, p_entidad, p_entidad_id, p_detalle, public.fn_ip());
end $$;

create or replace function public.fn_periodo_cerrado(p_fecha date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.periodos_contables
    where anio = extract(year from p_fecha)::int
      and mes = extract(month from p_fecha)::int
      and estado = 'cerrado'
  )
$$;
grant execute on function public.fn_periodo_cerrado(date) to authenticated;

-- ─── Cerrar / reabrir período ────────────────────────────────────────
create or replace function public.fn_cerrar_periodo(
  p_usuario_id uuid, p_anio integer, p_mes integer
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.periodos_contables (anio, mes, estado, fecha_cierre, usuario_cierre)
  values (p_anio, p_mes, 'cerrado', now(), p_usuario_id)
  on conflict (anio, mes)
  do update set estado = 'cerrado', fecha_cierre = now(), usuario_cierre = p_usuario_id;
  perform public.fn_auditar(p_usuario_id, 'cerrar_periodo', 'periodo', null,
    jsonb_build_object('anio', p_anio, 'mes', p_mes));
end $$;

create or replace function public.fn_reabrir_periodo(
  p_usuario_id uuid, p_anio integer, p_mes integer
) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.periodos_contables
    set estado = 'abierto', fecha_cierre = null, usuario_cierre = null
    where anio = p_anio and mes = p_mes;
  perform public.fn_auditar(p_usuario_id, 'reabrir_periodo', 'periodo', null,
    jsonb_build_object('anio', p_anio, 'mes', p_mes));
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- fn_anular_venta v3  (guarda de período cerrado + auditoría)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_anular_venta(
  p_venta_id integer, p_usuario_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_estado text;
  v_fecha date;
  v_total numeric;
  v_ahora timestamptz := now();
  v_hoy date := current_date;
  v_item record;
  v_mov record;
  v_stock_ant integer;
  v_stock_nuevo integer;
  v_saldo numeric;
  v_saldo_nuevo numeric;
  v_tipo_opuesto text;
  v_lote_id integer;
begin
  select estado, fecha::date, total into v_estado, v_fecha, v_total
    from public.ventas where id = p_venta_id for update;
  if v_estado is null then raise exception 'La venta no existe.'; end if;
  if v_estado <> 'completada' then raise exception 'La venta ya estaba anulada.'; end if;
  if public.fn_periodo_cerrado(v_fecha) then
    raise exception 'El período de esa venta está cerrado; no se puede anular.';
  end if;

  for v_item in select producto_id, cantidad from public.items_venta where venta_id = p_venta_id loop
    select stock_actual into v_stock_ant from public.productos where id = v_item.producto_id for update;
    if v_stock_ant is null then continue; end if;
    v_stock_nuevo := v_stock_ant + v_item.cantidad;
    update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora
      where id = v_item.producto_id;
    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia_id, usuario_id, nota
    ) values (
      v_item.producto_id, 'entrada', v_item.cantidad, v_stock_ant, v_stock_nuevo,
      p_venta_id, p_usuario_id, 'Anulación venta #' || p_venta_id
    );
    select id into v_lote_id from public.lotes
      where producto_id = v_item.producto_id and estado in ('activo','agotado')
      order by fecha_vencimiento desc, id desc limit 1;
    if v_lote_id is not null then
      update public.lotes set cantidad_actual = cantidad_actual + v_item.cantidad, estado = 'activo'
        where id = v_lote_id;
    end if;
  end loop;

  for v_mov in
    select cuenta_id, tipo, monto from public.movimientos_cuenta
      where tipo in ('ingreso', 'egreso')
        and ((referencia_tipo = 'venta' and referencia_id = p_venta_id)
          or (referencia_tipo = 'acreditacion' and referencia_id in (
                select id from public.acreditaciones where venta_id = p_venta_id)))
  loop
    v_tipo_opuesto := case when v_mov.tipo = 'ingreso' then 'egreso' else 'ingreso' end;
    select saldo_actual into v_saldo from public.cuentas where id = v_mov.cuenta_id for update;
    if v_saldo is null then continue; end if;
    v_saldo_nuevo := case when v_tipo_opuesto = 'ingreso' then v_saldo + v_mov.monto else v_saldo - v_mov.monto end;
    insert into public.movimientos_cuenta (
      cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
      descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
    ) values (
      v_mov.cuenta_id, v_tipo_opuesto, v_mov.monto, v_saldo, v_saldo_nuevo,
      'Anulación venta #' || p_venta_id, 'venta', 'venta', p_venta_id, p_usuario_id, v_hoy
    );
    update public.cuentas set saldo_actual = v_saldo_nuevo, updated_at = v_ahora where id = v_mov.cuenta_id;
  end loop;

  update public.acreditaciones set estado = 'cancelada', updated_at = v_ahora
    where venta_id = p_venta_id and estado in ('pendiente', 'acreditada');
  delete from public.asientos where origen = 'venta' and referencia_id = p_venta_id;
  update public.ventas set estado = 'anulada' where id = p_venta_id;

  perform public.fn_auditar(p_usuario_id, 'anular_venta', 'venta', p_venta_id,
    jsonb_build_object('total', v_total));
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- fn_validar_arqueo v2  (+ auditoría)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_validar_arqueo(
  p_usuario_id uuid, p_sangria_ids integer[], p_monto_fisico numeric, p_nota text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_esperado numeric := 0; v_diferencia numeric; v_estado text; v_arqueo_id integer;
begin
  if p_sangria_ids is null or array_length(p_sangria_ids, 1) is null then
    raise exception 'Seleccioná al menos un sobre para arquear.';
  end if;
  select coalesce(sum(monto), 0) into v_esperado from public.sangrias
    where id = any(p_sangria_ids) and estado = 'en_buzon';
  v_diferencia := round(p_monto_fisico - v_esperado, 2);
  if v_diferencia <> 0 and (p_nota is null or btrim(p_nota) = '') then
    raise exception 'Hay una diferencia de %. Ingresá una nota de ajuste para validar el arqueo.', v_diferencia;
  end if;
  v_estado := case when v_diferencia = 0 then 'validado' else 'con_diferencia' end;
  insert into public.arqueos_tesoreria (usuario_id, monto_esperado, monto_fisico, diferencia, nota_ajuste, estado)
  values (p_usuario_id, v_esperado, p_monto_fisico, v_diferencia, nullif(btrim(coalesce(p_nota,'')),''), v_estado)
  returning id into v_arqueo_id;
  update public.sangrias set estado = 'arqueada', arqueo_id = v_arqueo_id
    where id = any(p_sangria_ids) and estado = 'en_buzon';
  perform public.fn_auditar(p_usuario_id, 'arqueo', 'arqueo_tesoreria', v_arqueo_id,
    jsonb_build_object('esperado', v_esperado, 'fisico', p_monto_fisico, 'diferencia', v_diferencia));
  return jsonb_build_object('arqueo_id', v_arqueo_id, 'monto_esperado', v_esperado,
    'monto_fisico', p_monto_fisico, 'diferencia', v_diferencia, 'estado', v_estado);
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- fn_generar_remesa v2  (+ auditoría)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_generar_remesa(
  p_usuario_id uuid, p_cuenta_id integer, p_monto numeric, p_comprobante text, p_nota text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_saldo_ant numeric; v_saldo_nuevo numeric; v_mov_id integer; v_remesa_id integer;
begin
  if p_monto is null or p_monto <= 0 then raise exception 'El monto de la remesa debe ser mayor a cero.'; end if;
  select saldo_actual into v_saldo_ant from public.cuentas where id = p_cuenta_id for update;
  if v_saldo_ant is null then raise exception 'La cuenta destino no existe.'; end if;
  v_saldo_nuevo := v_saldo_ant + p_monto;
  insert into public.movimientos_cuenta (
    cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo, descripcion, categoria, referencia_tipo, usuario_id
  ) values (
    p_cuenta_id, 'ingreso', p_monto, v_saldo_ant, v_saldo_nuevo,
    'Remesa / depósito de caja fuerte', 'remesa', 'remesa', p_usuario_id
  ) returning id into v_mov_id;
  update public.cuentas set saldo_actual = v_saldo_nuevo, updated_at = now() where id = p_cuenta_id;
  insert into public.remesas (usuario_id, cuenta_id, monto, comprobante, nota, movimiento_id)
  values (p_usuario_id, p_cuenta_id, p_monto,
    nullif(btrim(coalesce(p_comprobante,'')),''), nullif(btrim(coalesce(p_nota,'')),''), v_mov_id)
  returning id into v_remesa_id;
  perform public.fn_auditar(p_usuario_id, 'remesa', 'remesa', v_remesa_id,
    jsonb_build_object('monto', p_monto, 'cuenta_id', p_cuenta_id));
  return jsonb_build_object('remesa_id', v_remesa_id, 'movimiento_id', v_mov_id, 'saldo_nuevo', v_saldo_nuevo);
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- fn_guardar_factura_compra v4  (guarda de período cerrado)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_guardar_factura_compra(
  p_cuenta_id integer, p_pedido_id integer, p_proveedor_id integer,
  p_fecha date, p_afecta_precio_venta boolean, p_usuario_id uuid, p_lineas jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_ahora timestamptz := now();
  v_linea jsonb;
  v_neto numeric := 0; v_iva_total numeric := 0; v_total numeric := 0;
  v_factura_id integer; v_prod_id integer;
  v_costo_sin_iva numeric; v_desc numeric; v_iva_compra numeric;
  v_margen numeric; v_iva_venta numeric; v_cant numeric;
  v_costo_neto numeric; v_costo_con_iva numeric;
  v_precio_sin_iva numeric; v_precio_con_iva numeric;
  v_asiento_id integer; v_cta_merc integer; v_cta_iva_cred integer; v_cta_prov integer;
  v_costo_ant numeric; v_var_pct numeric;
begin
  if public.fn_periodo_cerrado(p_fecha) then
    raise exception 'El período de la factura está cerrado; no se puede modificar.';
  end if;

  delete from public.facturas_compra where cuenta_id = p_cuenta_id;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_costo_sin_iva := (v_linea->>'costo_sin_iva')::numeric;
    v_desc := coalesce((v_linea->>'descuento_porcentaje')::numeric, 0);
    v_iva_compra := coalesce((v_linea->>'iva_compra_porcentaje')::numeric, 0);
    v_cant := (v_linea->>'cantidad')::numeric;
    v_costo_neto := round(v_costo_sin_iva * (1 - v_desc / 100), 2);
    v_costo_con_iva := round(v_costo_neto * (1 + v_iva_compra / 100), 2);
    v_neto := v_neto + v_costo_neto * v_cant;
    v_iva_total := v_iva_total + (v_costo_con_iva - v_costo_neto) * v_cant;
  end loop;
  v_neto := round(v_neto, 2); v_iva_total := round(v_iva_total, 2);
  v_total := round(v_neto + v_iva_total, 2);

  insert into public.facturas_compra (
    cuenta_id, pedido_id, proveedor_id, fecha, neto, iva_total, total, afecta_precio_venta, usuario_id
  ) values (
    p_cuenta_id, p_pedido_id, p_proveedor_id, p_fecha, v_neto, v_iva_total, v_total, p_afecta_precio_venta, p_usuario_id
  ) returning id into v_factura_id;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_prod_id := (v_linea->>'producto_id')::integer;
    v_costo_sin_iva := (v_linea->>'costo_sin_iva')::numeric;
    v_desc := coalesce((v_linea->>'descuento_porcentaje')::numeric, 0);
    v_iva_compra := coalesce((v_linea->>'iva_compra_porcentaje')::numeric, 0);
    v_margen := coalesce((v_linea->>'margen_porcentaje')::numeric, 0);
    v_iva_venta := coalesce((v_linea->>'iva_venta_porcentaje')::numeric, 0);
    v_cant := (v_linea->>'cantidad')::numeric;
    v_costo_neto := round(v_costo_sin_iva * (1 - v_desc / 100), 2);
    v_costo_con_iva := round(v_costo_neto * (1 + v_iva_compra / 100), 2);
    v_precio_sin_iva := round(v_costo_neto * (1 + v_margen / 100), 2);
    v_precio_con_iva := round(v_precio_sin_iva * (1 + v_iva_venta / 100), 2);

    v_costo_ant := public.fn_costo(v_prod_id);
    if v_costo_ant > 0 and v_costo_neto > 0 and v_costo_neto <> v_costo_ant then
      v_var_pct := round(((v_costo_neto - v_costo_ant) / v_costo_ant) * 100, 2);
      insert into public.historial_costos (producto_id, proveedor_id, costo_anterior, costo_nuevo, variacion_pct, origen, pedido_id, usuario_id)
      values (v_prod_id, p_proveedor_id, v_costo_ant, v_costo_neto, v_var_pct, 'factura', p_pedido_id, p_usuario_id);
    end if;

    insert into public.items_factura_compra (
      factura_id, producto_id, cantidad, costo_sin_iva, descuento_porcentaje, iva_compra_porcentaje,
      costo_con_iva, margen_porcentaje, iva_venta_porcentaje, precio_sin_iva, precio_con_iva
    ) values (
      v_factura_id, v_prod_id, v_cant, v_costo_sin_iva, v_desc, v_iva_compra,
      v_costo_con_iva, v_margen, v_iva_venta, v_precio_sin_iva, v_precio_con_iva
    );

    if p_afecta_precio_venta then
      update public.productos set precio_venta = v_precio_con_iva, updated_at = v_ahora where id = v_prod_id;
    end if;
    perform public.fn_set_costo(v_prod_id, v_costo_neto);

    update public.proveedor_producto set costo = v_costo_neto, updated_at = v_ahora
      where proveedor_id = p_proveedor_id and producto_id = v_prod_id;
    update public.items_pedido set precio_costo = v_costo_neto, subtotal = round(v_costo_neto * v_cant, 2)
      where id = (v_linea->>'item_pedido_id')::integer;
  end loop;

  update public.pedidos set total = v_total, updated_at = v_ahora where id = p_pedido_id;
  update public.cuentas_a_pagar set monto = v_total, provisoria = false, tiene_factura = true where id = p_cuenta_id;

  delete from public.asientos where origen = 'factura_compra' and referencia_id = p_cuenta_id;
  select id into v_cta_merc from public.plan_cuentas where codigo = '1.1.04';
  select id into v_cta_iva_cred from public.plan_cuentas where codigo = '1.1.05';
  select id into v_cta_prov from public.plan_cuentas where codigo = '2.1.01';
  if v_total > 0 and v_cta_merc is not null and v_cta_iva_cred is not null and v_cta_prov is not null then
    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (p_fecha, 'Factura compra · Pedido #' || p_pedido_id, 'automatico', 'factura_compra', p_cuenta_id, p_usuario_id)
    returning id into v_asiento_id;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_merc, v_neto, 0, 0);
    if v_iva_total > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_iva_cred, v_iva_total, 0, 1);
    end if;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_prov, 0, v_total, 2);
  end if;
end $$;

notify pgrst, 'reload schema';
