-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 108 · config del motor de precios (margen asegurado)      ║
-- ║                                                                     ║
-- ║  El motor de pricing (lib/pricing) calcula el precio de venta        ║
-- ║  DIVIDIENDO por (1 − cargas) para asegurar el margen después de      ║
-- ║  IIBB + imp. créd/déb + comisión MP. Ver ESPECIFICACION-PRICING.md.  ║
-- ║                                                                     ║
-- ║  Casi toda la config ya vivía en config_fiscal:                      ║
-- ║    · iibb_alicuota          → IIBB (3% La Rioja)                      ║
-- ║    · iva_alicuota_general   → IVA (21%)                               ║
-- ║    · condicion_iva          → régimen (responsable_inscripto)         ║
-- ║  Y la comisión de MP (peor caso) se deriva de medios_pago            ║
-- ║  (max(comision_porcentaje)/1.21, ver lib/pricing/config.ts).         ║
-- ║                                                                     ║
-- ║  Solo faltaban dos parámetros; se agregan acá (ADITIVA):             ║
-- ║    · impuesto_deb_cred_alicuota → imp. créditos y débitos (1.2%      ║
-- ║      completo: 0.6% entrada + 0.6% salida)                            ║
-- ║    · redondeo_multiplo          → redondeo comercial (techo a $50)    ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.config_fiscal
  add column if not exists impuesto_deb_cred_alicuota numeric(5,2) not null default 1.20,
  add column if not exists redondeo_multiplo          integer      not null default 50;

comment on column public.config_fiscal.impuesto_deb_cred_alicuota is
  'Alícuota del impuesto a los créditos y débitos, % sobre el TOTAL cobrado. Se carga completo (1.20 = 0.6% al acreditar la venta + 0.6% al transferir al banco) para que el precio cubra ambas patas. Usado por el motor de pricing.';

comment on column public.config_fiscal.redondeo_multiplo is
  'Múltiplo del redondeo comercial del precio de venta, en pesos (ej: 50). El motor redondea SIEMPRE hacia arriba (techo) para no erosionar el margen garantizado.';

-- Guarda de sanidad: el múltiplo tiene que ser positivo.
do $$ begin
  alter table public.config_fiscal
    add constraint config_fiscal_redondeo_multiplo_pos check (redondeo_multiplo > 0);
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
