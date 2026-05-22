-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 020 · FASE 1 — Plan de cuentas contable                  ║
-- ║                                                                     ║
-- ║  Crea la tabla `plan_cuentas` y la siembra con un plan de cuentas   ║
-- ║  estándar para un comercio argentino. La jerarquía se deriva del    ║
-- ║  `codigo` (1 › 1.1 › 1.1.01). Las cuentas título no son imputables. ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

create table if not exists public.plan_cuentas (
  id serial primary key,
  codigo text not null unique,
  nombre text not null,
  tipo text not null,
  imputable boolean not null default true,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.plan_cuentas enable row level security;

do $$ begin
  create policy "todo" on public.plan_cuentas
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- Plan de cuentas estándar (comercio)
insert into public.plan_cuentas (codigo, nombre, tipo, imputable) values
  ('1', 'ACTIVO', 'activo', false),
  ('1.1', 'Activo Corriente', 'activo', false),
  ('1.1.01', 'Caja', 'activo', true),
  ('1.1.02', 'Bancos', 'activo', true),
  ('1.1.03', 'Deudores por Ventas', 'activo', true),
  ('1.1.04', 'Mercaderías', 'activo', true),
  ('1.1.05', 'IVA Crédito Fiscal', 'activo', true),
  ('1.1.06', 'Anticipos a Proveedores', 'activo', true),
  ('1.2', 'Activo No Corriente', 'activo', false),
  ('1.2.01', 'Bienes de Uso', 'activo', true),
  ('1.2.02', 'Amortización Acumulada Bienes de Uso', 'activo', true),
  ('2', 'PASIVO', 'pasivo', false),
  ('2.1', 'Pasivo Corriente', 'pasivo', false),
  ('2.1.01', 'Proveedores', 'pasivo', true),
  ('2.1.02', 'IVA Débito Fiscal', 'pasivo', true),
  ('2.1.03', 'Sueldos a Pagar', 'pasivo', true),
  ('2.1.04', 'Cargas Sociales a Pagar', 'pasivo', true),
  ('2.1.05', 'Impuestos a Pagar', 'pasivo', true),
  ('3', 'PATRIMONIO NETO', 'patrimonio', false),
  ('3.1', 'Patrimonio Neto', 'patrimonio', false),
  ('3.1.01', 'Capital', 'patrimonio', true),
  ('3.1.02', 'Resultados Acumulados', 'patrimonio', true),
  ('3.1.03', 'Resultado del Ejercicio', 'patrimonio', true),
  ('4', 'INGRESOS', 'ingreso', false),
  ('4.1', 'Ingresos', 'ingreso', false),
  ('4.1.01', 'Ventas', 'ingreso', true),
  ('4.1.02', 'Otros Ingresos', 'ingreso', true),
  ('5', 'EGRESOS', 'egreso', false),
  ('5.1', 'Costo', 'egreso', false),
  ('5.1.01', 'Costo de Mercadería Vendida', 'egreso', true),
  ('5.1.02', 'Mermas y Faltantes', 'egreso', true),
  ('5.2', 'Gastos', 'egreso', false),
  ('5.2.01', 'Sueldos y Jornales', 'egreso', true),
  ('5.2.02', 'Cargas Sociales', 'egreso', true),
  ('5.2.03', 'Alquileres', 'egreso', true),
  ('5.2.04', 'Servicios', 'egreso', true),
  ('5.2.05', 'Mantenimiento', 'egreso', true),
  ('5.2.06', 'Impuestos y Tasas', 'egreso', true),
  ('5.2.07', 'Comisiones Bancarias', 'egreso', true),
  ('5.2.08', 'Amortizaciones', 'egreso', true),
  ('5.2.09', 'Otros Gastos', 'egreso', true)
on conflict (codigo) do nothing;

-- Permiso 'contabilidad' para el rol admin
do $$ begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'roles'
  ) then
    update public.roles
    set permisos = array_append(permisos, 'contabilidad'),
        updated_at = now()
    where codigo = 'admin'
      and not ('contabilidad' = any(permisos));
  end if;
end $$;

notify pgrst, 'reload schema';
