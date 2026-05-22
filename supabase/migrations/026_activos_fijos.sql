-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 026 · FASE 1 — Activos fijos (bienes de uso)             ║
-- ║                                                                     ║
-- ║  Registro del inmovilizado. Al dar de alta un activo se genera su   ║
-- ║  asiento (Debe Bienes de Uso / Haber Caja). La amortización lineal  ║
-- ║  se calcula en la app.                                               ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

create table if not exists public.activos_fijos (
  id serial primary key,
  nombre text not null,
  descripcion text,
  fecha_adquisicion date not null default current_date,
  valor_origen numeric(14,2) not null default 0,
  vida_util_meses integer not null default 12,
  valor_residual numeric(14,2) not null default 0,
  estado text not null default 'activo',
  fecha_baja date,
  usuario_id uuid references public.usuarios(id),
  created_at timestamptz not null default now()
);

alter table public.activos_fijos enable row level security;

do $$ begin
  create policy "todo" on public.activos_fijos
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

create or replace function public.fn_crear_activo(
  p_nombre text,
  p_descripcion text,
  p_fecha_adquisicion date,
  p_valor_origen numeric,
  p_vida_util_meses integer,
  p_valor_residual numeric,
  p_usuario_id uuid
) returns public.activos_fijos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activo public.activos_fijos;
  v_asiento_id integer;
  v_cta_bienes integer;
  v_cta_caja integer;
begin
  insert into public.activos_fijos (
    nombre, descripcion, fecha_adquisicion, valor_origen,
    vida_util_meses, valor_residual, usuario_id
  ) values (
    p_nombre, p_descripcion, p_fecha_adquisicion, p_valor_origen,
    p_vida_util_meses, coalesce(p_valor_residual, 0), p_usuario_id
  )
  returning * into v_activo;

  select id into v_cta_bienes from public.plan_cuentas where codigo = '1.2.01';
  select id into v_cta_caja from public.plan_cuentas where codigo = '1.1.01';

  if p_valor_origen > 0 and v_cta_bienes is not null and v_cta_caja is not null then
    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (p_fecha_adquisicion, 'Alta de activo: ' || p_nombre,
            'automatico', 'activo_fijo', v_activo.id, p_usuario_id)
    returning id into v_asiento_id;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_bienes, p_valor_origen, 0, 0);
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_caja, 0, p_valor_origen, 1);
  end if;

  return v_activo;
end;
$$;

notify pgrst, 'reload schema';
