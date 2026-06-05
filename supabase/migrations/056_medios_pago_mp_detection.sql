-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 046: auto-detección de método MP en cobros de terminal   ║
-- ║                                                                     ║
-- ║  Agrega columnas para mapear cada medio de pago a lo que devuelve   ║
-- ║  la API de Mercado Pago Point al aprobarse una orden:               ║
-- ║                                                                     ║
-- ║  · `mp_payment_type`       → ej: credit_card, debit_card,           ║
-- ║                              account_money, digital_currency, etc.  ║
-- ║  · `mp_payment_method_id`  → ej: visa, master, amex, naranja,       ║
-- ║                              mercadopago_cc, account_money_qr.      ║
-- ║                              Si es NULL, hace fallback "cualquier   ║
-- ║                              método de ese type".                   ║
-- ║                                                                     ║
-- ║  Al aprobarse una orden, el POS busca el medio más específico       ║
-- ║  (type + method_id) → cae al type genérico → cae al medio que       ║
-- ║  eligió el cajero manualmente como fallback.                        ║
-- ║                                                                     ║
-- ║  Así cada venta queda con la comisión exacta correspondiente al     ║
-- ║  método real que usó el cliente (sin que el cajero adivine).        ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.medios_pago
  add column if not exists mp_payment_type text,
  add column if not exists mp_payment_method_id text;

-- Índice parcial para acelerar el lookup al aprobarse cada cobro
create index if not exists idx_medios_pago_mp_lookup
  on public.medios_pago (mp_payment_type, mp_payment_method_id)
  where mp_payment_type is not null;

comment on column public.medios_pago.mp_payment_type is
  'Tipo de pago que devuelve MP Point: credit_card, debit_card, account_money, digital_currency, etc. Si está seteado, este medio se auto-selecciona cuando una orden de terminal devuelve ese type.';

comment on column public.medios_pago.mp_payment_method_id is
  'ID específico del método MP: visa, master, amex, naranja, mercadopago_cc, etc. Si está seteado, se requiere match exacto. NULL = matchea cualquier método del type.';

notify pgrst, 'reload schema';
