-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 049: tasas reales MP + canal Point/QR                    ║
-- ║                                                                     ║
-- ║  Agrega `mp_channel` ('point' | 'qr') a medios_pago para distinguir║
-- ║  débito Point (3.09%) vs débito QR (1.40%), que la API de MP no    ║
-- ║  diferencia (ambos vienen como payment_method.type='debit_card').  ║
-- ║                                                                     ║
-- ║  Reemplaza el seed estimativo de 047 con las tasas REALES del      ║
-- ║  panel del comercio (Mercado Pago AR, La Rioja), con IVA 21%       ║
-- ║  incluido (×1.21).                                                  ║
-- ║                                                                     ║
-- ║  Tasas reales del panel × 1.21:                                    ║
-- ║   · QR Dinero en cuenta         0.80% → 0.97%                      ║
-- ║   · Débito Point                3.09% → 3.74%                      ║
-- ║   · Débito QR                   1.40% → 1.69%                      ║
-- ║   · Crédito (Point o QR)        6.18% → 7.48%                      ║
-- ║   · Prepaga (Point o QR)        3.88% → 4.69%                      ║
-- ║   · QR Cuotas sin tarjeta       1.39% → 1.68%                      ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Columna mp_channel
-- ─────────────────────────────────────────────────────────────────────
alter table public.medios_pago
  add column if not exists mp_channel text;

-- Constraint solo si no existe
do $$ begin
  alter table public.medios_pago
    add constraint medios_pago_mp_channel_check
    check (mp_channel is null or mp_channel in ('point', 'qr'));
exception when duplicate_object then null; end $$;

comment on column public.medios_pago.mp_channel is
  'Canal del cobro: point (tarjeta física en terminal) o qr (QR en pantalla del cliente). NULL = aplica a cualquier canal. Sirve para diferenciar medios con misma payment_method.type pero distinta comisión (ej: débito Point vs QR).';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Desactivar el seed estimativo de 047 (preserva historial)
--    Los medios viejos quedan inactivos para no contaminar el modal,
--    pero las ventas que ya los hayan usado siguen viéndolos en su
--    detalle (el codigo persiste como texto en pagos_venta).
-- ─────────────────────────────────────────────────────────────────────
update public.medios_pago
set activo = false,
    disponible_terminal = false,
    updated_at = now()
where codigo like 'mp_%';

-- ─────────────────────────────────────────────────────────────────────
-- 3. Seed real con tasas del panel × IVA
--    Codigos nuevos con prefijo mp2_ para no chocar con el seed viejo.
-- ─────────────────────────────────────────────────────────────────────
insert into public.medios_pago (
  codigo, nombre, icono, activo, disponible_terminal,
  mp_payment_type, mp_payment_method_id, mp_channel,
  comision_porcentaje, dias_acreditacion, orden, protegido
) values
  ('mp2_qr_cuenta',       'QR Dinero en cuenta',       'qr-code',     false, true,
   'account_money',       null,        'qr',
   0.97, 0, 10, false),

  ('mp2_debito_point',    'Débito (Point)',            'credit-card', false, true,
   'debit_card',          null,        'point',
   3.74, 0, 20, false),

  ('mp2_debito_qr',       'Débito (QR)',               'qr-code',     false, true,
   'debit_card',          null,        'qr',
   1.69, 0, 21, false),

  ('mp2_credito',         'Crédito (Point o QR)',      'credit-card', false, true,
   'credit_card',         null,        null,
   7.48, 0, 30, false),

  ('mp2_prepaga',         'Prepaga (Point o QR)',      'credit-card', false, true,
   'prepaid_card',        null,        null,
   4.69, 0, 40, false),

  ('mp2_qr_cuotas',       'QR Cuotas sin tarjeta',     'qr-code',     false, true,
   null,                  null,        'qr',
   1.68, 0, 50, false)
on conflict (codigo) do update set
  -- Solo refresca metadata; no pisa la comisión si el usuario la ajustó
  nombre               = excluded.nombre,
  icono                = excluded.icono,
  disponible_terminal  = excluded.disponible_terminal,
  mp_payment_type      = excluded.mp_payment_type,
  mp_payment_method_id = excluded.mp_payment_method_id,
  mp_channel           = excluded.mp_channel,
  orden                = excluded.orden,
  updated_at           = now();

-- ─────────────────────────────────────────────────────────────────────
-- 4. Asignar la cuenta MP a los medios nuevos
--    Busca la cuenta tipo billetera_virtual con nombre Mercado Pago,
--    o falla silenciosamente si no existe (el usuario la asigna a mano).
-- ─────────────────────────────────────────────────────────────────────
update public.medios_pago
set cuenta_id = (
  select id from public.cuentas
  where tipo = 'billetera_virtual'
    and lower(nombre) like '%mercado pago%'
  limit 1
)
where codigo like 'mp2_%' and cuenta_id is null;

notify pgrst, 'reload schema';
