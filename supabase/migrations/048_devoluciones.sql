-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 048 · R2.1 — Devoluciones en POS                         ║
-- ║                                                                     ║
-- ║  El cajero devuelve items de una venta original. Por cada item      ║
-- ║  decide si vuelve al stock (bueno) o va a merma (dañado). El         ║
-- ║  reembolso puede ser efectivo, nota de crédito (vale con código) o  ║
-- ║  reverso a tarjeta (ajusta el clearing).                            ║
-- ║                                                                     ║
-- ║  Todo atómico en fn_crear_devolucion.                               ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── Permiso 'devoluciones' a los 3 roles base ───────────────────────
update public.roles
  set permisos = (
    select array(select distinct unnest(permisos || array['devoluciones']))
  )
  where codigo in ('admin', 'encargado', 'cajero');

-- ─── Notas de crédito (vale con código, saldo a favor del cliente) ────
create table if not exists public.notas_credito (
  id               serial primary key,
  codigo           text not null unique,
  cliente_id       integer references public.clientes(id) on delete set null,
  devolucion_id    integer,
  monto_original   numeric(12,2) not null,
  saldo_disponible numeric(12,2) not null,
  estado           text not null default 'activa',  -- activa | usada | anulada
  fecha_emision    date not null default current_date,
  created_at       timestamptz not null default now()
);
create index if not exists idx_nc_codigo on public.notas_credito(codigo);
create index if not exists idx_nc_estado on public.notas_credito(estado);

-- ─── Cabecera de la devolución ───────────────────────────────────────
create table if not exists public.devoluciones (
  id              serial primary key,
  venta_id        integer references public.ventas(id),
  turno_id        integer references public.caja_turnos(id),
  usuario_id      uuid references public.usuarios(id),
  motivo          text,
  tipo_reembolso  text not null,  -- efectivo | nota_credito | tarjeta
  total_devuelto  numeric(12,2) not null default 0,
  cliente_id      integer references public.clientes(id) on delete set null,
  nota_credito_id integer references public.notas_credito(id) on delete set null,
  egreso_id       integer references public.egresos(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_dev_venta on public.devoluciones(venta_id);
create index if not exists idx_dev_fecha on public.devoluciones(created_at desc);

-- ─── Items devueltos ─────────────────────────────────────────────────
create table if not exists public.items_devolucion (
  id             serial primary key,
  devolucion_id  integer not null references public.devoluciones(id) on delete cascade,
  item_venta_id  integer references public.items_venta(id),
  producto_id    integer references public.productos(id),
  cantidad       integer not null,
  precio_unitario numeric(12,2) not null,
  subtotal       numeric(12,2) not null,
  destino        text not null default 'stock'  -- stock | merma
);
create index if not exists idx_itemdev_dev on public.items_devolucion(devolucion_id);

-- RLS: operativas (no exponen costos/sueldos). Lectura/escritura authenticated.
alter table public.notas_credito enable row level security;
alter table public.devoluciones enable row level security;
alter table public.items_devolucion enable row level security;
do $$ begin
  create policy "todo" on public.notas_credito for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "todo" on public.devoluciones for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "todo" on public.items_devolucion for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- fn_crear_devolucion
--   p_items: [{ item_venta_id, producto_id, cantidad, precio_unitario, destino }]
--   p_tipo_reembolso: 'efectivo' | 'nota_credito' | 'tarjeta'
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_crear_devolucion(
  p_venta_id integer,
  p_usuario_id uuid,
  p_turno_id integer,
  p_motivo text,
  p_tipo_reembolso text,
  p_cliente_id integer,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ahora timestamptz := now();
  v_hoy date := current_date;
  v_venta record;
  v_item jsonb;
  v_iv_id integer;
  v_prod_id integer;
  v_cant integer;
  v_precio numeric;
  v_destino text;
  v_subtotal numeric;
  v_total numeric := 0;
  v_costo_total numeric := 0;
  v_costo_unit numeric;
  v_vendida integer;
  v_ya_dev integer;
  v_stock_ant integer;
  v_stock_nuevo integer;
  v_lote_id integer;
  v_dev_id integer;
  v_nc_id integer;
  v_egreso_id integer;
  v_codigo text;
  -- clearing
  v_rest numeric;
  v_acred record;
  v_nuevo_bruto numeric;
  v_nuevo_com numeric;
  -- asiento
  v_neto numeric;
  v_iva numeric;
  v_asiento_id integer;
  v_cta_ventas integer;
  v_cta_iva integer;
  v_cta_caja integer;
  v_cta_banco integer;
  v_cta_cmv integer;
  v_cta_merc integer;
  v_cta_haber integer;
begin
  select * into v_venta from public.ventas where id = p_venta_id for update;
  if not found then
    raise exception 'La venta no existe.';
  end if;
  if v_venta.estado <> 'completada' then
    raise exception 'Solo se pueden devolver items de ventas completadas.';
  end if;

  -- Procesar cada item
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_iv_id := nullif(v_item->>'item_venta_id','')::integer;
    v_prod_id := (v_item->>'producto_id')::integer;
    v_cant := (v_item->>'cantidad')::integer;
    v_precio := (v_item->>'precio_unitario')::numeric;
    v_destino := coalesce(v_item->>'destino', 'stock');
    if v_cant <= 0 then continue; end if;

    -- Validar que no se devuelva más de lo vendido (menos lo ya devuelto)
    if v_iv_id is not null then
      select cantidad into v_vendida from public.items_venta where id = v_iv_id;
      select coalesce(sum(cantidad),0) into v_ya_dev
        from public.items_devolucion where item_venta_id = v_iv_id;
      if v_cant > coalesce(v_vendida,0) - coalesce(v_ya_dev,0) then
        raise exception 'No se puede devolver más de lo vendido del producto %.', v_prod_id;
      end if;
    end if;

    v_subtotal := v_cant * v_precio;
    v_total := v_total + v_subtotal;

    -- Stock: el producto vuelve (entrada) + repone lote
    select stock_actual, coalesce(precio_costo,0)
      into v_stock_ant, v_costo_unit
      from public.productos where id = v_prod_id for update;
    v_stock_ant := coalesce(v_stock_ant, 0);
    v_costo_total := v_costo_total + v_costo_unit * v_cant;
    v_stock_nuevo := v_stock_ant + v_cant;
    update public.productos set stock_actual = v_stock_nuevo, updated_at = v_ahora
      where id = v_prod_id;
    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
      referencia_id, usuario_id, nota
    ) values (
      v_prod_id, 'entrada', v_cant, v_stock_ant, v_stock_nuevo,
      p_venta_id, p_usuario_id, 'Devolución venta #' || p_venta_id
    );

    select id into v_lote_id from public.lotes
      where producto_id = v_prod_id and estado in ('activo','agotado')
      order by fecha_vencimiento desc, id desc limit 1;
    if v_lote_id is not null then
      update public.lotes
        set cantidad_actual = cantidad_actual + v_cant, estado = 'activo'
        where id = v_lote_id;
    end if;

    -- Si va a merma, se da de baja de nuevo
    if v_destino = 'merma' then
      update public.productos set stock_actual = v_stock_nuevo - v_cant, updated_at = v_ahora
        where id = v_prod_id;
      insert into public.movimientos_stock (
        producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
        referencia_id, usuario_id, nota
      ) values (
        v_prod_id, 'merma', v_cant, v_stock_nuevo, v_stock_nuevo - v_cant,
        p_venta_id, p_usuario_id, 'Merma por devolución dañada venta #' || p_venta_id
      );
      if v_lote_id is not null then
        update public.lotes
          set cantidad_actual = greatest(cantidad_actual - v_cant, 0)
          where id = v_lote_id;
      end if;
    end if;
  end loop;

  if v_total <= 0 then
    raise exception 'La devolución no tiene items válidos.';
  end if;

  -- Crear cabecera
  insert into public.devoluciones (
    venta_id, turno_id, usuario_id, motivo, tipo_reembolso,
    total_devuelto, cliente_id
  ) values (
    p_venta_id, p_turno_id, p_usuario_id, p_motivo, p_tipo_reembolso,
    v_total, p_cliente_id
  ) returning id into v_dev_id;

  -- Items
  for v_item in select * from jsonb_array_elements(p_items) loop
    if (v_item->>'cantidad')::integer <= 0 then continue; end if;
    insert into public.items_devolucion (
      devolucion_id, item_venta_id, producto_id, cantidad, precio_unitario, subtotal, destino
    ) values (
      v_dev_id,
      nullif(v_item->>'item_venta_id','')::integer,
      (v_item->>'producto_id')::integer,
      (v_item->>'cantidad')::integer,
      (v_item->>'precio_unitario')::numeric,
      (v_item->>'cantidad')::integer * (v_item->>'precio_unitario')::numeric,
      coalesce(v_item->>'destino','stock')
    );
  end loop;

  -- ── Reembolso ──
  if p_tipo_reembolso = 'efectivo' then
    -- Sale de la caja del turno (egreso categoría devolucion)
    insert into public.egresos (descripcion, monto, categoria, fecha, usuario_id, turno_id)
    values ('Devolución venta #' || p_venta_id, v_total, 'devolucion', v_hoy, p_usuario_id, p_turno_id)
    returning id into v_egreso_id;
    update public.devoluciones set egreso_id = v_egreso_id where id = v_dev_id;

  elsif p_tipo_reembolso = 'nota_credito' then
    v_codigo := 'NC-' || to_char(v_ahora, 'YYMMDD') || '-' ||
                lpad((floor(random()*10000))::int::text, 4, '0');
    insert into public.notas_credito (
      codigo, cliente_id, devolucion_id, monto_original, saldo_disponible, estado
    ) values (
      v_codigo, p_cliente_id, v_dev_id, v_total, v_total, 'activa'
    ) returning id into v_nc_id;
    update public.devoluciones set nota_credito_id = v_nc_id where id = v_dev_id;

  elsif p_tipo_reembolso = 'tarjeta' then
    -- Ajustar clearing: reducir/cancelar acreditaciones pendientes de la venta
    v_rest := v_total;
    for v_acred in
      select * from public.acreditaciones
      where venta_id = p_venta_id and estado = 'pendiente'
      order by id for update
    loop
      exit when v_rest <= 0;
      if v_rest >= v_acred.monto_bruto then
        update public.acreditaciones set estado = 'cancelada', updated_at = v_ahora
          where id = v_acred.id;
        v_rest := v_rest - v_acred.monto_bruto;
      else
        v_nuevo_bruto := v_acred.monto_bruto - v_rest;
        v_nuevo_com := round(v_nuevo_bruto * v_acred.comision_pct) / 100;
        update public.acreditaciones
          set monto_bruto = v_nuevo_bruto,
              comision_monto = v_nuevo_com,
              monto_neto = v_nuevo_bruto - v_nuevo_com,
              updated_at = v_ahora
          where id = v_acred.id;
        v_rest := 0;
      end if;
    end loop;
  end if;

  -- ── Contra-asiento (efectivo / tarjeta) ──
  if p_tipo_reembolso in ('efectivo','tarjeta') then
    select id into v_cta_ventas from public.plan_cuentas where codigo = '4.1.01';
    select id into v_cta_iva from public.plan_cuentas where codigo = '2.1.02';
    select id into v_cta_caja from public.plan_cuentas where codigo = '1.1.01';
    select id into v_cta_banco from public.plan_cuentas where codigo = '1.1.02';
    select id into v_cta_cmv from public.plan_cuentas where codigo = '5.1.01';
    select id into v_cta_merc from public.plan_cuentas where codigo = '1.1.04';
    v_cta_haber := case when p_tipo_reembolso = 'efectivo' then v_cta_caja else v_cta_banco end;

    if v_cta_ventas is not null and v_cta_iva is not null and v_cta_haber is not null then
      v_neto := round(v_total / 1.21, 2);
      v_iva := round(v_total - v_neto, 2);
      insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
      values (v_hoy, 'Devolución venta #' || p_venta_id, 'automatico', 'devolucion', v_dev_id, p_usuario_id)
      returning id into v_asiento_id;
      -- Reversa del ingreso: Debe Ventas + IVA, Haber Caja/Banco
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_ventas, v_neto, 0, 0);
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_iva, v_iva, 0, 1);
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_haber, 0, v_total, 2);
      -- Reversa del costo: Debe Mercaderías, Haber CMV
      if v_cta_cmv is not null and v_cta_merc is not null and v_costo_total > 0 then
        v_costo_total := round(v_costo_total, 2);
        insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
        values (v_asiento_id, v_cta_merc, v_costo_total, 0, 3);
        insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
        values (v_asiento_id, v_cta_cmv, 0, v_costo_total, 4);
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'devolucion_id', v_dev_id,
    'total_devuelto', v_total,
    'nota_credito_id', v_nc_id,
    'codigo_nc', v_codigo
  );
end;
$$;

notify pgrst, 'reload schema';
