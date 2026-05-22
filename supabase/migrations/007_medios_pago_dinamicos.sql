-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 007: medios de pago dinámicos                            ║
-- ║                                                                     ║
-- ║  Reemplaza el enum fijo `medio_pago` por una tabla `medios_pago`    ║
-- ║  que permite agregar / editar / borrar medios desde la app.         ║
-- ║                                                                     ║
-- ║  · Crea la tabla `medios_pago` (con config de cuenta y comisión).   ║
-- ║  · Migra la config previa de `mapeo_medio_pago_cuenta`.             ║
-- ║  · Convierte `ventas.medio_pago` y `pagos_venta.medio_pago` a text. ║
-- ║  · Elimina `mapeo_medio_pago_cuenta` y el tipo enum `medio_pago`.   ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- 1. Tabla de medios de pago
create table if not exists public.medios_pago (
  id serial primary key,
  codigo text not null unique,
  nombre text not null,
  icono text not null default 'wallet',
  activo boolean not null default true,
  orden integer not null default 0,
  comision_porcentaje numeric(5,2) not null default 0,
  cuenta_id integer references public.cuentas(id) on delete set null,
  protegido boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.medios_pago enable row level security;

do $$ begin
  create policy "todo" on public.medios_pago
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null;
end $$;

-- 2. Sembrar los 4 medios base
insert into public.medios_pago (codigo, nombre, icono, orden, protegido)
values
  ('efectivo', 'Efectivo', 'banknote', 1, true),
  ('debito', 'Débito', 'credit-card', 2, false),
  ('credito', 'Crédito', 'wallet', 3, false),
  ('transferencia', 'Transferencia', 'smartphone', 4, false)
on conflict (codigo) do nothing;

-- 3. Copiar la config previa (cuenta + comisión + activo) desde mapeo_medio_pago_cuenta
do $$ begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'mapeo_medio_pago_cuenta'
  ) then
    update public.medios_pago mp
    set cuenta_id = m.cuenta_id,
        comision_porcentaje = coalesce(m.comision_porcentaje, 0),
        activo = coalesce(m.activo, true)
    from public.mapeo_medio_pago_cuenta m
    where m.medio_pago::text = mp.codigo;
  end if;
end $$;

-- 4. Convertir las columnas enum -> text (cualquier medio nuevo es válido)
alter table public.ventas
  alter column medio_pago drop default;
alter table public.ventas
  alter column medio_pago type text using medio_pago::text;

alter table public.pagos_venta
  alter column medio_pago type text using medio_pago::text;

-- 5. Eliminar la tabla de mapeo (reemplazada por medios_pago)
drop table if exists public.mapeo_medio_pago_cuenta;

-- 6. Eliminar el tipo enum ya sin uso
drop type if exists public.medio_pago;

notify pgrst, 'reload schema';
