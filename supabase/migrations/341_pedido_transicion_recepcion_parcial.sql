-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 341 · La orden puede volver a "recepción parcial"        ║
-- ║                                                                     ║
-- ║  Al eliminar una factura (mig 342) de una orden que tiene otras,    ║
-- ║  sus renglones vuelven a "sin recibir" y la orden pasa de           ║
-- ║  'recibido' a 'recepcion_parcial' para poder recibirlos de nuevo.   ║
-- ║  Solo bajo el flag transaccional `hola.revertir_recepcion`.         ║
-- ║                                                                     ║
-- ║  Base: mig 135, con TODAS sus ramas (reactivar 134 + revertir 130). ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_validar_transicion_pedido()
returns trigger language plpgsql as $$
declare
  v_revirtiendo boolean :=
    coalesce(current_setting('hola.revertir_recepcion', true), 'off') = 'on';
begin
  if new.estado is distinct from old.estado then
    if not (
      (old.estado = 'borrador'          and new.estado in ('enviado', 'cancelado')) or
      (old.estado = 'enviado'           and new.estado in ('recibido', 'recepcion_parcial', 'cancelado')) or
      (old.estado = 'recepcion_parcial' and new.estado = 'recibido') or
      (old.estado = 'cancelado'         and new.estado in ('borrador', 'enviado')) or
      (v_revirtiendo and old.estado in ('recibido', 'recepcion_parcial') and new.estado = 'enviado') or
      -- mig 342: eliminar una factura de una orden con varias.
      (v_revirtiendo and old.estado = 'recibido' and new.estado = 'recepcion_parcial')
    ) then
      raise exception 'Transición de estado de pedido inválida: % → %', old.estado, new.estado;
    end if;
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
