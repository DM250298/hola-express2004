-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 018 · FASE 0 — Operaciones atómicas: conteo y ajuste     ║
-- ║                                                                     ║
-- ║  · fn_aprobar_conteo    → aplica el conteo al stock                 ║
-- ║  · fn_crear_ajuste_stock → registra un ajuste multi-producto        ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── Aprobar conteo de mercadería ───────────────────────────────────
create or replace function public.fn_aprobar_conteo(
  p_conteo_id integer,
  p_aprobador_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
  v_ahora timestamptz := now();
  v_item record;
  v_stock_ant integer;
begin
  select estado into v_estado
    from public.conteos where id = p_conteo_id for update;
  if v_estado is null then
    raise exception 'El conteo no existe.';
  end if;
  if v_estado <> 'contado' then
    raise exception 'Solo se puede aprobar un conteo que ya fue contado.';
  end if;

  for v_item in
    select producto_id, cantidad_contada
      from public.conteos_items
      where conteo_id = p_conteo_id and cantidad_contada is not null
  loop
    select stock_actual into v_stock_ant
      from public.productos where id = v_item.producto_id for update;
    if v_stock_ant is null then
      continue;
    end if;
    if v_item.cantidad_contada = v_stock_ant then
      continue;
    end if;
    update public.productos
      set stock_actual = v_item.cantidad_contada, updated_at = v_ahora
      where id = v_item.producto_id;
    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
      referencia_id, usuario_id, nota
    ) values (
      v_item.producto_id, 'ajuste',
      abs(v_item.cantidad_contada - v_stock_ant),
      v_stock_ant, v_item.cantidad_contada,
      p_conteo_id, p_aprobador_id, 'Conteo #' || p_conteo_id || ' aprobado'
    );
  end loop;

  update public.conteos
    set estado = 'aprobado',
        usuario_aprobador = p_aprobador_id,
        fecha_aprobacion = v_ahora
    where id = p_conteo_id;
end;
$$;

-- ─── Crear ajuste de stock multi-producto ───────────────────────────
create or replace function public.fn_crear_ajuste_stock(
  p_usuario_id uuid,
  p_razon text,
  p_razon_detalle text,
  p_items jsonb
) returns public.ajustes_stock
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ahora timestamptz := now();
  v_ajuste public.ajustes_stock;
  v_item jsonb;
  v_prod_id integer;
  v_tipo text;
  v_cantidad integer;
  v_stock_ant integer;
  v_costo numeric;
  v_stock_final integer;
  v_diferencia integer;
  v_subtotal numeric;
  v_mov_cant integer;
  v_total numeric := 0;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un producto al ajuste.';
  end if;

  insert into public.ajustes_stock (
    usuario_id, razon, razon_detalle, total_costo, cantidad_items
  ) values (
    p_usuario_id, p_razon, p_razon_detalle, 0, jsonb_array_length(p_items)
  )
  returning * into v_ajuste;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_prod_id := (v_item->>'producto_id')::integer;
    v_tipo := v_item->>'tipo';
    v_cantidad := (v_item->>'cantidad')::integer;

    if v_cantidad is null or v_cantidad < 0 then
      raise exception 'Cantidad inválida en un producto del ajuste.';
    end if;

    select stock_actual, coalesce(precio_costo, 0)
      into v_stock_ant, v_costo
      from public.productos where id = v_prod_id for update;
    if v_stock_ant is null then
      raise exception 'Producto inexistente en el ajuste.';
    end if;

    if v_tipo = 'entrada' then
      v_stock_final := v_stock_ant + v_cantidad;
    elsif v_tipo = 'salida' then
      v_stock_final := v_stock_ant - v_cantidad;
    else
      v_stock_final := v_cantidad;
    end if;

    if v_stock_final < 0 then
      raise exception 'El ajuste dejaría el stock negativo en un producto.';
    end if;

    v_diferencia := abs(v_stock_final - v_stock_ant);
    v_subtotal := v_diferencia * v_costo;
    v_total := v_total + v_subtotal;
    v_mov_cant := case when v_tipo = 'ajuste' then v_diferencia else v_cantidad end;

    update public.productos
      set stock_actual = v_stock_final, updated_at = v_ahora
      where id = v_prod_id;

    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
      referencia_id, usuario_id, nota
    ) values (
      v_prod_id, v_tipo, v_mov_cant, v_stock_ant, v_stock_final,
      v_ajuste.id, p_usuario_id, 'Ajuste #' || v_ajuste.id || ' · ' || p_razon
    );

    insert into public.items_ajuste_stock (
      ajuste_id, producto_id, tipo, cantidad,
      stock_anterior, stock_final, costo_unitario, subtotal
    ) values (
      v_ajuste.id, v_prod_id, v_tipo, v_cantidad,
      v_stock_ant, v_stock_final, v_costo, v_subtotal
    );
  end loop;

  update public.ajustes_stock
    set total_costo = v_total where id = v_ajuste.id;
  v_ajuste.total_costo := v_total;
  return v_ajuste;
end;
$$;

notify pgrst, 'reload schema';
