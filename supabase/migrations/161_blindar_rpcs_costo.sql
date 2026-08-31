-- RENUMERADA: se escribió como 099 el 2026-07-07 pero nunca se aplicó.
-- Diagnóstico del 2026-08-31 lo confirmó contra el catálogo de Postgres, así que
-- pasa al próximo número libre. Ver supabase/MIGRACIONES.md.
-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 161 · Blindaje de RPCs de costo (residual R1.2)          ║
-- ║                                                                     ║
-- ║  Auditoría 2026-07-07: fn_costo y fn_costo_receta son security      ║
-- ║  definer con execute para authenticated → cualquier usuario sin el  ║
-- ║  permiso 'costos' (cajero/fiambrero desde la 096) podía leer el     ║
-- ║  costo con POST /rest/v1/rpc/fn_costo, salteando el gate RLS de     ║
-- ║  costos_producto (R1.2). fn_set_costo nunca tuvo grant explícito    ║
-- ║  pero el default EXECUTE de Postgres / default privileges de        ║
-- ║  Supabase la exponían igual — y esa ESCRIBE el costo.               ║
-- ║                                                                     ║
-- ║  · fn_costo / fn_set_costo → revoke total. Solo uso interno. Las    ║
-- ║    RPCs definer que las llaman (fn_crear_venta, fn_recibir_pedido,  ║
-- ║    fn_guardar_factura_compra, fn_orden_produccion, conteo físico,   ║
-- ║    etc.) NO se rompen: dentro de una función definer el chequeo de  ║
-- ║    EXECUTE se hace contra el owner (postgres), no contra el caller. ║
-- ║    Verificado: ninguna función invoker-rights, vista ni policy las  ║
-- ║    usa, y el frontend nunca las llama por rpc().                    ║
-- ║  · fn_costo_receta → la UI de recetas SÍ la llama directo (preview  ║
-- ║    on-read, lib/queries/produccion.ts), no se puede revocar sin     ║
-- ║    romper Producción. Se reissuea con gate interno: exige permiso   ║
-- ║    'produccion' o 'costos' (admin pasa siempre), coherente con la   ║
-- ║    096 (Producción excluida del enmascarado de costos).             ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. fn_costo / fn_set_costo: solo uso interno ─────────────────────
-- El revoke from public pisa el EXECUTE default de Postgres; anon y
-- authenticated cubren además los default privileges de Supabase.
revoke execute on function public.fn_costo(integer)
  from public, anon, authenticated;
revoke execute on function public.fn_set_costo(integer, numeric)
  from public, anon, authenticated;

-- ─── 2. fn_costo_receta: reissue con gate interno de permisos ─────────
-- Idéntica a la 080 salvo el chequeo al entrar. El gate corre también en
-- las llamadas recursivas (mismo auth.uid(), pasa igual); llamada desde
-- otra definer se evalúa contra el usuario final, no contra postgres.
create or replace function public.fn_costo_receta(
  p_producto_id integer, p_depth integer default 0
) returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  v_costo numeric := 0;
  v_rend numeric;
  v_ing record;
  v_costo_ing numeric;
  v_cant_stock numeric;
  v_unidad_insumo text;
begin
  if not (public.fn_tiene_permiso('produccion') or public.fn_tiene_permiso('costos')) then
    raise exception 'No tenés permiso para ver costos.';
  end if;

  if p_depth > 20 then
    raise exception 'Receta con ciclo o demasiado profunda (producto %).', p_producto_id;
  end if;

  select rendimiento into v_rend
    from public.recetas where producto_id = p_producto_id and activa = true;
  -- Sin receta activa: es un insumo hoja, su costo es el de costos_producto.
  if v_rend is null then
    return public.fn_costo(p_producto_id);
  end if;

  for v_ing in
    select ri.insumo_id, ri.cantidad, ri.unidad, ri.merma_pct
    from public.receta_ingredientes ri
    join public.recetas r on r.id = ri.receta_id
    where r.producto_id = p_producto_id and r.activa = true
  loop
    -- Costo del insumo: recursivo si es semi con receta, si no costo directo.
    if exists (select 1 from public.recetas where producto_id = v_ing.insumo_id and activa = true) then
      v_costo_ing := public.fn_costo_receta(v_ing.insumo_id, p_depth + 1);
    else
      v_costo_ing := public.fn_costo(v_ing.insumo_id);
    end if;

    -- Cantidad de receta convertida a la unidad de stock del insumo.
    select unidad into v_unidad_insumo from public.productos where id = v_ing.insumo_id;
    v_cant_stock := public.fn_convertir_unidad(v_ing.cantidad, v_ing.unidad, v_unidad_insumo);

    v_costo := v_costo + (v_cant_stock * (1 + v_ing.merma_pct / 100.0)) * v_costo_ing;
  end loop;

  return case when v_rend > 0 then v_costo / v_rend else 0 end;
end $$;

-- Sin acceso anónimo ni EXECUTE default; authenticated la puede llamar
-- pero el gate interno decide quién ve el costo.
revoke execute on function public.fn_costo_receta(integer, integer)
  from public, anon;
grant execute on function public.fn_costo_receta(integer, integer) to authenticated;

notify pgrst, 'reload schema';
