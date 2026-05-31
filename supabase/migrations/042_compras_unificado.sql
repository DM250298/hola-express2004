-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 042 · Módulo de Compras unificado                        ║
-- ║                                                                     ║
-- ║  Reorganiza Compras según el manual operativo:                      ║
-- ║   1. Catálogo N:M proveedor↔producto (varios proveedores x producto)║
-- ║   2. Recepción parcial (estado nuevo en pedidos)                    ║
-- ║   3. Three-way match con deuda PROVISORIA (Opción B):               ║
-- ║      la recepción crea la cuenta a pagar marcada como provisoria;   ║
-- ║      al cargar la factura se ajusta al monto real.                  ║
-- ║   4. Monitor de variación de costos (historial + umbral config).    ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Catálogo N:M proveedor ↔ producto
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.proveedor_producto (
  id              serial primary key,
  proveedor_id    integer not null references public.proveedores(id) on delete cascade,
  producto_id     integer not null references public.productos(id) on delete cascade,
  costo           numeric(12,2) not null default 0,
  codigo_proveedor text,             -- código del artículo en el catálogo del proveedor
  es_principal    boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (proveedor_id, producto_id)
);

create index if not exists idx_provprod_proveedor on public.proveedor_producto(proveedor_id);
create index if not exists idx_provprod_producto on public.proveedor_producto(producto_id);

-- Sembrar el catálogo desde la relación actual productos.proveedor_id
insert into public.proveedor_producto (proveedor_id, producto_id, costo, es_principal)
select p.proveedor_id, p.id, coalesce(p.precio_costo, 0), true
from public.productos p
where p.proveedor_id is not null
on conflict (proveedor_id, producto_id) do nothing;

alter table public.proveedor_producto enable row level security;
do $$ begin
  create policy "todo" on public.proveedor_producto
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Estado "recepcion_parcial" en pedidos
--    pedidos.estado es un ENUM (estado_pedido), así que se agrega el valor
--    al tipo. ADD VALUE no puede usarse en la misma transacción donde se
--    crea, pero como sólo lo usan las funciones (en runtime), no hay
--    problema. Si tu Postgres se queja por la transacción, corré PRIMERO
--    esta línea sola y después el resto del script.
-- ─────────────────────────────────────────────────────────────────────
alter type public.estado_pedido add value if not exists 'recepcion_parcial';

-- ─────────────────────────────────────────────────────────────────────
-- 3. Three-way match (Opción B): deuda provisoria en cuentas_a_pagar
-- ─────────────────────────────────────────────────────────────────────
alter table public.cuentas_a_pagar
  add column if not exists provisoria    boolean not null default false,
  add column if not exists tiene_factura boolean not null default false;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Monitor de variación de costos
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.historial_costos (
  id             serial primary key,
  producto_id    integer not null references public.productos(id) on delete cascade,
  proveedor_id   integer references public.proveedores(id) on delete set null,
  costo_anterior numeric(12,2) not null default 0,
  costo_nuevo    numeric(12,2) not null default 0,
  variacion_pct  numeric(8,2) not null default 0,
  origen         text not null default 'recepcion',  -- 'recepcion' | 'factura'
  pedido_id      integer,
  usuario_id     uuid references public.usuarios(id),
  created_at     timestamptz not null default now()
);

create index if not exists idx_histcostos_producto on public.historial_costos(producto_id);
create index if not exists idx_histcostos_fecha on public.historial_costos(created_at desc);

alter table public.historial_costos enable row level security;
do $$ begin
  create policy "todo" on public.historial_costos
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- Config de compras (singleton): umbral de alerta de variación de costo
create table if not exists public.config_compras (
  id                     integer primary key default 1,
  umbral_variacion_costo numeric(6,2) not null default 10,  -- % a partir del cual alerta
  exige_factura          boolean not null default true,
  constraint config_compras_singleton check (id = 1)
);
insert into public.config_compras (id) values (1) on conflict (id) do nothing;

alter table public.config_compras enable row level security;
do $$ begin
  create policy "todo" on public.config_compras
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 5. fn_recibir_pedido v2
--    · Recepción total o PARCIAL (estado del pedido según lo recibido).
--    · Deuda PROVISORIA: crea la cuenta a pagar marcada provisoria=true,
--      tiene_factura=false (se ajusta luego al cargar la factura).
--    · Registra variación de costo (recibido vs. costo actual) en
--      historial_costos y actualiza el costo del catálogo del proveedor.
--    · Devuelve el detalle de variaciones para que la UI pueda alertar.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_recibir_pedido(
  p_pedido_id integer,
  p_proveedor_id integer,
  p_usuario_id uuid,
  p_condicion_pago_dias integer,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ahora timestamptz := now();
  v_total numeric := 0;
  v_item jsonb;
  v_item_id integer;
  v_prod_id integer;
  v_cant integer;
  v_precio numeric;
  v_venc date;
  v_subtotal numeric;
  v_stock_ant integer;
  v_stock_nuevo integer;
  v_cuenta_id integer;
  v_costo_ant numeric;
  v_var_pct numeric;
  v_umbral numeric;
  v_variaciones jsonb := '[]'::jsonb;
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
    v_subtotal := v_cant * v_precio;

    update public.items_pedido
      set cantidad_recibida = v_cant, subtotal = v_subtotal
      where id = v_item_id;

    if v_cant <= 0 then
      continue;
    end if;

    v_total := v_total + v_subtotal;

    -- Stock + movimiento
    select stock_actual, precio_costo into v_stock_ant, v_costo_ant
      from public.productos where id = v_prod_id for update;
    v_stock_ant := coalesce(v_stock_ant, 0);
    v_costo_ant := coalesce(v_costo_ant, 0);
    v_stock_nuevo := v_stock_ant + v_cant;

    update public.productos
      set stock_actual = v_stock_nuevo, updated_at = v_ahora
      where id = v_prod_id;

    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
      referencia_id, usuario_id, nota
    ) values (
      v_prod_id, 'entrada', v_cant, v_stock_ant, v_stock_nuevo,
      p_pedido_id, p_usuario_id, 'Recepción de pedido #' || p_pedido_id
    );

    -- Lote con vencimiento
    if v_venc is not null then
      insert into public.lotes (
        producto_id, fecha_vencimiento, cantidad_inicial,
        cantidad_actual, estado, pedido_origen_id
      ) values (
        v_prod_id, v_venc, v_cant, v_cant, 'activo', p_pedido_id
      );
    end if;

    -- ── Monitor de variación de costo ──
    if v_costo_ant > 0 and v_precio > 0 then
      v_var_pct := round(((v_precio - v_costo_ant) / v_costo_ant) * 100, 2);
    else
      v_var_pct := 0;
    end if;

    if v_var_pct <> 0 then
      insert into public.historial_costos (
        producto_id, proveedor_id, costo_anterior, costo_nuevo,
        variacion_pct, origen, pedido_id, usuario_id
      ) values (
        v_prod_id, p_proveedor_id, v_costo_ant, v_precio,
        v_var_pct, 'recepcion', p_pedido_id, p_usuario_id
      );

      -- Solo se reporta a la UI si supera el umbral configurado (subas)
      if v_var_pct >= v_umbral then
        v_variaciones := v_variaciones || jsonb_build_object(
          'producto_id', v_prod_id,
          'costo_anterior', v_costo_ant,
          'costo_nuevo', v_precio,
          'variacion_pct', v_var_pct
        );
      end if;
    end if;

    -- Actualizar costo del catálogo del proveedor
    insert into public.proveedor_producto (proveedor_id, producto_id, costo, es_principal, updated_at)
    values (p_proveedor_id, v_prod_id, v_precio, false, v_ahora)
    on conflict (proveedor_id, producto_id)
    do update set costo = excluded.costo, updated_at = v_ahora;
  end loop;

  -- ── Estado del pedido: total vs. parcial ──
  select
    coalesce(sum(cantidad_pedida), 0),
    coalesce(sum(coalesce(cantidad_recibida, 0)), 0)
    into v_total_pedido, v_total_recibido_unid
    from public.items_pedido where pedido_id = p_pedido_id;

  if v_total_recibido_unid >= v_total_pedido then
    v_estado := 'recibido';
  else
    v_estado := 'recepcion_parcial';
  end if;

  update public.pedidos
    set estado = v_estado::public.estado_pedido, total = v_total, updated_at = v_ahora
    where id = p_pedido_id;

  -- ── Cuenta a pagar PROVISORIA (Opción B) ──
  -- Si ya existe una cuenta provisoria para este pedido (recepción previa),
  -- se actualiza su monto en lugar de duplicar.
  select id into v_cuenta_id
    from public.cuentas_a_pagar
    where pedido_id = p_pedido_id and tiene_factura = false
    order by id desc limit 1;

  if v_cuenta_id is null then
    insert into public.cuentas_a_pagar (
      pedido_id, proveedor_id, monto, fecha_vencimiento, estado,
      provisoria, tiene_factura
    ) values (
      p_pedido_id, p_proveedor_id, v_total,
      current_date + p_condicion_pago_dias, 'pendiente',
      true, false
    )
    returning id into v_cuenta_id;
  else
    update public.cuentas_a_pagar
      set monto = v_total,
          proveedor_id = p_proveedor_id,
          fecha_vencimiento = current_date + p_condicion_pago_dias
      where id = v_cuenta_id;
  end if;

  return jsonb_build_object(
    'cuenta_a_pagar_id', v_cuenta_id,
    'total_recibido', v_total,
    'es_parcial', (v_estado = 'recepcion_parcial'),
    'variaciones', v_variaciones
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 6. fn_guardar_factura_compra v3
--    Igual que v2 (asiento contable) + cierra el three-way match:
--    marca la cuenta a pagar como facturada (provisoria=false,
--    tiene_factura=true) y registra la variación de costo final vs. el
--    costo previo del producto, con origen='factura'.
-- ─────────────────────────────────────────────────────────────────────
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
  v_asiento_id integer;
  v_cta_merc integer;
  v_cta_iva_cred integer;
  v_cta_prov integer;
  v_costo_ant numeric;
  v_var_pct numeric;
begin
  delete from public.facturas_compra where cuenta_id = p_cuenta_id;

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

  insert into public.facturas_compra (
    cuenta_id, pedido_id, proveedor_id, fecha,
    neto, iva_total, total, afecta_precio_venta, usuario_id
  ) values (
    p_cuenta_id, p_pedido_id, p_proveedor_id, p_fecha,
    v_neto, v_iva_total, v_total, p_afecta_precio_venta, p_usuario_id
  )
  returning id into v_factura_id;

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

    -- Variación de costo final (factura) vs. costo previo del producto
    select precio_costo into v_costo_ant from public.productos where id = v_prod_id;
    v_costo_ant := coalesce(v_costo_ant, 0);
    if v_costo_ant > 0 and v_costo_neto > 0 and v_costo_neto <> v_costo_ant then
      v_var_pct := round(((v_costo_neto - v_costo_ant) / v_costo_ant) * 100, 2);
      insert into public.historial_costos (
        producto_id, proveedor_id, costo_anterior, costo_nuevo,
        variacion_pct, origen, pedido_id, usuario_id
      ) values (
        v_prod_id, p_proveedor_id, v_costo_ant, v_costo_neto,
        v_var_pct, 'factura', p_pedido_id, p_usuario_id
      );
    end if;

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
        set precio_costo = v_costo_neto, precio_venta = v_precio_con_iva, updated_at = v_ahora
        where id = v_prod_id;
    else
      update public.productos
        set precio_costo = v_costo_neto, updated_at = v_ahora
        where id = v_prod_id;
    end if;

    update public.proveedor_producto
      set costo = v_costo_neto, updated_at = v_ahora
      where proveedor_id = p_proveedor_id and producto_id = v_prod_id;

    update public.items_pedido
      set precio_costo = v_costo_neto, subtotal = round(v_costo_neto * v_cant, 2)
      where id = (v_linea->>'item_pedido_id')::integer;
  end loop;

  update public.pedidos
    set total = v_total, updated_at = v_ahora where id = p_pedido_id;

  -- Cierra el three-way match: la deuda deja de ser provisoria
  update public.cuentas_a_pagar
    set monto = v_total, provisoria = false, tiene_factura = true
    where id = p_cuenta_id;

  -- ── Asiento contable de la compra ──
  delete from public.asientos
    where origen = 'factura_compra' and referencia_id = p_cuenta_id;

  select id into v_cta_merc from public.plan_cuentas where codigo = '1.1.04';
  select id into v_cta_iva_cred from public.plan_cuentas where codigo = '1.1.05';
  select id into v_cta_prov from public.plan_cuentas where codigo = '2.1.01';

  if v_total > 0 and v_cta_merc is not null
     and v_cta_iva_cred is not null and v_cta_prov is not null then
    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (p_fecha, 'Factura compra · Pedido #' || p_pedido_id,
            'automatico', 'factura_compra', p_cuenta_id, p_usuario_id)
    returning id into v_asiento_id;

    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_merc, v_neto, 0, 0);
    if v_iva_total > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_iva_cred, v_iva_total, 0, 1);
    end if;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_prov, 0, v_total, 2);
  end if;
end;
$$;

notify pgrst, 'reload schema';
