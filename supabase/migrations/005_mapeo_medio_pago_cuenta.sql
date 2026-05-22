-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 005: mapeo medio_pago → cuenta                           ║
-- ║                                                                     ║
-- ║  Por cada medio_pago configuramos a qué cuenta van los ingresos     ║
-- ║  cuando se confirma una venta en el POS. Una fila por medio.        ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez en SQL Editor de Supabase.                   ║
-- ╚════════════════════════════════════════════════════════════════════╝

create table if not exists public.mapeo_medio_pago_cuenta (
  medio_pago public.medio_pago primary key,
  cuenta_id integer references public.cuentas(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.mapeo_medio_pago_cuenta enable row level security;

do $$ begin
  create policy "todo" on public.mapeo_medio_pago_cuenta
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null;
end $$;

-- Seed inicial: mapeamos automáticamente a las cuentas seed si existen
insert into public.mapeo_medio_pago_cuenta (medio_pago, cuenta_id)
select 'efectivo', id from public.cuentas where nombre = 'Caja Efectivo' limit 1
on conflict (medio_pago) do nothing;

insert into public.mapeo_medio_pago_cuenta (medio_pago, cuenta_id)
select 'debito', id from public.cuentas where nombre = 'Banco Principal' limit 1
on conflict (medio_pago) do nothing;

insert into public.mapeo_medio_pago_cuenta (medio_pago, cuenta_id)
select 'credito', id from public.cuentas where nombre = 'Banco Principal' limit 1
on conflict (medio_pago) do nothing;

insert into public.mapeo_medio_pago_cuenta (medio_pago, cuenta_id)
select 'transferencia', id from public.cuentas where nombre = 'Mercado Pago' limit 1
on conflict (medio_pago) do nothing;

notify pgrst, 'reload schema';
