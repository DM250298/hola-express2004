-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 054: módulo fiscal — config + comprobantes formales       ║
-- ║                                                                     ║
-- ║  1. Tabla `config_fiscal` (singleton id=1): CUIT propio, condición  ║
-- ║     IVA, alícuota de IIBB La Rioja y días de vencimiento. Alimenta  ║
-- ║     el tab Impuestos y el calendario de vencimientos.               ║
-- ║                                                                     ║
-- ║  2. Campos formales en `facturas_compra`: tipo (A/B/C/M/E), punto   ║
-- ║     de venta, número, CAE y CUIT del proveedor. Necesarios para el  ║
-- ║     libro IVA Compras y para cruzar con "Mis Comprobantes" de AFIP. ║
-- ║                                                                     ║
-- ║  Migración ADITIVA: NO toca fn_guardar_factura_compra ni ningún     ║
-- ║  RPC. Los campos formales se escriben con un UPDATE de cabecera      ║
-- ║  desde el cliente, después del RPC de costos.                       ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Configuración fiscal (singleton)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.config_fiscal (
  id                    integer primary key default 1,
  cuit                  text    not null default '',
  razon_social          text    not null default 'Hola Express',
  condicion_iva         text    not null default 'responsable_inscripto',
  iibb_jurisdiccion     text    not null default 'La Rioja',
  iibb_alicuota         numeric(5,2) not null default 3.00,   -- % sobre ventas netas
  iva_alicuota_general  numeric(5,2) not null default 21.00,
  iva_dia_vencimiento   integer not null default 18,           -- día del mes (aprox CUIT)
  iibb_dia_vencimiento  integer not null default 22,
  actividad             text    not null default 'Venta al por menor en minimercados',
  updated_at            timestamptz not null default now(),
  constraint config_fiscal_singleton check (id = 1)
);

insert into public.config_fiscal (id) values (1) on conflict (id) do nothing;

alter table public.config_fiscal enable row level security;
do $$ begin
  create policy "todo" on public.config_fiscal
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Campos formales del comprobante de compra
--    `fecha` ya existe y pasa a interpretarse como fecha de EMISIÓN
--    (la elige el usuario al cargar), que es la relevante para el
--    período fiscal del IVA crédito.
-- ─────────────────────────────────────────────────────────────────────
alter table public.facturas_compra
  add column if not exists tipo_comprobante  text,             -- 'A' | 'B' | 'C' | 'M' | 'E'
  add column if not exists punto_venta        text,            -- ej '0001'
  add column if not exists numero_comprobante text,            -- ej '00001234'
  add column if not exists cae                text,            -- CAE/CAI del comprobante
  add column if not exists cuit_proveedor      text;

comment on column public.facturas_compra.tipo_comprobante is
  'Letra del comprobante AFIP: A, B, C, M o E. Define si el IVA está discriminado (A/M) o no (B/C).';
comment on column public.facturas_compra.fecha is
  'Fecha de EMISIÓN del comprobante (no la de carga). Determina el período fiscal del IVA crédito y del IIBB.';

-- Anti-duplicado: un mismo proveedor no puede tener dos veces el mismo
-- comprobante (tipo + punto de venta + número). Índice parcial: solo
-- aplica cuando los 4 campos están cargados.
create unique index if not exists uq_factura_compra_comprobante
  on public.facturas_compra (cuit_proveedor, tipo_comprobante, punto_venta, numero_comprobante)
  where cuit_proveedor is not null
    and tipo_comprobante is not null
    and punto_venta is not null
    and numero_comprobante is not null;

notify pgrst, 'reload schema';
