-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 061 · Fix del circuito de compras                        ║
-- ║                                                                     ║
-- ║  1) Trigger de transiciones de estado válidas en `pedidos`.         ║
-- ║  2) Reissue de `fn_recibir_pedido`: la cantidad recibida ACUMULA    ║
-- ║     (recepción parcial en varias entregas) y monto/total se         ║
-- ║     recalculan desde el acumulado real. Antes pisaba con la última  ║
-- ║     tanda y corrompía la deuda al recibir el faltante.              ║
-- ║                                                                     ║
-- ║  Misma firma que la 051 → NO cambian types/database.ts.             ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1) Validación de transiciones de estado de pedidos
--    Blinda TODAS las vías (update del cliente y RPCs). Solo valida
--    cuando el estado realmente cambia, así los updates de total/
--    updated_at y las re-recepciones que siguen parciales pasan libres.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_validar_transicion_pedido()
returns trigger language plpgsql as $$
begin
  if new.estado is distinct from old.estado then
    if not (
      (old.estado = 'borrador'          and new.estado in ('enviado', 'cancelado')) or
      (old.estado = 'enviado'           and new.estado in ('recibido', 'recepcion_parcial', 'cancelado')) or
      (old.estado = 'recepcion_parcial' and new.estado = 'recibido')
    ) then
      raise exception 'Transición de estado de pedido inválida: % → %', old.estado, new.estado;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists pedidos_validar_transicion on public.pedidos;
create trigger pedidos_validar_transicion
  before update on public.pedidos
  for each row execute procedure public.fn_validar_transicion_pedido();

-- ─────────────────────────────────────────────────────────────────────
-- 2) fn_recibir_pedido — recepción ACUMULATIVA
--    Idéntica a la 051 salvo: la cantidad recibida suma en vez de pisar,
--    y monto/total se recalculan desde el acumulado real de items_pedido.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_recibir_pedido(
  p_pedido_id integer,
  p_proveedor_id integer,
  p_usuario_id uuid,
  p_condicion_pago_dias integer,
  p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_ahora timestamptz := now();
  v_item jsonb;
  v_item_id integer;
  v_prod_id integer;
  v_cant integer;
  v_precio numeric;
  v_venc date;
  v_stock_ant integer;
  v_stock_nuevo integer;
  v_cuenta_id integer;
  v_costo_ant numeric;
  v_var_pct numeric;
  v_umbral numeric;
  v_variaciones jsonb := '[]'::jsonb;
  v_total_acumulado numeric := 0;
  v_total_pedido integer;
  v_total_recibido_unid integer;
  v_estado text;
begin
  select coalesce(umbral_variacion_costo, 10) into v_umbral
    from public.config_compras where id = 1;
  v_umbral := coalesce(v_umbral, 10);

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_item_id := (v_item->>'item_id')::integer;
    v_prod_id := (v_item->>'producto_id')::integer;
    v_cant := (v_item->>'cantidad_recibida')::integer;
    v_precio := (v_item->>'precio_costo')::numeric;
    v_venc := nullif(v_item->>'fecha_vencimiento', '')::date;

    -- ACUMULA: suma lo recibido ahora a lo que ya había. El subtotal del
    -- item queda en el valor recibido acumulado (usa el costo del item).
    update public.items_pedido
      set cantidad_recibida = coalesce(cantidad_recibida, 0) + v_cant,
          subtotal = (coalesce(cantidad_recibida, 0) + v_cant) * precio_costo
      where id = v_item_id;

    if v_cant <= 0 then continue; end if;

    select stock_actual into v_stock_ant
      from public.productos where id = v_prod_id for update;
    v_stock_ant := coalesce(v_stock_ant, 0);
    v_costo_ant := public.fn_costo(v_prod_id);
    v_stock_nuevo := v_stock_ant + v_cant;
    update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora
      where id = v_prod_id;

    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
      referencia_id, usuario_id, nota
    ) values (
      v_prod_id, 'entrada', v_cant, v_stock_ant, v_stock_nuevo,
      p_pedido_id, p_usuario_id, 'Recepción de pedido #' || p_pedido_id
    );

    if v_venc is not null then
      insert into public.lotes (
        producto_id, fecha_vencimiento, cantidad_inicial, cantidad_actual, estado, pedido_origen_id
      ) values (v_prod_id, v_venc, v_cant, v_cant, 'activo', p_pedido_id);
    end if;

    if v_costo_ant > 0 and v_precio > 0 then
      v_var_pct := round(((v_precio - v_costo_ant) / v_costo_ant) * 100, 2);
    else v_var_pct := 0; end if;

    if v_var_pct <> 0 then
      insert into public.historial_costos (
        producto_id, proveedor_id, costo_anterior, costo_nuevo,
        variacion_pct, origen, pedido_id, usuario_id
      ) values (
        v_prod_id, p_proveedor_id, v_costo_ant, v_precio,
        v_var_pct, 'recepcion', p_pedido_id, p_usuario_id
      );
      if v_var_pct >= v_umbral then
        v_variaciones := v_variaciones || jsonb_build_object(
          'producto_id', v_prod_id, 'costo_anterior', v_costo_ant,
          'costo_nuevo', v_precio, 'variacion_pct', v_var_pct);
      end if;
    end if;

    insert into public.proveedor_producto (proveedor_id, producto_id, costo, es_principal, updated_at)
    values (p_proveedor_id, v_prod_id, v_precio, false, v_ahora)
    on conflict (proveedor_id, producto_id)
    do update set costo = excluded.costo, updated_at = v_ahora;
  end loop;

  -- Total acumulado real (robusto ante recepciones sucesivas) + unidades
  -- para decidir si el pedido quedó completo o sigue parcial.
  select coalesce(sum(coalesce(cantidad_recibida, 0) * precio_costo), 0),
         coalesce(sum(cantidad_pedida), 0),
         coalesce(sum(coalesce(cantidad_recibida, 0)), 0)
    into v_total_acumulado, v_total_pedido, v_total_recibido_unid
    from public.items_pedido where pedido_id = p_pedido_id;

  if v_total_recibido_unid >= v_total_pedido then v_estado := 'recibido';
  else v_estado := 'recepcion_parcial'; end if;

  update public.pedidos
    set estado = v_estado::public.estado_pedido, total = v_total_acumulado, updated_at = v_ahora
    where id = p_pedido_id;

  -- Cuenta a pagar provisoria: reusa la que no tiene factura (recepciones
  -- previas del mismo pedido) y la deja con el monto acumulado real.
  select id into v_cuenta_id from public.cuentas_a_pagar
    where pedido_id = p_pedido_id and tiene_factura = false
    order by id desc limit 1;
  if v_cuenta_id is null then
    insert into public.cuentas_a_pagar (
      pedido_id, proveedor_id, monto, fecha_vencimiento, estado, provisoria, tiene_factura
    ) values (
      p_pedido_id, p_proveedor_id, v_total_acumulado,
      current_date + p_condicion_pago_dias, 'pendiente', true, false
    ) returning id into v_cuenta_id;
  else
    update public.cuentas_a_pagar
      set monto = v_total_acumulado, proveedor_id = p_proveedor_id,
          fecha_vencimiento = current_date + p_condicion_pago_dias
      where id = v_cuenta_id;
  end if;

  return jsonb_build_object(
    'cuenta_a_pagar_id', v_cuenta_id, 'total_recibido', v_total_acumulado,
    'es_parcial', (v_estado = 'recepcion_parcial'), 'variaciones', v_variaciones
  );
end;
$$;

notify pgrst, 'reload schema';
