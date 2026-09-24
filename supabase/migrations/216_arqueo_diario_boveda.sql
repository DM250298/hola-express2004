-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 216 · Arqueo diario de la bóveda (Caja Efectivo)         ║
-- ║                                                                     ║
-- ║  Pedido del administrativo: "una opción de arqueo de efectivo para  ║
-- ║  controlar cómo va día a día la caja". El arqueo que existía        ║
-- ║  (fn_validar_arqueo) valida SOBRES del buzón; nadie contaba toda    ║
-- ║  la plata de la caja fuerte contra su saldo.                        ║
-- ║                                                                     ║
-- ║  · arqueos_boveda: un conteo físico de la bóveda (con el detalle de ║
-- ║    billetes) contra cuentas.saldo_actual en ese momento. Historial  ║
-- ║    día a día. RLS: lectura con permiso 'finanzas'; se escribe solo  ║
-- ║    por la RPC.                                                      ║
-- ║  · fn_arqueo_boveda: guarda el conteo. Con diferencia, la nota es   ║
-- ║    obligatoria; si el ADMIN pide ajustar, registra el ingreso/      ║
-- ║    egreso por fn_registrar_mov_caja_fuerte (mismo circuito que el   ║
-- ║    movimiento manual → el banner de descuadre no salta) y el saldo  ║
-- ║    queda igual a lo contado. Audita.                                ║
-- ║                                                                     ║
-- ║  REQUIERE: 118 (bóveda) y 053/100 (fn_auditar).                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO.                                   ║
-- ╚════════════════════════════════════════════════════════════════════╝

create table if not exists public.arqueos_boveda (
  id                serial primary key,
  fecha             date not null default ((now() at time zone 'America/Argentina/La_Rioja')::date),
  usuario_id        uuid references public.usuarios(id),
  saldo_sistema     numeric(14,2) not null,
  contado           numeric(14,2) not null check (contado >= 0),
  diferencia        numeric(14,2) not null,
  detalle_billetes  jsonb,
  nota              text,
  ajuste_aplicado   boolean not null default false,
  movimiento_cf_id  integer,
  created_at        timestamptz not null default now()
);

create index if not exists idx_arqueos_boveda_fecha
  on public.arqueos_boveda (fecha desc, id desc);

-- RLS: lectura gateada; sin policy de escritura (solo la RPC definer).
alter table public.arqueos_boveda enable row level security;
do $$
declare v_pol text;
begin
  for v_pol in select policyname from pg_policies
                where schemaname = 'public' and tablename = 'arqueos_boveda'
  loop
    execute format('drop policy %I on public.arqueos_boveda', v_pol);
  end loop;
end $$;
create policy "arqueos_boveda_select" on public.arqueos_boveda
  for select to authenticated
  using ((select public.fn_tiene_permiso('finanzas')));

-- ─── RPC ────────────────────────────────────────────────────────────
create or replace function public.fn_arqueo_boveda(
  p_usuario_id     uuid,
  p_contado        numeric,
  p_detalle        jsonb,
  p_nota           text,
  p_aplicar_ajuste boolean
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_cuenta_id integer;
  v_saldo numeric;
  v_contado numeric := round(p_contado, 2);
  v_dif numeric;
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
  v_id integer;
  v_mov jsonb;
  v_mov_id integer;
begin
  if not (select public.fn_tiene_permiso('finanzas')) then
    raise exception 'No tenés permiso para arquear la caja fuerte.';
  end if;
  if v_contado is null or v_contado < 0 then
    raise exception 'El monto contado no puede ser negativo.';
  end if;

  v_cuenta_id := public.fn_cuenta_caja_fuerte();
  -- FOR UPDATE: nadie mueve la bóveda entre la lectura y el ajuste.
  select saldo_actual into v_saldo from public.cuentas where id = v_cuenta_id for update;
  v_dif := round(v_contado - v_saldo, 2);

  if v_dif <> 0 and v_nota is null then
    raise exception 'Hay una diferencia de %: explicá en la nota qué pasó.', v_dif;
  end if;
  if p_aplicar_ajuste and v_dif <> 0 and coalesce(public.fn_mi_rol(), '') <> 'admin' then
    raise exception 'Solo un administrador puede ajustar el saldo de la caja fuerte.';
  end if;

  insert into public.arqueos_boveda (
    usuario_id, saldo_sistema, contado, diferencia, detalle_billetes, nota
  ) values (
    p_usuario_id, v_saldo, v_contado, v_dif, p_detalle, v_nota
  ) returning id into v_id;

  if p_aplicar_ajuste and v_dif <> 0 then
    v_mov := public.fn_registrar_mov_caja_fuerte(
      p_usuario_id,
      case when v_dif > 0 then 'ingreso' else 'egreso' end,
      abs(v_dif),
      'Ajuste por arqueo de bóveda #' || v_id || ' · ' || v_nota
    );
    v_mov_id := (v_mov->>'id')::integer;
    update public.arqueos_boveda
       set ajuste_aplicado = true, movimiento_cf_id = v_mov_id
     where id = v_id;
  end if;

  perform public.fn_auditar(
    p_usuario_id, 'arqueo_boveda', 'arqueo_boveda', v_id,
    jsonb_build_object('saldo_sistema', v_saldo, 'contado', v_contado,
                       'diferencia', v_dif, 'ajuste', p_aplicar_ajuste and v_dif <> 0)
  );

  return jsonb_build_object(
    'id', v_id, 'saldo_sistema', v_saldo, 'contado', v_contado,
    'diferencia', v_dif, 'ajuste_aplicado', p_aplicar_ajuste and v_dif <> 0
  );
end $$;

revoke execute on function public.fn_arqueo_boveda(uuid, numeric, jsonb, text, boolean) from anon;
grant execute on function public.fn_arqueo_boveda(uuid, numeric, jsonb, text, boolean) to authenticated;

-- Verificación:
--   select to_regclass('public.arqueos_boveda');
--   select to_regprocedure('public.fn_arqueo_boveda(uuid,numeric,jsonb,text,boolean)');
--   (en el SQL Editor no hay usuario logueado: la RPC rechaza por permiso;
--    se prueba desde la app, Finanzas › Caja fuerte › Arqueo del día)

notify pgrst, 'reload schema';
