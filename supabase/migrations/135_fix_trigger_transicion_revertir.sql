-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 135 · Fix trigger transición: restaurar rama de reversión ║
-- ║                                                                     ║
-- ║  La mig 134 (reactivar_pedido_cancelado) reescribió                  ║
-- ║  fn_validar_transicion_pedido partiendo de la base 061 y, sin        ║
-- ║  querer, PERDIÓ la rama que la mig 130 había agregado para la        ║
-- ║  reversión de recepción (recibido/recepcion_parcial → enviado bajo   ║
-- ║  el flag transaccional `hola.revertir_recepcion`).                   ║
-- ║                                                                     ║
-- ║  Efecto del bug: "Revertir recepción" y "Borrar orden"              ║
-- ║  (fn_cancelar_pedido, que reusa fn_revertir_recepcion) fallan con    ║
-- ║  "Transición de estado de pedido inválida: recibido → enviado".      ║
-- ║                                                                     ║
-- ║  Esta migración reissuea el trigger con TODAS las transiciones       ║
-- ║  válidas = reactivar (134) + reversión (130) + base. Es el ÚNICO     ║
-- ║  lugar donde se validan las transiciones de pedido: cualquier        ║
-- ║  feature nueva que la reescriba DEBE conservar todas estas ramas.    ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_validar_transicion_pedido()
returns trigger language plpgsql as $$
declare
  -- Flag transaccional que prende fn_revertir_recepcion antes de su update.
  v_revirtiendo boolean :=
    coalesce(current_setting('hola.revertir_recepcion', true), 'off') = 'on';
begin
  if new.estado is distinct from old.estado then
    if not (
      (old.estado = 'borrador'          and new.estado in ('enviado', 'cancelado')) or
      (old.estado = 'enviado'           and new.estado in ('recibido', 'recepcion_parcial', 'cancelado')) or
      (old.estado = 'recepcion_parcial' and new.estado = 'recibido') or
      -- Reactivar un pedido cancelado (mig 134): sin efectos colaterales.
      (old.estado = 'cancelado'         and new.estado in ('borrador', 'enviado')) or
      -- Reversión de recepción (mig 130): sólo válida bajo el flag que prende
      -- fn_revertir_recepcion. La 134 (reactivar) había perdido esta rama.
      (v_revirtiendo and old.estado in ('recibido', 'recepcion_parcial') and new.estado = 'enviado')
    ) then
      raise exception 'Transición de estado de pedido inválida: % → %', old.estado, new.estado;
    end if;
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
