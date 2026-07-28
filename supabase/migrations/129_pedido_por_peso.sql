-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 129 · Pedir (crear/editar OC) por peso en kg             ║
-- ║                                                                     ║
-- ║  La recepción ya recibe por peso (migs 062/076 pasaron el circuito  ║
-- ║  de compra a numeric). Faltaba el lado de PEDIR: crear una OC con    ║
-- ║  cantidad decimal (ej. 4,7 kg de queso) y editarla sin perder los   ║
-- ║  decimales. El create path (crearPedido) inserta directo y ya       ║
-- ║  soporta numeric; el que rompía era el RPC de edición:              ║
-- ║  fn_actualizar_pedido (mig 116) casteaba cantidad_pedida a          ║
-- ║  ::integer y truncaba el peso (4,7 → 4).                            ║
-- ║                                                                     ║
-- ║  1) Idempotente: re-asegura items_pedido.cantidad_pedida /          ║
-- ║     cantidad_recibida en numeric(12,3) (no-op si la 076 ya corrió;  ║
-- ║     ninguna vista referencia estas columnas).                       ║
-- ║  2) Reissue de fn_actualizar_pedido = 116 con los 3 casts de        ║
-- ║     cantidad_pedida en ::numeric (firma IDÉNTICA → CREATE OR        ║
-- ║     REPLACE reemplaza limpio; no cambia types/database.ts).         ║
-- ║                                                                     ║
-- ║  Correr DESPUÉS de la 115 (columna terminos_pago) y la 116. Si ya   ║
-- ║  corriste la 116, esta la supersede con soporte de decimales.       ║
-- ║  Ejecutar UNA vez, COMPLETO, en el SQL Editor de Supabase.          ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Columnas de cantidad → numeric(12,3) (idempotente)
--    Los CHECK existentes (> 0, >= 0) siguen válidos sobre numeric.
-- ─────────────────────────────────────────────────────────────────────
alter table public.items_pedido alter column cantidad_pedida   type numeric(12,3);
alter table public.items_pedido alter column cantidad_recibida type numeric(12,3);

-- ─────────────────────────────────────────────────────────────────────
-- 2. fn_actualizar_pedido (base 116) con cantidad_pedida numeric
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_actualizar_pedido(
  p_pedido_id integer,
  p_proveedor_id integer,
  p_fecha_entrega text,
  p_terminos_pago text,
  p_estado text,
  p_items jsonb
) returns public.pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido public.pedidos;
  v_total numeric(12, 2) := 0;
  v_item jsonb;
begin
  -- Lock + guarda de estado: sólo se editan órdenes no recibidas.
  select * into v_pedido from public.pedidos where id = p_pedido_id for update;
  if not found then
    raise exception 'El pedido % no existe.', p_pedido_id;
  end if;
  if v_pedido.estado::text not in ('borrador', 'enviado') then
    raise exception 'El pedido % ya no se puede editar (estado: %).',
      p_pedido_id, v_pedido.estado;
  end if;
  if p_estado not in ('borrador', 'enviado') then
    raise exception 'Estado destino inválido: %.', p_estado;
  end if;

  -- Total a partir de los items enviados (cantidad puede ser decimal por kg).
  select coalesce(
           sum((it->>'cantidad_pedida')::numeric * (it->>'precio_costo')::numeric),
           0
         )
    into v_total
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as it;

  update public.pedidos
     set proveedor_id = p_proveedor_id,
         fecha_entrega_esperada = nullif(p_fecha_entrega, '')::date,
         terminos_pago = nullif(p_terminos_pago, ''),
         estado = p_estado::public.estado_pedido,
         total = v_total,
         updated_at = now()
   where id = p_pedido_id
   returning * into v_pedido;

  -- Reemplazo total de items. Seguro porque una orden no recibida no tiene
  -- lotes ni cuentas a pagar colgando de sus items.
  delete from public.items_pedido where pedido_id = p_pedido_id;

  for v_item in
    select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into public.items_pedido
      (pedido_id, producto_id, cantidad_pedida, cantidad_recibida, precio_costo, subtotal)
    values (
      p_pedido_id,
      (v_item->>'producto_id')::integer,
      (v_item->>'cantidad_pedida')::numeric,
      null,
      (v_item->>'precio_costo')::numeric,
      (v_item->>'cantidad_pedida')::numeric * (v_item->>'precio_costo')::numeric
    );
  end loop;

  return v_pedido;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. fn_productos_a_reponer (base 110) + venta_por_peso, para que la
--    pestaña Reposición sepa qué productos van por kg y el handoff al
--    editor de OC los cargue con la unidad correcta. Cambia la firma de
--    retorno → hay que dropear y recrear. El cliente tiene fallback
--    client-side si esta función no está en el schema cache (PGRST202).
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_productos_a_reponer(integer);

create function public.fn_productos_a_reponer(p_proveedor_id integer default null)
returns table (
  id integer,
  nombre text,
  codigo_barras text,
  precio_costo numeric,
  stock_actual numeric,
  stock_minimo integer,
  proveedor_id integer,
  proveedor_nombre text,
  venta_por_peso boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.nombre::text,
    p.codigo_barras::text,
    case
      when (select public.fn_tiene_permiso('costos'))
        then coalesce(c.precio_costo, 0)
      else 0
    end as precio_costo,
    p.stock_actual,
    p.stock_minimo,
    p.proveedor_id,
    pr.nombre::text as proveedor_nombre,
    p.venta_por_peso
  from public.productos p
  left join public.costos_producto c on c.producto_id = p.id
  left join public.proveedores pr on pr.id = p.proveedor_id
  where p.activo
    and p.stock_actual < p.stock_minimo
    and (p_proveedor_id is null or p.proveedor_id = p_proveedor_id)
  order by lower(p.nombre)
$$;

revoke execute on function public.fn_productos_a_reponer(integer) from public, anon;
grant execute on function public.fn_productos_a_reponer(integer) to authenticated;

notify pgrst, 'reload schema';
