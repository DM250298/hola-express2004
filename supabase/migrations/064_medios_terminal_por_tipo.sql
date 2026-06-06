-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 064: medios de terminal por TIPO (cobro automático)      ║
-- ║                                                                     ║
-- ║  Ahora que la comisión + IIBB salen REALES de MP (063), el cajero   ║
-- ║  ya no elige Point/QR: toca "Enviar a la terminal" y la venta se    ║
-- ║  registra sola con el tipo y la comisión que reporta MP.            ║
-- ║                                                                     ║
-- ║  Para eso necesitamos UN medio por payment_method.type de MP        ║
-- ║  (channel-agnóstico), y un catch-all para tipos no mapeados:        ║
-- ║   · account_money  → QR Dinero en cuenta                           ║
-- ║   · bank_transfer  → QR Transferencia (interop / otra billetera)   ║
-- ║   · debit_card     → Débito                                        ║
-- ║   · credit_card    → Crédito                                       ║
-- ║   · prepaid_card   → Prepaga                                       ║
-- ║   · (otro)         → mp2_otros (catch-all)                         ║
-- ║                                                                     ║
-- ║  La comisión de la tabla queda solo como respaldo (si MP no manda   ║
-- ║  el detalle); en la práctica gana siempre el valor real.           ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- account_money channel-agnóstico (antes estaba marcado 'qr')
update public.medios_pago
set mp_channel = null, updated_at = now()
where codigo = 'mp2_qr_cuenta';

-- Colapsar débito Point/QR y cuotas: ya no se usan (los reemplaza el genérico).
-- Se desactivan (no se borran) para preservar historial de ventas viejas.
update public.medios_pago
set activo = false, disponible_terminal = false, updated_at = now()
where codigo in ('mp2_debito_point', 'mp2_debito_qr', 'mp2_qr_cuotas');

-- Medios nuevos por tipo + catch-all. cuenta = billetera Mercado Pago.
insert into public.medios_pago (
  codigo, nombre, icono, activo, disponible_terminal,
  mp_payment_type, mp_payment_method_id, mp_channel,
  comision_porcentaje, dias_acreditacion, orden, protegido, cuenta_id
) values
  ('mp2_debito',        'Débito',           'credit-card', false, true,
   'debit_card',  null, null, 1.69, 0, 20, false,
   (select id from public.cuentas where tipo = 'billetera_virtual'
      and lower(nombre) like '%mercado pago%' limit 1)),
  ('mp2_transferencia', 'QR Transferencia', 'qr-code',     false, true,
   'bank_transfer', null, null, 0, 0, 15, false,
   (select id from public.cuentas where tipo = 'billetera_virtual'
      and lower(nombre) like '%mercado pago%' limit 1)),
  ('mp2_otros',         'Cobro terminal',   'wallet',      false, true,
   null, null, null, 0, 0, 90, false,
   (select id from public.cuentas where tipo = 'billetera_virtual'
      and lower(nombre) like '%mercado pago%' limit 1))
on conflict (codigo) do update set
  nombre               = excluded.nombre,
  icono                = excluded.icono,
  activo               = excluded.activo,
  disponible_terminal  = excluded.disponible_terminal,
  mp_payment_type      = excluded.mp_payment_type,
  mp_payment_method_id = excluded.mp_payment_method_id,
  mp_channel           = excluded.mp_channel,
  orden                = excluded.orden,
  updated_at           = now();

notify pgrst, 'reload schema';
