-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 100 · Backfill de la infraestructura de la 053           ║
-- ║                                                                     ║
-- ║  La 053 (R5 · cierre de período + auditoría) NUNCA se aplicó en la  ║
-- ║  base de producción (verificado 2026-07-09: periodos_contables y    ║
-- ║  auditoria daban NULL; fn_auditar / fn_periodo_cerrado no existían).║
-- ║  Consecuencia real: fn_anular_venta (versión 071, aplicada) llama a ║
-- ║  fn_periodo_cerrado y fn_auditar → tiraba "function does not exist"  ║
-- ║  al anular cualquier venta. Confirmado con pg_get_functiondef.       ║
-- ║                                                                     ║
-- ║  Este backfill trae SOLO la infraestructura de la 053 (tablas +     ║
-- ║  helpers). NO re-emite las RPCs operativas que la 053 también        ║
-- ║  redefine (fn_anular_venta, fn_validar_arqueo, fn_generar_remesa,   ║
-- ║  fn_guardar_factura_compra): esas ya tienen versiones MÁS NUEVAS en ║
-- ║  la base (071+) y re-emitir las de la 053 sería un retroceso.       ║
-- ║  Apenas existen fn_periodo_cerrado y fn_auditar, las RPCs vivas       ║
-- ║  funcionan solas.                                                   ║
-- ║                                                                     ║
-- ║  Idempotente. Ejecutar UNA sola vez, COMPLETO, en el SQL Editor.    ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── Tablas ──────────────────────────────────────────────────────────
create table if not exists public.periodos_contables (
  id             serial primary key,
  anio           integer not null,
  mes            integer not null,
  estado         text not null default 'abierto',  -- 'abierto' | 'cerrado'
  fecha_cierre   timestamptz,
  usuario_cierre uuid references public.usuarios(id),
  unique (anio, mes)
);
alter table public.periodos_contables enable row level security;
do $$ begin
  create policy "gate" on public.periodos_contables for all to authenticated
    using (public.fn_tiene_permiso('contabilidad'))
    with check (public.fn_tiene_permiso('contabilidad'));
exception when duplicate_object then null; end $$;

create table if not exists public.auditoria (
  id          serial primary key,
  usuario_id  uuid references public.usuarios(id),
  accion      text not null,
  entidad     text,
  entidad_id  integer,
  detalle     jsonb,
  ip          text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_auditoria_fecha on public.auditoria(created_at desc);
create index if not exists idx_auditoria_accion on public.auditoria(accion);
alter table public.auditoria enable row level security;
do $$ begin
  create policy "gate" on public.auditoria for all to authenticated
    using (public.fn_tiene_permiso('contabilidad'))
    with check (public.fn_tiene_permiso('contabilidad'));
exception when duplicate_object then null; end $$;

-- ─── Helpers ─────────────────────────────────────────────────────────
create or replace function public.fn_ip() returns text
language plpgsql stable as $$
declare v_h text; v_j json;
begin
  v_h := current_setting('request.headers', true);
  if v_h is null or v_h = '' then return null; end if;
  v_j := v_h::json;
  return coalesce(
    nullif(split_part(coalesce(v_j->>'x-forwarded-for', ''), ',', 1), ''),
    v_j->>'x-real-ip'
  );
exception when others then return null;
end $$;

create or replace function public.fn_auditar(
  p_usuario_id uuid, p_accion text, p_entidad text,
  p_entidad_id integer, p_detalle jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.auditoria (usuario_id, accion, entidad, entidad_id, detalle, ip)
  values (p_usuario_id, p_accion, p_entidad, p_entidad_id, p_detalle, public.fn_ip());
end $$;

create or replace function public.fn_periodo_cerrado(p_fecha date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.periodos_contables
    where anio = extract(year from p_fecha)::int
      and mes = extract(month from p_fecha)::int
      and estado = 'cerrado'
  )
$$;
grant execute on function public.fn_periodo_cerrado(date) to authenticated;

-- ─── Cerrar / reabrir período ────────────────────────────────────────
create or replace function public.fn_cerrar_periodo(
  p_usuario_id uuid, p_anio integer, p_mes integer
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.periodos_contables (anio, mes, estado, fecha_cierre, usuario_cierre)
  values (p_anio, p_mes, 'cerrado', now(), p_usuario_id)
  on conflict (anio, mes)
  do update set estado = 'cerrado', fecha_cierre = now(), usuario_cierre = p_usuario_id;
  perform public.fn_auditar(p_usuario_id, 'cerrar_periodo', 'periodo', null,
    jsonb_build_object('anio', p_anio, 'mes', p_mes));
end $$;

create or replace function public.fn_reabrir_periodo(
  p_usuario_id uuid, p_anio integer, p_mes integer
) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.periodos_contables
    set estado = 'abierto', fecha_cierre = null, usuario_cierre = null
    where anio = p_anio and mes = p_mes;
  perform public.fn_auditar(p_usuario_id, 'reabrir_periodo', 'periodo', null,
    jsonb_build_object('anio', p_anio, 'mes', p_mes));
end $$;

notify pgrst, 'reload schema';
