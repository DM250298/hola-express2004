-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 134 · Reactivar pedido cancelado                         ║
-- ║                                                                     ║
-- ║  El trigger `fn_validar_transicion_pedido` (mig 061) blindaba las   ║
-- ║  transiciones de estado y no contemplaba NINGUNA salida desde       ║
-- ║  `cancelado`, así que el botón "Reactivar" del detalle de compra    ║
-- ║  fallaba con "Transición de estado de pedido inválida:              ║
-- ║  cancelado → enviado".                                              ║
-- ║                                                                     ║
-- ║  Se agrega la reactivación `cancelado → borrador | enviado`. Es     ║
-- ║  segura: un pedido solo se cancela desde borrador/enviado (nunca    ║
-- ║  después de recibir), por lo que un pedido cancelado no movió       ║
-- ║  stock, no tiene lotes ni cuenta a pagar. Reactivar es solo         ║
-- ║  cambiar el flag de estado — sin efectos colaterales.               ║
-- ║                                                                     ║
-- ║  Solo reemplaza la función del trigger (misma firma). El trigger    ║
-- ║  `pedidos_validar_transicion` ya la referencia por nombre; no hace  ║
-- ║  falta recrearlo. No cambia types/database.ts.                      ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_validar_transicion_pedido()
returns trigger language plpgsql as $$
begin
  if new.estado is distinct from old.estado then
    if not (
      (old.estado = 'borrador'          and new.estado in ('enviado', 'cancelado')) or
      (old.estado = 'enviado'           and new.estado in ('recibido', 'recepcion_parcial', 'cancelado')) or
      (old.estado = 'recepcion_parcial' and new.estado = 'recibido') or
      -- Reactivación de un pedido cancelado (sin efectos colaterales:
      -- nunca movió stock/lotes/deuda). Vuelve a "Por recibir" (enviado)
      -- o al borrador editable.
      (old.estado = 'cancelado'         and new.estado in ('borrador', 'enviado'))
    ) then
      raise exception 'Transición de estado de pedido inválida: % → %', old.estado, new.estado;
    end if;
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
