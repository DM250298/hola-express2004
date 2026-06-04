-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 045 · FASE 3 — Conciliación bancaria automática          ║
-- ║                                                                     ║
-- ║  Importa el extracto / reporte de liquidaciones (CSV/Excel) y lo    ║
-- ║  cruza automáticamente contra:                                      ║
-- ║   · Acreditaciones pendientes (ventas con tarjeta/MP) → las acredita║
-- ║   · Movimientos de cuenta no conciliados → los marca conciliados    ║
-- ║   · Lo que no matchea queda como ANOMALÍA para revisar              ║
-- ║                                                                     ║
-- ║  Pensado para Mercado Pago (deposita el NETO ya con comisión).      ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Cabecera de cada importación de extracto
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.extractos_bancarios (
  id                  serial primary key,
  cuenta_id           integer references public.cuentas(id) on delete set null,
  usuario_id          uuid references public.usuarios(id),
  nombre_archivo      text,
  lineas_total        integer not null default 0,
  lineas_conciliadas  integer not null default 0,
  lineas_anomalia     integer not null default 0,
  monto_conciliado    numeric(14,2) not null default 0,
  created_at          timestamptz not null default now()
);

create index if not exists idx_extractos_fecha on public.extractos_bancarios(created_at desc);

alter table public.extractos_bancarios enable row level security;
do $$ begin
  create policy "todo" on public.extractos_bancarios
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Cada línea del extracto importado (con su resultado de match)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.lineas_extracto (
  id            serial primary key,
  extracto_id   integer not null references public.extractos_bancarios(id) on delete cascade,
  fecha         date,
  descripcion   text,
  monto         numeric(14,2) not null,       -- con signo: + ingreso, - egreso
  id_externo    text,                          -- ID de operación de MP, si vino
  estado        text not null default 'anomalia', -- 'conciliada' | 'anomalia' | 'ignorada'
  match_tipo    text,                          -- 'acreditacion' | 'movimiento' | null
  match_id      integer,                       -- id de la acreditación o movimiento
  created_at    timestamptz not null default now()
);

create index if not exists idx_lineas_extracto_extracto on public.lineas_extracto(extracto_id);
create index if not exists idx_lineas_extracto_estado on public.lineas_extracto(estado);

alter table public.lineas_extracto enable row level security;
do $$ begin
  create policy "todo" on public.lineas_extracto
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. fn_aplicar_conciliacion
--    Recibe las líneas ya cruzadas por el cliente y, en una sola
--    transacción:
--     · acredita las acreditaciones matcheadas (plata neta entra al banco)
--     · marca conciliados los movimientos matcheados
--     · guarda todas las líneas (incluidas anomalías) para auditoría
--
--    p_lineas: array de objetos:
--      { fecha, descripcion, monto, id_externo, accion, ref_id }
--      accion ∈ 'acreditar' | 'conciliar_mov' | 'anomalia' | 'ignorar'
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_aplicar_conciliacion(
  p_usuario_id uuid,
  p_cuenta_id integer,
  p_nombre_archivo text,
  p_lineas jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_extracto_id integer;
  v_linea jsonb;
  v_accion text;
  v_ref_id integer;
  v_estado text;
  v_match_tipo text;
  v_monto numeric;
  v_fecha date;
  v_total integer := 0;
  v_conciliadas integer := 0;
  v_anomalias integer := 0;
  v_monto_conc numeric := 0;
  -- acreditación
  v_acred record;
  v_saldo_ant numeric;
  v_saldo_nuevo numeric;
  v_mov_id integer;
begin
  insert into public.extractos_bancarios (
    cuenta_id, usuario_id, nombre_archivo
  ) values (
    p_cuenta_id, p_usuario_id, p_nombre_archivo
  ) returning id into v_extracto_id;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_total := v_total + 1;
    v_accion := coalesce(v_linea->>'accion', 'anomalia');
    v_ref_id := nullif(v_linea->>'ref_id', '')::integer;
    v_monto := (v_linea->>'monto')::numeric;
    v_fecha := nullif(v_linea->>'fecha', '')::date;
    v_estado := 'anomalia';
    v_match_tipo := null;

    if v_accion = 'acreditar' and v_ref_id is not null then
      -- Acreditar la venta con tarjeta: la plata neta entra al banco
      select * into v_acred from public.acreditaciones
        where id = v_ref_id and estado = 'pendiente' for update;
      if found and v_acred.cuenta_id is not null then
        select saldo_actual into v_saldo_ant
          from public.cuentas where id = v_acred.cuenta_id for update;
        v_saldo_nuevo := v_saldo_ant + v_acred.monto_neto;

        insert into public.movimientos_cuenta (
          cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
          descripcion, categoria, referencia_tipo, referencia_id,
          usuario_id, fecha, conciliado, fecha_conciliacion
        ) values (
          v_acred.cuenta_id, 'ingreso', v_acred.monto_neto, v_saldo_ant, v_saldo_nuevo,
          'Acreditación ' || v_acred.medio_pago || ' · Venta #' || v_acred.venta_id ||
            ' (conciliada con extracto)',
          'acreditacion', 'acreditacion', v_acred.id,
          p_usuario_id, coalesce(v_fecha, current_date), true, now()
        ) returning id into v_mov_id;

        update public.cuentas
          set saldo_actual = v_saldo_nuevo, updated_at = now()
          where id = v_acred.cuenta_id;

        update public.acreditaciones
          set estado = 'acreditada', fecha_real = coalesce(v_fecha, current_date),
              movimiento_id = v_mov_id, updated_at = now()
          where id = v_acred.id;

        v_estado := 'conciliada';
        v_match_tipo := 'acreditacion';
        v_conciliadas := v_conciliadas + 1;
        v_monto_conc := v_monto_conc + v_monto;
      end if;

    elsif v_accion = 'conciliar_mov' and v_ref_id is not null then
      -- Marcar un movimiento de cuenta existente como conciliado
      update public.movimientos_cuenta
        set conciliado = true, fecha_conciliacion = now()
        where id = v_ref_id and conciliado = false;
      if found then
        v_estado := 'conciliada';
        v_match_tipo := 'movimiento';
        v_conciliadas := v_conciliadas + 1;
        v_monto_conc := v_monto_conc + v_monto;
      end if;

    elsif v_accion = 'ignorar' then
      v_estado := 'ignorada';
    end if;

    if v_estado = 'anomalia' then
      v_anomalias := v_anomalias + 1;
    end if;

    insert into public.lineas_extracto (
      extracto_id, fecha, descripcion, monto, id_externo,
      estado, match_tipo, match_id
    ) values (
      v_extracto_id, v_fecha, v_linea->>'descripcion', v_monto,
      nullif(v_linea->>'id_externo', ''),
      v_estado, v_match_tipo,
      case when v_estado = 'conciliada' then v_ref_id else null end
    );
  end loop;

  update public.extractos_bancarios
    set lineas_total = v_total,
        lineas_conciliadas = v_conciliadas,
        lineas_anomalia = v_anomalias,
        monto_conciliado = v_monto_conc
    where id = v_extracto_id;

  return jsonb_build_object(
    'extracto_id', v_extracto_id,
    'total', v_total,
    'conciliadas', v_conciliadas,
    'anomalias', v_anomalias
  );
end;
$$;

notify pgrst, 'reload schema';
