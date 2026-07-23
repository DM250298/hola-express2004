-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 123 · Control administrativo de las compras directas     ║
-- ║                                                                     ║
-- ║  Las compras que cargan los vendedores desde el POS quedan          ║
-- ║  "a controlar" hasta que el administrativo revisa la factura,      ║
-- ║  corrige los datos formales del comprobante y la marca controlada. ║
-- ║  · facturas_compra.controlada (default false).                      ║
-- ║  · fn_controlar_compra_directa: edita datos fiscales + marca.       ║
-- ║    (Si los montos/productos están mal → fn_anular_compra_directa.)  ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.facturas_compra
  add column if not exists controlada boolean not null default false;

create or replace function public.fn_controlar_compra_directa(
  p_factura_id integer,
  p_usuario_id uuid,
  p_tipo text,
  p_punto text,
  p_numero text,
  p_cuit text,
  p_controlada boolean
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not (select public.fn_tiene_permiso('compras')) then
    raise exception 'No tenés permiso para controlar compras.';
  end if;
  if not exists (
    select 1 from public.facturas_compra where id = p_factura_id and es_directa = true
  ) then
    raise exception 'La compra directa no existe.';
  end if;

  update public.facturas_compra set
    tipo_comprobante   = nullif(btrim(coalesce(p_tipo, '')), ''),
    punto_venta        = nullif(btrim(coalesce(p_punto, '')), ''),
    numero_comprobante = nullif(btrim(coalesce(p_numero, '')), ''),
    cuit_proveedor     = nullif(btrim(coalesce(p_cuit, '')), ''),
    controlada         = coalesce(p_controlada, false),
    updated_at         = now()
  where id = p_factura_id and es_directa = true;

  perform public.fn_auditar(p_usuario_id, 'controlar_compra_directa', 'factura_compra', p_factura_id,
    jsonb_build_object('controlada', p_controlada));
end;
$$;

revoke execute on function public.fn_controlar_compra_directa(integer, uuid, text, text, text, text, boolean) from anon;
grant execute on function public.fn_controlar_compra_directa(integer, uuid, text, text, text, text, boolean) to authenticated;

notify pgrst, 'reload schema';
