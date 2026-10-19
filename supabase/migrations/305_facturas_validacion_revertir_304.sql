-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Migration 305 · Deshace la 304: lo histórico vuelve a validado        ║
-- ║                                                                        ║
-- ║  El dueño probó la bandeja "A validar" con el histórico reabierto por  ║
-- ║  la 304 y pidió volver atrás: las facturas con orden que estaban       ║
-- ║  "A pagar" / "Vencida" vuelven ahí. Queda el criterio original de la   ║
-- ║  303: lo cargado hasta la 303 se da por validado y solo las facturas  ║
-- ║  nuevas pasan por "A validar".                                         ║
-- ║                                                                        ║
-- ║  Toca solo las facturas con orden sin validar y sin `validada_por`     ║
-- ║  (nadie las validó ni las reabrió a mano desde el portal). Las        ║
-- ║  directas no se tocan.                                                 ║
-- ╚══════════════════════════════════════════════════════════════════════╝

do $$
declare
  v_n integer;
begin
  update public.facturas_compra f
     set validada = true,
         validada_at = coalesce(f.updated_at, f.created_at),
         updated_at = now()
   where not f.validada
     and f.validada_por is null
     and not f.es_directa
     and f.cuenta_id is not null;
  get diagnostics v_n = row_count;
  raise notice 'mig 305: % facturas vuelven a validadas', v_n;
end $$;

notify pgrst, 'reload schema';
