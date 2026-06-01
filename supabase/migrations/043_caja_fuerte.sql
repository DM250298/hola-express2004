-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 043 · FASE 1 — Caja Fuerte y Tesorería                   ║
-- ║                                                                     ║
-- ║  Audita el camino del efectivo: sangrías (retiros de la caja del    ║
-- ║  turno al buzón) → arqueo de tesorería (contar sobres físicos vs.   ║
-- ║  lo reportado) → remesas (depósito al banco).                       ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Sangrías (retiros de efectivo de la caja del turno al buzón)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.sangrias (
  id          serial primary key,
  turno_id    integer references public.caja_turnos(id) on delete set null,
  usuario_id  uuid references public.usuarios(id),
  monto       numeric(12,2) not null,
  nota        text,
  estado      text not null default 'en_buzon',  -- 'en_buzon' | 'arqueada'
  arqueo_id   integer,                            -- se completa al arquear
  created_at  timestamptz not null default now()
);

create index if not exists idx_sangrias_estado on public.sangrias(estado);
create index if not exists idx_sangrias_turno on public.sangrias(turno_id);

alter table public.sangrias enable row level security;
do $$ begin
  create policy "todo" on public.sangrias
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Arqueos de tesorería (contar sobres físicos vs. lo reportado)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.arqueos_tesoreria (
  id              serial primary key,
  usuario_id      uuid references public.usuarios(id),
  fecha           date not null default current_date,
  monto_esperado  numeric(12,2) not null default 0,  -- suma de sangrías incluidas
  monto_fisico    numeric(12,2) not null default 0,  -- lo contado realmente
  diferencia      numeric(12,2) not null default 0,
  nota_ajuste     text,
  estado          text not null default 'validado',  -- 'validado' | 'con_diferencia'
  created_at      timestamptz not null default now()
);

create index if not exists idx_arqueos_fecha on public.arqueos_tesoreria(fecha desc);

alter table public.arqueos_tesoreria enable row level security;
do $$ begin
  create policy "todo" on public.arqueos_tesoreria
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Remesas (depósitos de la caja fuerte al banco)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.remesas (
  id            serial primary key,
  usuario_id    uuid references public.usuarios(id),
  cuenta_id     integer references public.cuentas(id),  -- cuenta bancaria destino
  monto         numeric(12,2) not null,
  fecha         date not null default current_date,
  comprobante   text,
  nota          text,
  movimiento_id integer,  -- movimiento_cuenta generado en el banco
  created_at    timestamptz not null default now()
);

create index if not exists idx_remesas_fecha on public.remesas(fecha desc);

alter table public.remesas enable row level security;
do $$ begin
  create policy "todo" on public.remesas
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. fn_validar_arqueo
--    Agrupa sangrías 'en_buzon', compara lo contado contra lo esperado.
--    Si hay diferencia, exige una nota de ajuste (bloquea si no la hay).
--    Marca las sangrías como 'arqueada'.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_validar_arqueo(
  p_usuario_id uuid,
  p_sangria_ids integer[],
  p_monto_fisico numeric,
  p_nota text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_esperado numeric := 0;
  v_diferencia numeric;
  v_estado text;
  v_arqueo_id integer;
begin
  if p_sangria_ids is null or array_length(p_sangria_ids, 1) is null then
    raise exception 'Seleccioná al menos un sobre para arquear.';
  end if;

  select coalesce(sum(monto), 0) into v_esperado
    from public.sangrias
    where id = any(p_sangria_ids) and estado = 'en_buzon';

  v_diferencia := round(p_monto_fisico - v_esperado, 2);

  if v_diferencia <> 0 and (p_nota is null or btrim(p_nota) = '') then
    raise exception 'Hay una diferencia de %. Ingresá una nota de ajuste para validar el arqueo.', v_diferencia;
  end if;

  v_estado := case when v_diferencia = 0 then 'validado' else 'con_diferencia' end;

  insert into public.arqueos_tesoreria (
    usuario_id, monto_esperado, monto_fisico, diferencia, nota_ajuste, estado
  ) values (
    p_usuario_id, v_esperado, p_monto_fisico, v_diferencia, nullif(btrim(coalesce(p_nota,'')),''), v_estado
  )
  returning id into v_arqueo_id;

  update public.sangrias
    set estado = 'arqueada', arqueo_id = v_arqueo_id
    where id = any(p_sangria_ids) and estado = 'en_buzon';

  return jsonb_build_object(
    'arqueo_id', v_arqueo_id,
    'monto_esperado', v_esperado,
    'monto_fisico', p_monto_fisico,
    'diferencia', v_diferencia,
    'estado', v_estado
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 5. fn_generar_remesa
--    Genera un depósito de la caja fuerte a una cuenta bancaria:
--    crea el movimiento de ingreso en la cuenta (actualiza saldo) y
--    registra la remesa con su comprobante.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_generar_remesa(
  p_usuario_id uuid,
  p_cuenta_id integer,
  p_monto numeric,
  p_comprobante text,
  p_nota text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saldo_ant numeric;
  v_saldo_nuevo numeric;
  v_mov_id integer;
  v_remesa_id integer;
begin
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto de la remesa debe ser mayor a cero.';
  end if;

  select saldo_actual into v_saldo_ant
    from public.cuentas where id = p_cuenta_id for update;
  if v_saldo_ant is null then
    raise exception 'La cuenta destino no existe.';
  end if;
  v_saldo_nuevo := v_saldo_ant + p_monto;

  insert into public.movimientos_cuenta (
    cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
    descripcion, categoria, referencia_tipo, usuario_id
  ) values (
    p_cuenta_id, 'ingreso', p_monto, v_saldo_ant, v_saldo_nuevo,
    'Remesa / depósito de caja fuerte', 'remesa', 'remesa', p_usuario_id
  )
  returning id into v_mov_id;

  update public.cuentas
    set saldo_actual = v_saldo_nuevo, updated_at = now()
    where id = p_cuenta_id;

  insert into public.remesas (
    usuario_id, cuenta_id, monto, comprobante, nota, movimiento_id
  ) values (
    p_usuario_id, p_cuenta_id, p_monto,
    nullif(btrim(coalesce(p_comprobante,'')),''),
    nullif(btrim(coalesce(p_nota,'')),''),
    v_mov_id
  )
  returning id into v_remesa_id;

  return jsonb_build_object(
    'remesa_id', v_remesa_id,
    'movimiento_id', v_mov_id,
    'saldo_nuevo', v_saldo_nuevo
  );
end;
$$;

notify pgrst, 'reload schema';
