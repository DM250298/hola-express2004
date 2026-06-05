-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 055: pago de cuentas a pagar — origen, parcial e historial║
-- ║                                                                     ║
-- ║  Hoy fn_pagar_cuenta solo recibe (cuenta_id, usuario_id), marca     ║
-- ║  pagada con fecha=hoy y asienta SIEMPRE contra Caja, sin tocar el    ║
-- ║  saldo de ninguna cuenta de tesorería real.                         ║
-- ║                                                                     ║
-- ║  Ahora el pago:                                                     ║
-- ║   · Sale de una cuenta de tesorería elegida (baja su saldo vía      ║
-- ║     movimientos_cuenta), con fecha y nota editables.                ║
-- ║   · Admite PAGO PARCIAL: acumula monto_pagado; la cuenta queda      ║
-- ║     'pagada' recién cuando se cubre el total.                       ║
-- ║   · Deja historial en pagos_cuenta (un registro por pago).          ║
-- ║   · Genera el egreso (P&L) + asiento Debe Proveedores / Haber       ║
-- ║     <cuenta contable según el tipo de la cuenta de origen>.         ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Columnas nuevas en cuentas_a_pagar
-- ─────────────────────────────────────────────────────────────────────
alter table public.cuentas_a_pagar
  add column if not exists monto_pagado numeric(12,2) not null default 0,
  add column if not exists nota text;

comment on column public.cuentas_a_pagar.monto_pagado is
  'Total pagado hasta ahora (suma de pagos_cuenta). Cuando alcanza `monto`, la cuenta pasa a estado pagada.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Historial de pagos
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.pagos_cuenta (
  id              serial primary key,
  cuenta_a_pagar_id integer not null references public.cuentas_a_pagar(id) on delete cascade,
  cuenta_origen_id  integer references public.cuentas(id),
  monto           numeric(12,2) not null check (monto > 0),
  fecha           date not null default current_date,
  nota            text,
  usuario_id      uuid references public.usuarios(id),
  movimiento_id   integer,
  egreso_id       integer,
  created_at      timestamptz not null default now()
);

create index if not exists idx_pagos_cuenta_cuenta
  on public.pagos_cuenta (cuenta_a_pagar_id, fecha desc);

alter table public.pagos_cuenta enable row level security;
do $$ begin
  create policy "todo" on public.pagos_cuenta
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. fn_pagar_cuenta v2 — origen + parcial + historial
--    Se dropea la versión vieja (2 args) por la gotcha de Postgres
--    "CREATE OR REPLACE no pisa firmas distintas".
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_pagar_cuenta(integer, uuid);

create or replace function public.fn_pagar_cuenta(
  p_cuenta_id integer,
  p_usuario_id uuid,
  p_cuenta_origen_id integer,
  p_monto numeric,
  p_fecha date default null,
  p_nota text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_monto numeric;
  v_pagado numeric;
  v_pendiente numeric;
  v_pedido_id integer;
  v_estado text;
  v_proveedor text;
  v_fecha date := coalesce(p_fecha, current_date);
  v_tipo_cuenta text;
  v_saldo numeric;
  v_saldo_nuevo numeric;
  v_mov_id integer;
  v_egreso_id integer;
  v_asiento_id integer;
  v_cta_prov integer;
  v_cta_haber integer;
  v_nuevo_pagado numeric;
  v_completa boolean;
begin
  -- Datos de la deuda
  select c.monto, coalesce(c.monto_pagado, 0), c.pedido_id, c.estado, p.nombre
    into v_monto, v_pagado, v_pedido_id, v_estado, v_proveedor
    from public.cuentas_a_pagar c
    left join public.proveedores p on p.id = c.proveedor_id
    where c.id = p_cuenta_id
    for update;
  if v_monto is null then
    raise exception 'La cuenta no existe.';
  end if;
  if v_estado = 'pagada' then
    raise exception 'Esta cuenta ya está pagada.';
  end if;

  v_pendiente := v_monto - v_pagado;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del pago debe ser mayor a 0.';
  end if;
  if p_monto > v_pendiente + 0.009 then
    raise exception 'El pago (%) supera el saldo pendiente (%).', p_monto, v_pendiente;
  end if;

  -- Cuenta de tesorería de origen
  select tipo, saldo_actual into v_tipo_cuenta, v_saldo
    from public.cuentas where id = p_cuenta_origen_id for update;
  if v_saldo is null then
    raise exception 'La cuenta de origen del pago no existe.';
  end if;

  -- 1) Movimiento de egreso en la cuenta de origen (baja saldo)
  v_saldo_nuevo := v_saldo - p_monto;
  insert into public.movimientos_cuenta (
    cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
    descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
  ) values (
    p_cuenta_origen_id, 'egreso', p_monto, v_saldo, v_saldo_nuevo,
    'Pago a ' || coalesce(v_proveedor, 'proveedor') || ' · cuenta #' || p_cuenta_id,
    'pago_proveedores', 'cuenta_a_pagar', p_cuenta_id, p_usuario_id, v_fecha
  )
  returning id into v_mov_id;

  update public.cuentas
    set saldo_actual = v_saldo_nuevo, updated_at = now()
    where id = p_cuenta_origen_id;

  -- 2) Egreso (para P&L)
  insert into public.egresos (descripcion, monto, categoria, fecha, usuario_id, turno_id)
  values (
    'Pago a ' || coalesce(v_proveedor, 'proveedor') || ' (pedido #' || v_pedido_id || ')',
    p_monto, 'pago_proveedores', v_fecha, p_usuario_id, null
  )
  returning id into v_egreso_id;

  -- 3) Asiento: Debe Proveedores (2.1.01) / Haber cuenta según tipo de origen
  select id into v_cta_prov from public.plan_cuentas where codigo = '2.1.01';
  v_cta_haber := case v_tipo_cuenta
    when 'caja' then (select id from public.plan_cuentas where codigo = '1.1.01')
    else (select id from public.plan_cuentas where codigo = '1.1.02')  -- banco / billetera
  end;
  if v_cta_prov is not null and v_cta_haber is not null then
    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (v_fecha, 'Pago cuenta #' || p_cuenta_id || ' · ' || coalesce(v_proveedor, 'proveedor'),
            'automatico', 'egreso', v_egreso_id, p_usuario_id)
    returning id into v_asiento_id;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_prov, p_monto, 0, 0);
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_haber, 0, p_monto, 1);
  end if;

  -- 4) Registrar el pago en el historial
  insert into public.pagos_cuenta (
    cuenta_a_pagar_id, cuenta_origen_id, monto, fecha, nota,
    usuario_id, movimiento_id, egreso_id
  ) values (
    p_cuenta_id, p_cuenta_origen_id, p_monto, v_fecha, p_nota,
    p_usuario_id, v_mov_id, v_egreso_id
  );

  -- 5) Acumular y cerrar la cuenta si se completó
  v_nuevo_pagado := v_pagado + p_monto;
  v_completa := v_nuevo_pagado >= v_monto - 0.009;
  update public.cuentas_a_pagar
    set monto_pagado = v_nuevo_pagado,
        estado = case when v_completa then 'pagada'::public.estado_cuenta_pagar else estado end,
        fecha_pago = case when v_completa then v_fecha else fecha_pago end
    where id = p_cuenta_id;

  return jsonb_build_object(
    'pagado', p_monto,
    'monto_pagado_total', v_nuevo_pagado,
    'pendiente', v_monto - v_nuevo_pagado,
    'completa', v_completa,
    'movimiento_id', v_mov_id
  );
end;
$$;

notify pgrst, 'reload schema';
