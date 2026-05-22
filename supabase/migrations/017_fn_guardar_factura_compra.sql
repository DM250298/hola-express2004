-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 017 · FASE 0 — Operación atómica: guardar factura compra ║
-- ║                                                                     ║
-- ║  Reemplaza la factura previa, recalcula totales, actualiza el       ║
-- ║  costo (y opcionalmente el precio de venta) de cada producto, el    ║
-- ║  pedido y la cuenta a pagar — todo en una única transacción.        ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_guardar_factura_compra(
  p_cuenta_id integer,
  p_pedido_id integer,
  p_proveedor_id integer,
  p_fecha date,
  p_afecta_precio_venta boolean,
  p_usuario_id uuid,
  p_lineas jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ahora timestamptz := now();
  v_linea jsonb;
  v_neto numeric := 0;
  v_iva_total numeric := 0;
  v_total numeric := 0;
  v_factura_id integer;
  v_prod_id integer;
  v_costo_sin_iva numeric;
  v_desc numeric;
  v_iva_compra numeric;
  v_margen numeric;
  v_iva_venta numeric;
  v_cant numeric;
  v_costo_neto numeric;
  v_costo_con_iva numeric;
  v_precio_sin_iva numeric;
  v_precio_con_iva numeric;
begin
  -- 1. Borrar la factura previa de esta cuenta (cascade borra sus items)
  delete from public.facturas_compra where cuenta_id = p_cuenta_id;

  -- 2. Pre-calcular totales
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
  v_neto := round(v_neto, 2);
  v_iva_total := round(v_iva_total, 2);
  v_total := round(v_neto + v_iva_total, 2);

  -- 3. Cabecera de la factura
  insert into public.facturas_compra (
    cuenta_id, pedido_id, proveedor_id, fecha,
    neto, iva_total, total, afecta_precio_venta, usuario_id
  ) values (
    p_cuenta_id, p_pedido_id, p_proveedor_id, p_fecha,
    v_neto, v_iva_total, v_total, p_afecta_precio_venta, p_usuario_id
  )
  returning id into v_factura_id;

  -- 4. Items de la factura + productos + items del pedido
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

    insert into public.items_factura_compra (
      factura_id, producto_id, cantidad, costo_sin_iva,
      descuento_porcentaje, iva_compra_porcentaje, costo_con_iva,
      margen_porcentaje, iva_venta_porcentaje, precio_sin_iva, precio_con_iva
    ) values (
      v_factura_id, v_prod_id, v_cant, v_costo_sin_iva,
      v_desc, v_iva_compra, v_costo_con_iva,
      v_margen, v_iva_venta, v_precio_sin_iva, v_precio_con_iva
    );

    if p_afecta_precio_venta then
      update public.productos
        set precio_costo = v_costo_neto,
            precio_venta = v_precio_con_iva,
            updated_at = v_ahora
        where id = v_prod_id;
    else
      update public.productos
        set precio_costo = v_costo_neto, updated_at = v_ahora
        where id = v_prod_id;
    end if;

    update public.items_pedido
      set precio_costo = v_costo_neto,
          subtotal = round(v_costo_neto * v_cant, 2)
      where id = (v_linea->>'item_pedido_id')::integer;
  end loop;

  -- 5. Pedido y cuenta a pagar
  update public.pedidos
    set total = v_total, updated_at = v_ahora
    where id = p_pedido_id;
  update public.cuentas_a_pagar
    set monto = v_total
    where id = p_cuenta_id;
end;
$$;

notify pgrst, 'reload schema';
