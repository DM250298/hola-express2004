-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 324 · Backfill: el margen guardado vuelve a ser el real  ║
-- ║                                                                     ║
-- ║  Hasta la 322/323, cada factura o compra directa con "Afectar       ║
-- ║  precio de venta" apagado cambiaba el costo y dejaba productos.     ║
-- ║  margen medido contra el costo anterior. La ficha, en "Por margen", ║
-- ║  calculaba otro precio con ese margen viejo (dos precios para el    ║
-- ║  mismo producto).                                                   ║
-- ║                                                                     ║
-- ║  Para cada producto activo con precio y costo (combos afuera: su    ║
-- ║  costo sale de los componentes): si el margen guardado NO reproduce ║
-- ║  el precio vigente (|fn_precio_venta(costo, margen) − precio| > 0,5 ║
-- ║  —la misma tolerancia que usa la ficha—), margen :=                 ║
-- ║  fn_margen_desde_precio(costo, precio vigente). Los puestos por     ║
-- ║  margen (reproducen el precio) no se tocan. Mismo criterio para el  ║
-- ║  par mayorista. NO toca precio_venta: no encola etiquetas.          ║
-- ║  Idempotente: correrla dos veces no cambia nada la segunda.         ║
-- ║                                                                     ║
-- ║  Antes de correrla en producción, ver qué va a cambiar con          ║
-- ║  supabase/scripts/margen_desactualizado.sql (solo lectura); después ║
-- ║  ese mismo script tiene que dar 0 filas.                            ║
-- ║  REQUIERE: 109 (fn_precio_venta) y 125 (fn_margen_desde_precio).    ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
declare
  r record;
  v_rep numeric;
  v_real numeric;
  v_vistos integer := 0;
  v_corr integer := 0;
  v_corr_may integer := 0;
begin
  for r in
    select p.id, p.precio_venta, p.margen, p.precio_mayorista, p.margen_mayorista,
           coalesce(p.iva_venta, 21) as iva_venta, c.precio_costo as costo
      from public.productos p
      join public.costos_producto c on c.producto_id = p.id
     where p.activo
       and p.precio_venta > 0
       and c.precio_costo > 0
       and coalesce(p.tipo, '') <> 'combo'
       and not exists (select 1 from public.producto_componentes pc where pc.producto_id = p.id)
  loop
    v_vistos := v_vistos + 1;

    -- Minorista: ¿el margen guardado reproduce el precio vigente?
    v_rep := public.fn_precio_venta(r.costo, coalesce(r.margen, 0), r.iva_venta);
    if abs(v_rep - r.precio_venta) > 0.5 then
      v_real := public.fn_margen_desde_precio(r.costo, r.precio_venta, r.iva_venta);
      if v_real is distinct from r.margen then
        update public.productos set margen = v_real, updated_at = now() where id = r.id;
        v_corr := v_corr + 1;
      end if;
    end if;

    -- Mayorista (mig 153): mismo criterio sobre su propio par, si existe.
    if r.margen_mayorista is not null and coalesce(r.precio_mayorista, 0) > 0 then
      v_rep := public.fn_precio_venta(r.costo, r.margen_mayorista, r.iva_venta);
      if abs(v_rep - r.precio_mayorista) > 0.5 then
        v_real := public.fn_margen_desde_precio(r.costo, r.precio_mayorista, r.iva_venta);
        if v_real is distinct from r.margen_mayorista then
          update public.productos set margen_mayorista = v_real, updated_at = now() where id = r.id;
          v_corr_may := v_corr_may + 1;
        end if;
      end if;
    end if;
  end loop;

  raise notice 'mig 324 · % productos revisados · % márgenes re-deducidos · % márgenes mayoristas re-deducidos',
    v_vistos, v_corr, v_corr_may;
end $$;

notify pgrst, 'reload schema';
