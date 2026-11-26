-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 343 · "El proveedor me debe la factura"                  ║
-- ║                                                                     ║
-- ║  En el portal de facturas, "Sin factura" mezclaba dos cosas: lo que ║
-- ║  está en papel y todavía no se cargó, y lo que el proveedor no      ║
-- ║  entregó. Se agrega una marca manual sobre la deuda para separar    ║
-- ║  las segundas y saber desde cuándo se la está esperando.            ║
-- ║                                                                     ║
-- ║  cuentas_a_pagar está gateada por `finanzas` (mig 047): se marca    ║
-- ║  por RPC para que también pueda hacerlo quien tiene `compras`.      ║
-- ║  La marca solo tiene sentido mientras la deuda no tiene factura; al ║
-- ║  cargarla, la pantalla deja de mostrarla (el dato queda).           ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.cuentas_a_pagar
  add column if not exists factura_adeudada_desde timestamptz,
  add column if not exists factura_adeudada_por uuid references public.usuarios(id),
  add column if not exists factura_adeudada_nota text;

comment on column public.cuentas_a_pagar.factura_adeudada_desde is
  'Desde cuándo el proveedor debe la factura de esta recepción (marca manual, mig 343). NULL = no marcada.';

create or replace function public.fn_marcar_factura_adeudada(
  p_cuenta_id integer,
  p_adeudada boolean,
  p_nota text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_tiene_factura boolean;
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
begin
  if not ((select public.fn_tiene_permiso('finanzas'))
          or (select public.fn_tiene_permiso('compras'))) then
    raise exception 'No tenés permiso para marcar facturas pendientes del proveedor.';
  end if;

  select tiene_factura into v_tiene_factura
    from public.cuentas_a_pagar where id = p_cuenta_id for update;
  if not found then
    raise exception 'La deuda #% no existe.', p_cuenta_id;
  end if;
  if p_adeudada and coalesce(v_tiene_factura, false) then
    raise exception 'Esta deuda ya tiene la factura cargada.';
  end if;

  if p_adeudada then
    update public.cuentas_a_pagar
      set factura_adeudada_desde = coalesce(factura_adeudada_desde, now()),
          factura_adeudada_por = coalesce(factura_adeudada_por, auth.uid()),
          factura_adeudada_nota = v_nota
      where id = p_cuenta_id;
  else
    update public.cuentas_a_pagar
      set factura_adeudada_desde = null,
          factura_adeudada_por = null,
          factura_adeudada_nota = null
      where id = p_cuenta_id;
  end if;

  perform public.fn_auditar(
    auth.uid(),
    case when p_adeudada then 'marcar_factura_adeudada' else 'desmarcar_factura_adeudada' end,
    'cuenta_a_pagar', p_cuenta_id, jsonb_build_object('nota', v_nota)
  );
end;
$$;

revoke all on function public.fn_marcar_factura_adeudada(integer, boolean, text) from public, anon;
grant execute on function public.fn_marcar_factura_adeudada(integer, boolean, text) to authenticated;

notify pgrst, 'reload schema';
