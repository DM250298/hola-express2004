-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Hola! Express — BACKFILL: stock de los renglones EXTRA de facturas  ║
-- ║  ya cargadas (reparación histórica de la migración 166)              ║
-- ║                                                                      ║
-- ║  QUÉ PASÓ: hasta la mig 166, un producto agregado a la factura que   ║
-- ║  no estaba en la orden ("Extra (no pedido)") NO movía stock: nadie   ║
-- ║  lo recibió y la RPC solo reconciliaba los renglones de la orden.    ║
-- ║  Esas facturas quedaron con costo y precio cargados, pero el         ║
-- ║  producto en stock 0.                                                ║
-- ║                                                                      ║
-- ║  QUÉ HACE ESTE SCRIPT: suma a stock lo que esas facturas ya          ║
-- ║  facturaron, deja el movimiento de stock correspondiente (auditable) ║
-- ║  y marca la línea con cantidad_stock_aplicada, para que anular esa   ║
-- ║  factura más adelante lo pueda revertir.                             ║
-- ║                                                                      ║
-- ║  NO toca: precios, costos, deudas, asientos ni lotes (los extras no  ║
-- ║  tienen vencimiento cargado; si hace falta, se crea el lote a mano   ║
-- ║  desde Vencimientos).                                                ║
-- ║                                                                      ║
-- ║  REQUIERE: migración 166 corrida (la columna cantidad_stock_aplicada).║
-- ║                                                                      ║
-- ║  CÓMO USAR (SQL Editor de Supabase):                                 ║
-- ║   1) Corré el PASO 1 y REVISÁ la lista: es todo lo que se va a       ║
-- ║      sumar. Si algún producto ya lo ajustaron a mano, sacalo del     ║
-- ║      backfill agregando su id al filtro del PASO 2.                  ║
-- ║   2) Poné tu email en el PASO 2 y corrélo (atómico: si falla, no     ║
-- ║      cambia nada). Es re-ejecutable: solo toca líneas en 0.          ║
-- ║   3) Corré el PASO 3 para verificar cómo quedó.                      ║
-- ╚════════════════════════════════════════════════════════════════════╝


-- ─────────────────────────────────────────────────────────────────────
-- PASO 1 · DIAGNÓSTICO (solo lectura): qué extras nunca entraron a stock
-- ─────────────────────────────────────────────────────────────────────
select
  fc.cuenta_id,
  fc.pedido_id,
  fc.fecha                                    as fecha_factura,
  coalesce(fc.tipo_comprobante, '?') || ' '
    || coalesce(fc.punto_venta, '?') || '-'
    || coalesce(fc.numero_comprobante, '?')   as comprobante,
  pr.nombre                                   as proveedor,
  ifc.producto_id,
  p.nombre                                    as producto,
  p.codigo_barras,
  ifc.cantidad                                as cantidad_facturada,
  p.stock_actual                              as stock_hoy,
  p.stock_actual + ifc.cantidad               as stock_si_se_aplica
from public.items_factura_compra ifc
join public.facturas_compra fc on fc.id = ifc.factura_id
join public.productos p on p.id = ifc.producto_id
left join public.proveedores pr on pr.id = fc.proveedor_id
where fc.cuenta_id is not null                    -- circuito con orden
  and not coalesce(fc.es_directa, false)          -- la compra directa mueve su propio stock
  and ifc.producto_id is not null
  and ifc.cantidad_stock_aplicada = 0             -- todavía no aplicado
  and ifc.cantidad <> 0
  and not exists (                                -- EXTRA: sin renglón en la orden
    select 1 from public.items_pedido ip
     where ip.pedido_id = fc.pedido_id
       and ip.producto_id = ifc.producto_id
  )
order by fc.fecha desc, fc.cuenta_id, ifc.id;


-- ─────────────────────────────────────────────────────────────────────
-- PASO 2 · BACKFILL (escribe). Atómico: o entra todo, o no entra nada.
-- ─────────────────────────────────────────────────────────────────────
do $$
declare
  -- ⚠️ PONÉ ACÁ TU EMAIL: queda como autor de los movimientos de stock.
  v_email text := 'damianmiranday25@gmail.com';
  v_usuario uuid;
  v_fila record;
  v_stock_ant numeric;
  v_stock_nuevo numeric;
  v_filas integer := 0;
begin
  select id into v_usuario from public.usuarios where email = v_email;
  if v_usuario is null then
    raise exception 'No encontré el usuario % en la tabla usuarios.', v_email;
  end if;

  for v_fila in
    select ifc.id, ifc.producto_id, ifc.cantidad, fc.cuenta_id
      from public.items_factura_compra ifc
      join public.facturas_compra fc on fc.id = ifc.factura_id
     where fc.cuenta_id is not null
       and not coalesce(fc.es_directa, false)
       and ifc.producto_id is not null
       and ifc.cantidad_stock_aplicada = 0
       and ifc.cantidad <> 0
       and not exists (
         select 1 from public.items_pedido ip
          where ip.pedido_id = fc.pedido_id
            and ip.producto_id = ifc.producto_id
       )
       -- Para saltear un producto ya ajustado a mano, sumalo acá:
       -- and ifc.producto_id not in (1234, 5678)
     order by ifc.id
  loop
    select stock_actual into v_stock_ant
      from public.productos where id = v_fila.producto_id for update;
    v_stock_ant := coalesce(v_stock_ant, 0);
    v_stock_nuevo := v_stock_ant + v_fila.cantidad;

    update public.productos
       set stock_actual = v_stock_nuevo, updated_at = now()
     where id = v_fila.producto_id;

    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
      referencia_id, usuario_id, nota
    ) values (
      v_fila.producto_id, 'entrada'::public.tipo_movimiento,
      v_fila.cantidad, v_stock_ant, v_stock_nuevo,
      v_fila.cuenta_id, v_usuario,
      'Backfill mig 166 · extra de factura (cuenta #' || v_fila.cuenta_id || ')'
    );

    -- Marcar la línea: sin esto, anular la factura no sabría cuánto sacar.
    update public.items_factura_compra
       set cantidad_stock_aplicada = v_fila.cantidad
     where id = v_fila.id;

    v_filas := v_filas + 1;
  end loop;

  raise notice 'Backfill listo: % renglones extra aplicados al stock.', v_filas;
end $$;


-- ─────────────────────────────────────────────────────────────────────
-- PASO 3 · VERIFICACIÓN: no debe quedar ningún extra sin aplicar
-- ─────────────────────────────────────────────────────────────────────
select
  count(*) filter (where ifc.cantidad_stock_aplicada = 0) as extras_sin_aplicar,
  count(*)                                                as extras_totales
from public.items_factura_compra ifc
join public.facturas_compra fc on fc.id = ifc.factura_id
where fc.cuenta_id is not null
  and not coalesce(fc.es_directa, false)
  and ifc.producto_id is not null
  and ifc.cantidad <> 0
  and not exists (
    select 1 from public.items_pedido ip
     where ip.pedido_id = fc.pedido_id
       and ip.producto_id = ifc.producto_id
  );

-- Los movimientos que dejó el backfill (para auditar / revertir a mano):
-- select * from public.movimientos_stock
--  where nota like 'Backfill mig 166%' order by id desc;
