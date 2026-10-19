-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Migration 304 · Lo que Finanzas no vio vuelve a "A validar"           ║
-- ║                                                                        ║
-- ║  La 303 dio por validada toda factura con orden ya cargada (backfill  ║
-- ║  sin `validada_por`). El dueño pidió lo contrario: en "A validar"     ║
-- ║  tienen que salir todas las facturas que ya pasaron por recepción     ║
-- ║  pero que Finanzas todavía no revisó.                                  ║
-- ║                                                                        ║
-- ║  Se reabre la validación de las facturas con orden marcadas por el    ║
-- ║  backfill cuya deuda sigue abierta. Las de deudas ya PAGADAS quedan    ║
-- ║  validadas: pagarlas fue revisarlas. Las compras directas no se       ║
-- ║  tocan (`controlada` ya era la revisión de Finanzas).                  ║
-- ║                                                                        ║
-- ║  Lo que alguien validó a mano desde el portal (`validada_por` con      ║
-- ║  valor) no se toca.                                                    ║
-- ╚══════════════════════════════════════════════════════════════════════╝

do $$
declare
  v_n integer;
begin
  update public.facturas_compra f
     set validada = false,
         validada_at = null,
         diferencia_recepcion = null,
         renglones_diferentes = null,
         updated_at = now()
   where f.validada
     and f.validada_por is null          -- marcadas por el backfill de la 303
     and not f.es_directa
     and (
       f.cuenta_id is null
       or exists (
         select 1 from public.cuentas_a_pagar c
          where c.id = f.cuenta_id
            and c.estado <> 'pagada'::public.estado_cuenta_pagar
       )
     );
  get diagnostics v_n = row_count;
  raise notice 'mig 304: % facturas vuelven a "A validar"', v_n;
end $$;

notify pgrst, 'reload schema';
