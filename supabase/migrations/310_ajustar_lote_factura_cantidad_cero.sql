-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  310 · fn_ajustar_lote_factura v2: la factura puede dejar un         ║
-- ║  renglón en 0 sin romper el check de lotes                           ║
-- ╚══════════════════════════════════════════════════════════════════════╝
--
-- Problema (pedido #186, oct-2026): al cargar la factura con cantidad 0 en un
-- renglón recibido, fn_guardar_factura_compra llama a fn_ajustar_lote_factura
-- con delta negativo y la v1 (mig 132) hacía
--   cantidad_inicial = greatest(cantidad_inicial - quitar, 0)
-- que deja el lote en cantidad_inicial = 0 y choca con
-- lotes_cantidad_inicial_check ("new row for relation lotes violates…").
-- La factura entera fallaba y la deuda quedaba rezagada en el portal.
--
-- Regla nueva al quitar |delta| de un lote de la orden:
--   · si el lote se queda sin nada por recibir (cantidad_inicial - quitar ≤ 0)
--     y nada lo referencia (ordenes_produccion.lote_id), se BORRA: ese lote
--     nunca entró según la factura;
--   · si está referenciado, se conserva cantidad_inicial como está y se marca
--     agotado con cantidad_actual 0;
--   · en cualquier otro caso, como antes (baja inicial y actual, agota si llega a 0).
-- La rama de delta positivo no cambia. Misma firma → CREATE OR REPLACE.

create or replace function public.fn_ajustar_lote_factura(
  p_producto_id integer,
  p_pedido_id integer,
  p_delta numeric,
  p_venc date
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_lote_id integer;
  v_lote record;
  v_resto numeric;
  v_quitar numeric;
  v_inicial_nueva numeric;
  v_referenciado boolean;
begin
  if p_delta > 0 then
    -- Suma el delta al lote más nuevo de esta orden; si no hay lote y vino
    -- vencimiento, crea uno nuevo. Sin lote y sin vencimiento → solo stock.
    select id into v_lote_id
      from public.lotes
      where producto_id = p_producto_id and pedido_origen_id = p_pedido_id
        and estado = 'activo'::public.estado_lote
      order by id desc
      limit 1;
    if v_lote_id is not null then
      update public.lotes
        set cantidad_inicial = cantidad_inicial + p_delta,
            cantidad_actual  = cantidad_actual  + p_delta,
            fecha_vencimiento = coalesce(p_venc, fecha_vencimiento)
        where id = v_lote_id;
    elsif p_venc is not null then
      insert into public.lotes (
        producto_id, fecha_vencimiento, cantidad_inicial, cantidad_actual,
        estado, pedido_origen_id
      ) values (
        p_producto_id, p_venc, p_delta, p_delta, 'activo'::public.estado_lote, p_pedido_id
      );
    end if;

  elsif p_delta < 0 then
    -- Quita |delta| de los lotes de esta orden, del más nuevo al más viejo,
    -- sin bajar de 0 (no toca porciones ya consumidas por ventas).
    v_resto := -p_delta;
    for v_lote in
      select id, cantidad_actual, cantidad_inicial
        from public.lotes
        where producto_id = p_producto_id and pedido_origen_id = p_pedido_id
          and estado = 'activo'::public.estado_lote and cantidad_actual > 0
        order by id desc
    loop
      exit when v_resto <= 0;
      v_quitar := least(v_lote.cantidad_actual, v_resto);
      v_inicial_nueva := v_lote.cantidad_inicial - v_quitar;

      if v_inicial_nueva <= 0 then
        -- El lote queda sin nada recibido: no puede existir con inicial 0.
        select exists (
          select 1 from public.ordenes_produccion op where op.lote_id = v_lote.id
        ) into v_referenciado;
        if v_referenciado then
          update public.lotes
            set cantidad_actual = 0,
                estado = 'agotado'::public.estado_lote,
                fecha_vencimiento = coalesce(p_venc, fecha_vencimiento)
            where id = v_lote.id;
        else
          delete from public.lotes where id = v_lote.id;
        end if;
      else
        update public.lotes
          set cantidad_actual = cantidad_actual - v_quitar,
              cantidad_inicial = v_inicial_nueva,
              estado = (case when cantidad_actual - v_quitar <= 0
                             then 'agotado' else 'activo' end)::public.estado_lote,
              fecha_vencimiento = coalesce(p_venc, fecha_vencimiento)
          where id = v_lote.id;
      end if;
      v_resto := v_resto - v_quitar;
    end loop;
  end if;
end;
$$;

revoke execute on function public.fn_ajustar_lote_factura(integer, integer, numeric, date) from public, anon;
grant execute on function public.fn_ajustar_lote_factura(integer, integer, numeric, date) to authenticated;

notify pgrst, 'reload schema';
