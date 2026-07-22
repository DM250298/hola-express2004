-- 117_movimientos_caja_fuerte.sql
-- Ingresos/egresos manuales de la caja fuerte (aportes, retiros del dueño,
-- pagos en efectivo, ajustes). Entran al saldo del número grande de la pestaña
-- Caja fuerte: un ingreso suma, un egreso resta.
--
-- Importante: NO tocan la cuenta "Caja Efectivo" (acumulador histórico de ventas)
-- ni ninguna cuenta de `cuentas`. El saldo de la bóveda se calcula aparte, del
-- circuito de conteo (arqueos) + estos movimientos − remesas. Ver
-- lib/queries/cajaFuerte.ts (getSaldoCajaFuerte).

-- ─── Tabla ───────────────────────────────────────────────────────────────────
create table if not exists public.movimientos_caja_fuerte (
  id          serial primary key,
  usuario_id  uuid references public.usuarios(id),
  tipo        text not null check (tipo in ('ingreso','egreso')),
  monto       numeric(12,2) not null check (monto > 0),
  nota        text not null,                                   -- obligatoria (auditable)
  -- Comercio 24 h en La Rioja (UTC−3): current_date en UTC archivaría los
  -- movimientos de la madrugada con la fecha de mañana → se usa la fecha local.
  fecha       date not null default ((now() at time zone 'America/Argentina/La_Rioja')::date),
  created_at  timestamptz not null default now()
);

create index if not exists idx_mcf_fecha on public.movimientos_caja_fuerte(fecha desc);

-- ─── RLS gateada por 'finanzas' ──────────────────────────────────────────────
-- Patrón del repo (migración 111): dropear cualquier policy previa antes de
-- crear la gateada, y envolver la llamada en (select ...) → InitPlan (una
-- evaluación por query, no por fila).
alter table public.movimientos_caja_fuerte enable row level security;

do $$
declare v_pol text;
begin
  for v_pol in select policyname from pg_policies
    where schemaname = 'public' and tablename = 'movimientos_caja_fuerte'
  loop execute format('drop policy %I on public.movimientos_caja_fuerte', v_pol); end loop;
end $$;

create policy "mcf_rw" on public.movimientos_caja_fuerte
  for all to authenticated
  using ((select public.fn_tiene_permiso('finanzas')))
  with check ((select public.fn_tiene_permiso('finanzas')));

-- ─── RPC: registrar movimiento manual ────────────────────────────────────────
-- security definer → bypassa RLS, así que valida el permiso adentro. Bloquea el
-- egreso que dejaría la bóveda en negativo y audita el movimiento.
create or replace function public.fn_registrar_mov_caja_fuerte(
  p_usuario_id uuid,
  p_tipo       text,
  p_monto      numeric,
  p_nota       text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    integer;
  v_monto numeric := round(p_monto, 2);
  v_saldo numeric;
begin
  if not (select public.fn_tiene_permiso('finanzas')) then
    raise exception 'No tenés permiso para mover la caja fuerte.';
  end if;
  if p_tipo not in ('ingreso','egreso') then
    raise exception 'Tipo inválido: %. Debe ser "ingreso" o "egreso".', p_tipo;
  end if;
  if v_monto is null or v_monto <= 0 then
    raise exception 'El monto debe ser mayor a cero.';
  end if;
  if p_nota is null or btrim(p_nota) = '' then
    raise exception 'La nota es obligatoria.';
  end if;

  -- Bloqueo de saldo negativo (mismo criterio que getSaldoCajaFuerte):
  -- arqueado + manuales − remesas.
  if p_tipo = 'egreso' then
    v_saldo := coalesce((select sum(monto_fisico) from public.arqueos_tesoreria), 0)
             + coalesce((select sum(case when tipo = 'ingreso' then monto else -monto end)
                         from public.movimientos_caja_fuerte), 0)
             - coalesce((select sum(monto) from public.remesas), 0);
    if v_saldo - v_monto < 0 then
      raise exception 'El egreso deja la bóveda en negativo (saldo actual %).', v_saldo;
    end if;
  end if;

  insert into public.movimientos_caja_fuerte (usuario_id, tipo, monto, nota)
  values (p_usuario_id, p_tipo, v_monto, btrim(p_nota))
  returning id into v_id;

  perform public.fn_auditar(
    p_usuario_id, 'movimiento_caja_fuerte', 'movimiento_caja_fuerte', v_id,
    jsonb_build_object('tipo', p_tipo, 'monto', v_monto)
  );

  return jsonb_build_object('id', v_id, 'tipo', p_tipo, 'monto', v_monto);
end $$;

revoke execute on function public.fn_registrar_mov_caja_fuerte(uuid, text, numeric, text) from anon;

notify pgrst, 'reload schema';
