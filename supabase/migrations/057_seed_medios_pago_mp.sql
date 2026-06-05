-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 047: seed de medios de pago Mercado Pago Point AR       ║
-- ║                                                                     ║
-- ║  Pre-carga los medios de pago específicos que devuelve la API de   ║
-- ║  MP Point, con auto-detección configurada y comisiones con IVA     ║
-- ║  ya incluido (×1.21).                                               ║
-- ║                                                                     ║
-- ║  Supuestos:                                                         ║
-- ║  · Plazo de acreditación: al instante (dias = 0)                   ║
-- ║  · IVA 21% incluido en la comisión (resultado: tasa neta real)     ║
-- ║  · Sin cuotas sin interés                                          ║
-- ║                                                                     ║
-- ║  Tasas públicas de referencia MP AR (al 2026):                     ║
-- ║  · QR cuenta MP:  0.60% × 1.21 = 0.73%                             ║
-- ║  · Débito:        1.20% × 1.21 = 1.45%                             ║
-- ║  · Crédito:       6.29% × 1.21 = 7.61%                             ║
-- ║  · Prepaga:       6.29% × 1.21 = 7.61%                             ║
-- ║                                                                     ║
-- ║  ⚠ Verificá en tu panel de MP (Costos y comisiones) si las tasas   ║
-- ║    tuyas difieren y ajustá `comision_porcentaje` en cada fila.     ║
-- ║                                                                     ║
-- ║  Es idempotente: podés volver a correrla y solo actualiza los      ║
-- ║  campos no-comisión (para no pisar ajustes manuales que hagas).    ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- 1. Desactivar de terminal los medios genéricos legacy.
--    Quedan visibles en POS (efectivo solo) pero ya no aparecen en el
--    modal de cobro con posnet — los reemplazan los específicos de abajo.
update public.medios_pago
set disponible_terminal = false,
    updated_at = now()
where codigo in ('debito', 'credito');

-- 2. Insertar / actualizar medios MP específicos.
--    `on conflict` solo refresca nombre, icono, mapeo MP y flags — NO pisa
--    la comisión ni la cuenta para preservar ajustes manuales del usuario.

insert into public.medios_pago (
  codigo, nombre, icono, activo, disponible_terminal,
  mp_payment_type, mp_payment_method_id,
  comision_porcentaje, dias_acreditacion, orden, protegido
) values
  -- ── QR Dinero en cuenta MP (account_money)
  ('mp_qr_cuenta',        'QR Dinero en cuenta',   'qr-code',     false, true,
   'account_money',       null,                    0.73, 0, 10, false),

  -- ── Débito (1.45% con IVA)
  ('mp_debito_visa',      'Débito Visa',           'credit-card', false, true,
   'debit_card',          'debvisa',               1.45, 0, 20, false),
  ('mp_debito_master',    'Débito Mastercard',     'credit-card', false, true,
   'debit_card',          'debmaster',             1.45, 0, 21, false),
  ('mp_debito_maestro',   'Débito Maestro',        'credit-card', false, true,
   'debit_card',          'maestro',               1.45, 0, 22, false),
  ('mp_debito_cabal',     'Débito Cabal',          'credit-card', false, true,
   'debit_card',          'debcabal',              1.45, 0, 23, false),
  ('mp_debito_otros',     'Débito otros',          'credit-card', false, true,
   'debit_card',          null,                    1.45, 0, 29, false),

  -- ── Crédito (7.61% con IVA)
  ('mp_credito_visa',     'Crédito Visa',          'credit-card', false, true,
   'credit_card',         'visa',                  7.61, 0, 30, false),
  ('mp_credito_master',   'Crédito Mastercard',    'credit-card', false, true,
   'credit_card',         'master',                7.61, 0, 31, false),
  ('mp_credito_amex',     'Crédito Amex',          'credit-card', false, true,
   'credit_card',         'amex',                  7.61, 0, 32, false),
  ('mp_credito_naranja',  'Crédito Naranja',       'credit-card', false, true,
   'credit_card',         'naranja',               7.61, 0, 33, false),
  ('mp_credito_cabal',    'Crédito Cabal',         'credit-card', false, true,
   'credit_card',         'cabal',                 7.61, 0, 34, false),
  ('mp_credito_diners',   'Crédito Diners',        'credit-card', false, true,
   'credit_card',         'diners',                7.61, 0, 35, false),
  ('mp_credito_argencard','Crédito Argencard',     'credit-card', false, true,
   'credit_card',         'argencard',             7.61, 0, 36, false),
  ('mp_credito_cmr',      'Crédito CMR Falabella', 'credit-card', false, true,
   'credit_card',         'cmr',                   7.61, 0, 37, false),
  ('mp_credito_otros',    'Crédito otros',         'credit-card', false, true,
   'credit_card',         null,                    7.61, 0, 39, false),

  -- ── Prepaga (Ualá, Brubank, Naranja X, etc) — 7.61% con IVA
  ('mp_prepaga',          'Tarjeta prepaga',       'credit-card', false, true,
   'prepaid_card',        null,                    7.61, 0, 40, false)
on conflict (codigo) do update set
  -- Solo refresca metadata y mapeo MP. No pisa comisión ni cuenta.
  nombre               = excluded.nombre,
  icono                = excluded.icono,
  disponible_terminal  = excluded.disponible_terminal,
  mp_payment_type      = excluded.mp_payment_type,
  mp_payment_method_id = excluded.mp_payment_method_id,
  orden                = excluded.orden,
  updated_at           = now();

notify pgrst, 'reload schema';
