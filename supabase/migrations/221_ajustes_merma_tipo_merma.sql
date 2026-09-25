-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 221 · Ajustes con razón "merma" se graban como merma     ║
-- ║                                                                     ║
-- ║  fn_crear_ajuste_stock (base 062 ÍNTEGRA) grababa el movimiento de  ║
-- ║  stock con el tipo del renglón (entrada / salida / ajuste) y la     ║
-- ║  razón del ajuste quedaba solo en ajustes_stock.razon y en la nota. ║
-- ║  Una merma cargada por Inventario → Control → Ajustes salía como    ║
-- ║  'salida' y no la veían el reporte de mermas, el resumen de         ║
-- ║  Vencimientos ni el P&L de Finanzas (todos filtran tipo = 'merma'). ║
-- ║                                                                     ║
-- ║  · Regla nueva: razón 'merma' y el stock BAJA (salida, o "fijar     ║
-- ║    stock" por debajo del actual) → movimientos_stock.tipo = 'merma'.║
-- ║    Entradas o "fijar stock" hacia arriba con razón merma quedan     ║
-- ║    como antes. Las demás razones (rotura, vencimiento, robo…) no    ║
-- ║    cambian. items_ajuste_stock.tipo sigue siendo el del renglón     ║
-- ║    (entrada/salida/ajuste): es lo que muestra el detalle del ajuste.║
-- ║  · Identidad (regla 218): p_usuario_id pasa por fn_usuario_efectivo ║
-- ║    (con sesión de usuario manda auth.uid(); service_role y el SQL   ║
-- ║    Editor siguen confiando en el id recibido). Alcanza también al   ║
-- ║    ajuste que arma "Ubicar productos" (207), que llama a esta RPC.  ║
-- ║                                                                     ║
-- ║  Misma firma → create or replace, sin sobrecargas.                  ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor. Primero PRUEBA, ║
-- ║  después PRODUCCIÓN. El backfill del final es OPCIONAL y va aparte. ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. fn_crear_ajuste_stock · base 062 íntegra + bloques "221"
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_crear_ajuste_stock(
  p_usuario_id uuid, p_razon text, p_razon_detalle text, p_items jsonb
) returns public.ajustes_stock
language plpgsql security definer set search_path = public
as $$
declare
  v_ahora timestamptz := now();
  v_ajuste public.ajustes_stock;
  v_item jsonb;
  v_prod_id integer;
  v_tipo text;
  v_tipo_mov public.tipo_movimiento;
  v_cantidad numeric;
  v_stock_ant numeric;
  v_costo numeric;
  v_stock_final numeric;
  v_diferencia numeric;
  v_subtotal numeric;
  v_mov_cant numeric;
  v_total numeric := 0;
begin
  -- ── 221 · IDENTIDAD (regla 218): el ajuste y sus movimientos quedan a
  -- nombre de quien está logueado, no del id que manda la pantalla.
  p_usuario_id := public.fn_usuario_efectivo(p_usuario_id);
  if public.fn_rol_jwt() = 'authenticated' and p_usuario_id is null then
    raise exception 'SESION_CAMBIO: la sesión no es válida. Volvé a iniciar sesión.';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un producto al ajuste.';
  end if;

  insert into public.ajustes_stock (usuario_id, razon, razon_detalle, total_costo, cantidad_items)
  values (p_usuario_id, p_razon, p_razon_detalle, 0, jsonb_array_length(p_items))
  returning * into v_ajuste;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_prod_id := (v_item->>'producto_id')::integer;
    v_tipo := v_item->>'tipo';
    v_cantidad := (v_item->>'cantidad')::numeric;
    if v_cantidad is null or v_cantidad < 0 then
      raise exception 'Cantidad inválida en un producto del ajuste.';
    end if;

    select stock_actual into v_stock_ant from public.productos where id = v_prod_id for update;
    if v_stock_ant is null then raise exception 'Producto inexistente en el ajuste.'; end if;
    v_costo := public.fn_costo(v_prod_id);

    if v_tipo = 'entrada' then v_stock_final := v_stock_ant + v_cantidad;
    elsif v_tipo = 'salida' then v_stock_final := v_stock_ant - v_cantidad;
    else v_stock_final := v_cantidad; end if;
    if v_stock_final < 0 then
      raise exception 'El ajuste dejaría el stock negativo en un producto.';
    end if;

    v_diferencia := abs(v_stock_final - v_stock_ant);
    v_subtotal := v_diferencia * v_costo;
    v_total := v_total + v_subtotal;
    v_mov_cant := case when v_tipo = 'ajuste' then v_diferencia else v_cantidad end;

    -- ── 221 · Una merma declarada que BAJA el stock se registra como
    -- merma (la ven Reportes, Vencimientos y el P&L). Si con razón merma
    -- el stock sube (entrada, o fijar por encima) no es una pérdida:
    -- queda con el tipo del renglón, como siempre.
    v_tipo_mov := case
      when p_razon = 'merma' and v_stock_final < v_stock_ant then 'merma'::public.tipo_movimiento
      else v_tipo::public.tipo_movimiento
    end;

    update public.productos set stock_actual = v_stock_final, updated_at = v_ahora where id = v_prod_id;
    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia_id, usuario_id, nota
    ) values (
      v_prod_id, v_tipo_mov, v_mov_cant, v_stock_ant, v_stock_final,
      v_ajuste.id, p_usuario_id, 'Ajuste #' || v_ajuste.id || ' · ' || p_razon
    );
    insert into public.items_ajuste_stock (
      ajuste_id, producto_id, tipo, cantidad, stock_anterior, stock_final, costo_unitario, subtotal
    ) values (
      v_ajuste.id, v_prod_id, v_tipo, v_cantidad, v_stock_ant, v_stock_final, v_costo, v_subtotal
    );
  end loop;

  update public.ajustes_stock set total_costo = v_total where id = v_ajuste.id;
  v_ajuste.total_costo := v_total;
  return v_ajuste;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Backfill OPCIONAL · NO corre solo (está comentado a propósito)
--
--    Convierte a 'merma' las mermas históricas cargadas por Ajustes que
--    quedaron como salida / ajuste. Cambia el reporte de mermas y el P&L
--    de meses ya cerrados: decidirlo antes de correrlo. La nota
--    'Ajuste #N · merma' identifica sin ambigüedad el movimiento (el
--    referencia_id solo no alcanza: lotes, ventas y órdenes lo reutilizan).
--
--    a) Mirar cuántas son y de qué meses:
--
--    select date_trunc('month', m.created_at)::date as mes,
--           count(*) as movimientos, sum(m.cantidad) as unidades
--      from public.movimientos_stock m
--      join public.ajustes_stock a on a.id = m.referencia_id
--     where a.razon = 'merma'
--       and m.tipo in ('salida', 'ajuste')
--       and m.stock_nuevo < m.stock_anterior
--       and m.nota = 'Ajuste #' || a.id || ' · merma'
--     group by 1 order by 1;
--
--    b) Si se decide convertirlas:
--
--    update public.movimientos_stock m
--       set tipo = 'merma'
--      from public.ajustes_stock a
--     where a.id = m.referencia_id
--       and a.razon = 'merma'
--       and m.tipo in ('salida', 'ajuste')
--       and m.stock_nuevo < m.stock_anterior
--       and m.nota = 'Ajuste #' || a.id || ' · merma';
-- ─────────────────────────────────────────────────────────────────────
