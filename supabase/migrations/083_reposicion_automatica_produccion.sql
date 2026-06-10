-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 083 · Reposición automática de producción                ║
-- ║                                                                     ║
-- ║  Cuando un producto elaborado/semi-elaborado (con receta activa)    ║
-- ║  cae por debajo de su stock mínimo, se crea AUTOMÁTICAMENTE una     ║
-- ║  orden de producción en BORRADOR (no toca insumos hasta que el      ║
-- ║  encargado la inicia). Cantidad = stock_minimo - stock_actual.      ║
-- ║                                                                     ║
-- ║  Implementado con un TRIGGER sobre productos.stock_actual (se       ║
-- ║  dispara en el momento, ej. cuando una venta baja el stock), en     ║
-- ║  lugar de un cron periódico: inmediato y sin infra extra. El        ║
-- ║  trigger es best-effort (envuelto en exception handler) → NUNCA     ║
-- ║  rompe la venta/producción que lo disparó.                          ║
-- ║                                                                     ║
-- ║  Dedup: no crea una orden si ya hay una abierta (borrador/iniciada) ║
-- ║  para ese producto. fn_generar_ordenes_reposicion() (bulk) sirve    ║
-- ║  para el botón "Generar reposición" y para los que ya están bajo    ║
-- ║  el mínimo al momento de configurar.                                ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Genera (si corresponde) la orden de reposición de UN producto.
--    Devuelve el id de la orden creada, o null si no aplica.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_generar_orden_reposicion(p_producto_id integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_prod record;
  v_receta_id integer;
  v_cant numeric;
  v_orden_id integer;
begin
  select id, stock_actual, stock_minimo, tipo, coalesce(controlar_stock, true) as controlar,
         coalesce(activo, true) as activo
    into v_prod
    from public.productos where id = p_producto_id;
  if not found then return null; end if;

  -- Solo elaborados/semi activos que controlan stock y están bajo el mínimo.
  if not v_prod.activo then return null; end if;
  if v_prod.tipo not in ('elaborado', 'semi_elaborado') then return null; end if;
  if not v_prod.controlar then return null; end if;
  if coalesce(v_prod.stock_minimo, 0) <= 0 then return null; end if;
  if coalesce(v_prod.stock_actual, 0) >= coalesce(v_prod.stock_minimo, 0) then return null; end if;

  -- Necesita receta activa para poder producirse.
  select id into v_receta_id
    from public.recetas where producto_id = p_producto_id and activa = true;
  if v_receta_id is null then return null; end if;

  -- Dedup: ya hay una orden abierta para este producto.
  if exists (
    select 1 from public.ordenes_produccion
    where producto_id = p_producto_id and estado in ('borrador', 'iniciada')
  ) then
    return null;
  end if;

  v_cant := coalesce(v_prod.stock_minimo, 0) - coalesce(v_prod.stock_actual, 0);
  if v_cant <= 0 then return null; end if;

  insert into public.ordenes_produccion (
    producto_id, receta_id, cantidad_planificada, estado, nota
  ) values (
    p_producto_id, v_receta_id, v_cant, 'borrador',
    'Reposición automática (stock bajo el mínimo)'
  ) returning id into v_orden_id;

  return v_orden_id;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Bulk: recorre todos los elaborados/semi bajo el mínimo y genera las
--    órdenes que falten. Devuelve cuántas creó. (Botón "Generar reposición")
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_generar_ordenes_reposicion()
returns integer language plpgsql security definer set search_path = public as $$
declare v_p record; v_count integer := 0; v_id integer;
begin
  for v_p in
    select id from public.productos
    where coalesce(activo, true) = true
      and tipo in ('elaborado', 'semi_elaborado')
      and coalesce(controlar_stock, true) = true
      and coalesce(stock_minimo, 0) > 0
      and coalesce(stock_actual, 0) < coalesce(stock_minimo, 0)
  loop
    v_id := public.fn_generar_orden_reposicion(v_p.id);
    if v_id is not null then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end $$;

grant execute on function public.fn_generar_ordenes_reposicion() to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Trigger: al bajar el stock de un producto, intenta reponer.
--    Best-effort: si algo falla, NO rompe la operación que lo disparó.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_trg_reposicion_produccion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if coalesce(new.stock_actual, 0) < coalesce(new.stock_minimo, 0)
       and new.tipo in ('elaborado', 'semi_elaborado')
       and coalesce(new.controlar_stock, true) then
      perform public.fn_generar_orden_reposicion(new.id);
    end if;
  exception when others then
    null; -- nunca romper la venta/producción que disparó el update
  end;
  return new;
end $$;

drop trigger if exists trg_reposicion_produccion on public.productos;
create trigger trg_reposicion_produccion
  after update of stock_actual on public.productos
  for each row execute function public.fn_trg_reposicion_produccion();

notify pgrst, 'reload schema';
