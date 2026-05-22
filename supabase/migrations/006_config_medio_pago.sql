-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 006: configuración por medio_pago                        ║
-- ║                                                                     ║
-- ║  Extiende `mapeo_medio_pago_cuenta` con dos columnas adicionales:   ║
-- ║    · activo                → si se ofrece o no el medio en el POS    ║
-- ║    · comision_porcentaje   → comisión informativa (%) para reportes  ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez en SQL Editor de Supabase.                   ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.mapeo_medio_pago_cuenta
  add column if not exists activo boolean not null default true;

alter table public.mapeo_medio_pago_cuenta
  add column if not exists comision_porcentaje numeric(5,2) not null default 0;

-- Asegurar que existan las 4 filas (una por medio) aunque no estén mapeadas
insert into public.mapeo_medio_pago_cuenta (medio_pago, cuenta_id)
values ('efectivo', null), ('debito', null), ('credito', null), ('transferencia', null)
on conflict (medio_pago) do nothing;

notify pgrst, 'reload schema';
