-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Migration 303 · Validación de facturas de proveedores (portal único) ║
-- ║                                                                        ║
-- ║  Hasta acá una factura con orden no tenía estado de control: el       ║
-- ║  cruce recibido-vs-facturado se veía en el modal y no quedaba          ║
-- ║  guardado; `controlada` existía solo para las compras directas.        ║
-- ║  El portal de facturas (Compras › Facturas de proveedores) necesita    ║
-- ║  un paso explícito "A validar" → "A pagar" para TODAS las facturas.    ║
-- ║                                                                        ║
-- ║  · facturas_compra.validada / validada_por / validada_at               ║
-- ║  · facturas_compra.diferencia_recepcion (neto facturado − neto         ║
-- ║    recibido) y renglones_diferentes, calculados al validar.            ║
-- ║  · fn_validar_factura_compra(p_factura_id, p_validar): marca o         ║
-- ║    desmarca, guarda el cruce y audita. Permiso finanzas o compras.     ║
-- ║  · fn_controlar_compra_directa (mig 123) también marca `validada`,     ║
-- ║    así "controlada" y "validada" nunca se contradicen.                 ║
-- ║                                                                        ║
-- ║  Backfill: lo ya cargado queda validado (no se reabre el histórico);   ║
-- ║  las directas copian `controlada`.                                     ║
-- ║                                                                        ║
-- ║  fn_guardar_factura_compra (v24, mig 168) NO se toca: borra y          ║
-- ║  reinserta la factura, así que una edición vuelve a `validada=false`   ║
-- ║  por default, que es lo buscado (editar → volver a validar).           ║
-- ╚══════════════════════════════════════════════════════════════════════╝

alter table public.facturas_compra
  add column if not exists validada boolean not null default false,
  add column if not exists validada_por uuid,
  add column if not exists validada_at timestamptz,
  add column if not exists diferencia_recepcion numeric(14,2),
  add column if not exists renglones_diferentes integer;

comment on column public.facturas_compra.validada is
  'Factura revisada por administración (paso "A validar" → "A pagar" del portal). Mig 303.';
comment on column public.facturas_compra.diferencia_recepcion is
  'Neto facturado − neto recibido al validar (renglones de la orden + extras). NULL = sin orden o sin validar.';
comment on column public.facturas_compra.renglones_diferentes is
  'Renglones cuya cantidad facturada difiere de la recibida (incluye extras). NULL = sin orden o sin validar.';

-- Backfill: todo lo cargado hasta hoy queda validado; las directas copian su control.
update public.facturas_compra
   set validada = true,
       validada_at = coalesce(updated_at, created_at)
 where not es_directa
   and validada = false;

update public.facturas_compra
   set validada = true,
       validada_at = coalesce(updated_at, created_at)
 where es_directa
   and controlada = true
   and validada = false;

-- ─── fn_validar_factura_compra ───────────────────────────────────────────────
drop function if exists public.fn_validar_factura_compra(integer, boolean);

create or replace function public.fn_validar_factura_compra(
  p_factura_id integer,
  p_validar boolean default true
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_f record;
  v_dif numeric := 0;
  v_reng integer := 0;
  v_tmp numeric;
  v_tmp_i integer;
begin
  if not (
    (select public.fn_tiene_permiso('finanzas'))
    or (select public.fn_tiene_permiso('compras'))
  ) then
    raise exception 'No tenés permiso para validar facturas de proveedores.';
  end if;

  select id, cuenta_id, pedido_id, es_directa, neto
    into v_f
    from public.facturas_compra
   where id = p_factura_id
   for update;
  if not found then
    raise exception 'La factura #% no existe.', p_factura_id;
  end if;

  if not p_validar then
    update public.facturas_compra
       set validada = false,
           validada_por = null,
           validada_at = null,
           diferencia_recepcion = null,
           renglones_diferentes = null,
           updated_at = now()
     where id = p_factura_id;

    perform public.fn_auditar(auth.uid(), 'reabrir_validacion_factura', 'factura_compra',
      p_factura_id, jsonb_build_object('cuenta_id', v_f.cuenta_id));
    return;
  end if;

  -- Cruce recibido vs. facturado, solo con orden de compra.
  if v_f.pedido_id is not null and v_f.cuenta_id is not null then
    -- Renglones de la orden imputados a esta deuda (mig 106): la factura ya
    -- escribió cantidad_facturada y el costo landed en items_pedido (mig 168).
    select coalesce(sum(round((coalesce(ip.cantidad_facturada, 0) - coalesce(ip.cantidad_recibida, 0)) * ip.precio_costo, 2)), 0),
           count(*) filter (where coalesce(ip.cantidad_facturada, 0) <> coalesce(ip.cantidad_recibida, 0))
      into v_tmp, v_tmp_i
      from public.items_pedido ip
     where ip.cuenta_a_pagar_id = v_f.cuenta_id
       and ip.cantidad_facturada is not null;
    v_dif := v_dif + coalesce(v_tmp, 0);
    v_reng := v_reng + coalesce(v_tmp_i, 0);

    -- Renglones EXTRA (producto que no estaba en la orden, mig 166): nadie
    -- los recibió, así que todo su neto es diferencia.
    select coalesce(sum(round(ifc.cantidad * ifc.costo_sin_iva * (1 - coalesce(ifc.descuento_porcentaje, 0) / 100), 2)), 0),
           count(*)
      into v_tmp, v_tmp_i
      from public.items_factura_compra ifc
     where ifc.factura_id = p_factura_id
       and ifc.producto_id is not null
       and not exists (
         select 1 from public.items_pedido ip
          where ip.pedido_id = v_f.pedido_id
            and ip.producto_id = ifc.producto_id
       );
    v_dif := v_dif + coalesce(v_tmp, 0);
    v_reng := v_reng + coalesce(v_tmp_i, 0);
  end if;

  update public.facturas_compra
     set validada = true,
         validada_por = auth.uid(),
         validada_at = now(),
         diferencia_recepcion = case when v_f.pedido_id is null then null else v_dif end,
         renglones_diferentes = case when v_f.pedido_id is null then null else v_reng end,
         -- Una directa validada queda también controlada (misma cosa, dos nombres).
         controlada = case when v_f.es_directa then true else controlada end,
         updated_at = now()
   where id = p_factura_id;

  perform public.fn_auditar(auth.uid(), 'validar_factura_compra', 'factura_compra',
    p_factura_id,
    jsonb_build_object(
      'cuenta_id', v_f.cuenta_id,
      'pedido_id', v_f.pedido_id,
      'diferencia_recepcion', case when v_f.pedido_id is null then null else v_dif end,
      'renglones_diferentes', case when v_f.pedido_id is null then null else v_reng end
    ));
end;
$$;

revoke execute on function public.fn_validar_factura_compra(integer, boolean) from public, anon;
grant execute on function public.fn_validar_factura_compra(integer, boolean) to authenticated;

-- ─── fn_controlar_compra_directa (mig 123) · misma firma, también valida ────
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
    validada           = coalesce(p_controlada, false),
    validada_por       = case when coalesce(p_controlada, false) then coalesce(auth.uid(), p_usuario_id) else null end,
    validada_at        = case when coalesce(p_controlada, false) then now() else null end,
    updated_at         = now()
  where id = p_factura_id and es_directa = true;

  perform public.fn_auditar(p_usuario_id, 'controlar_compra_directa', 'factura_compra', p_factura_id,
    jsonb_build_object('controlada', p_controlada));
end;
$$;

notify pgrst, 'reload schema';
