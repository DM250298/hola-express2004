-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 124 · fn_importar_productos v2 — precio desde costo+margen ║
-- ║                                                                     ║
-- ║  PROBLEMA: el importador de Excel guardaba `precio_venta` tal cual   ║
-- ║  venía en la planilla (precio final a mano), sin pasar por el motor  ║
-- ║  de márgenes. Resultado: precios que no cubrían IIBB + imp. créd/déb ║
-- ║  + comisión MP → margen real ~0 o negativo, y el `margen` del        ║
-- ║  producto quedaba en 0 (no había de qué recalcular).                 ║
-- ║                                                                     ║
-- ║  SOLUCIÓN: la planilla ahora trae `costo` (neto) + `margen` (%) y el ║
-- ║  RPC calcula el precio con fn_precio_venta (mig 109) — el MISMO      ║
-- ║  motor que usan el Drawer y la factura de compra. Guarda además      ║
-- ║  productos.margen y libera pendiente_precio cuando el precio > 0.    ║
-- ║                                                                     ║
-- ║  Precedencia por fila:                                              ║
-- ║    · hay margen + costo (del archivo o el ya guardado) → precio =    ║
-- ║      fn_precio_venta(costo, margen, iva_venta)                       ║
-- ║    · si no, se usa el precio de venta del archivo (modo manual)      ║
-- ║    · si tampoco vino, en una actualización se conserva el actual     ║
-- ║                                                                     ║
-- ║  Firma idéntica (p_filas jsonb) → CREATE OR REPLACE limpio.          ║
-- ║  REQUIERE: migración 108 (config_fiscal) + 109 (fn_precio_venta).    ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_importar_productos(p_filas jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_fila jsonb;
  v_cat_id integer; v_prov_id integer; v_prod_id integer;
  v_codigo text;
  v_creados integer := 0; v_actualizados integer := 0;
  v_errores jsonb := '[]'::jsonb;
  -- Pricing con margen asegurado
  v_margen numeric;       -- margen % del archivo (o null)
  v_costo_in numeric;     -- costo neto del archivo (o null)
  v_iva_in numeric;       -- IVA % del archivo (o null)
  v_precio_in numeric;    -- precio manual del archivo (o null)
  v_iva_eff numeric;      -- IVA de venta efectivo para el motor
  v_costo_eff numeric;    -- costo neto efectivo (archivo o el ya guardado)
  v_precio_final numeric; -- precio a escribir (calculado, manual, o null)
begin
  if not public.fn_tiene_permiso('configuracion') then
    raise exception 'Sin permiso para importar productos';
  end if;

  for v_fila in select * from jsonb_array_elements(p_filas) loop
    begin
      -- Código: el del archivo o uno autogenerado
      v_codigo := nullif(btrim(coalesce(v_fila->>'codigo_barras','')), '');
      if v_codigo is null then v_codigo := public.fn_generar_codigo(); end if;

      -- Categoría (crea si no existe, case-insensitive)
      v_cat_id := null;
      if nullif(btrim(v_fila->>'categoria'),'') is not null then
        select id into v_cat_id from public.categorias
          where lower(nombre) = lower(btrim(v_fila->>'categoria')) limit 1;
        if v_cat_id is null then
          insert into public.categorias (nombre) values (btrim(v_fila->>'categoria'))
            returning id into v_cat_id;
        end if;
      end if;

      -- Proveedor (idem)
      v_prov_id := null;
      if nullif(btrim(v_fila->>'proveedor'),'') is not null then
        select id into v_prov_id from public.proveedores
          where lower(nombre) = lower(btrim(v_fila->>'proveedor')) limit 1;
        if v_prov_id is null then
          insert into public.proveedores (nombre) values (btrim(v_fila->>'proveedor'))
            returning id into v_prov_id;
        end if;
      end if;

      -- ¿Existe por código?
      select id into v_prod_id from public.productos where codigo_barras = v_codigo limit 1;

      -- ── Cálculo del precio de venta ─────────────────────────────────
      v_margen    := nullif(v_fila->>'margen','')::numeric;
      v_costo_in  := nullif(v_fila->>'precio_costo','')::numeric;
      v_iva_in    := nullif(v_fila->>'iva','')::numeric;
      v_precio_in := nullif(v_fila->>'precio_venta','')::numeric;

      -- IVA de venta efectivo: el del archivo, el ya guardado, o 21% por defecto.
      v_iva_eff := coalesce(
        v_iva_in,
        (select iva_venta from public.productos where id = v_prod_id),
        21
      );
      -- Costo neto efectivo: el del archivo o, si es actualización sin costo
      -- en la fila, el ya guardado (gateado) vía fn_costo.
      v_costo_eff := coalesce(
        v_costo_in,
        case when v_prod_id is not null then public.fn_costo(v_prod_id) else null end
      );

      if v_margen is not null and v_costo_eff is not null and v_costo_eff > 0 then
        -- Motor de margen asegurado (mismo que Drawer y factura de compra).
        v_precio_final := public.fn_precio_venta(v_costo_eff, v_margen, v_iva_eff);
      else
        -- Sin margen con qué calcular: precio manual del archivo (puede ser null).
        v_precio_final := v_precio_in;
      end if;

      if v_prod_id is not null then
        -- UPDATE conservador: coalesce(nuevo, actual) => no borra lo que no vino
        update public.productos set
          codigo_barras_2 = coalesce(nullif(v_fila->>'codigo_barras_2',''), codigo_barras_2),
          codigo_interno  = coalesce(nullif(v_fila->>'codigo_interno',''), codigo_interno),
          nombre          = coalesce(nullif(v_fila->>'nombre',''), nombre),
          marca           = coalesce(nullif(v_fila->>'marca',''), marca),
          subcategoria    = coalesce(nullif(v_fila->>'subcategoria',''), subcategoria),
          categoria_id    = coalesce(v_cat_id, categoria_id),
          proveedor_id    = coalesce(v_prov_id, proveedor_id),
          precio_venta    = coalesce(v_precio_final, precio_venta),
          margen          = coalesce(v_margen, margen),
          pendiente_precio = case when coalesce(v_precio_final, precio_venta) > 0
                                  then false else pendiente_precio end,
          stock_actual    = coalesce((v_fila->>'stock_actual')::numeric, stock_actual),
          stock_minimo    = coalesce((v_fila->>'stock_minimo')::integer, stock_minimo),
          unidad          = coalesce(nullif(v_fila->>'unidad',''), unidad),
          venta_por_peso  = coalesce((v_fila->>'venta_por_peso')::boolean, venta_por_peso),
          iva_venta       = coalesce(v_iva_in, iva_venta),
          iva_compra      = coalesce(v_iva_in, iva_compra),
          ubicacion       = coalesce(nullif(v_fila->>'ubicacion',''), ubicacion),
          dias_vencimiento_minimo = coalesce(nullif(v_fila->>'dias_vencimiento_minimo','')::integer, dias_vencimiento_minimo),
          activo          = coalesce((v_fila->>'activo')::boolean, activo),
          updated_at      = now()
        where id = v_prod_id;
        v_actualizados := v_actualizados + 1;
      else
        insert into public.productos (
          codigo_barras, codigo_barras_2, codigo_interno, nombre, marca,
          subcategoria, categoria_id, proveedor_id, precio_venta, margen,
          pendiente_precio, stock_actual, stock_minimo, unidad, venta_por_peso,
          iva_venta, iva_compra, ubicacion, dias_vencimiento_minimo, activo
        ) values (
          v_codigo,
          nullif(v_fila->>'codigo_barras_2',''),
          nullif(v_fila->>'codigo_interno',''),
          coalesce(nullif(v_fila->>'nombre',''), 'Sin nombre'),
          nullif(v_fila->>'marca',''),
          nullif(v_fila->>'subcategoria',''),
          v_cat_id, v_prov_id,
          coalesce(v_precio_final, 0),
          coalesce(v_margen, 0),
          case when coalesce(v_precio_final, 0) > 0 then false else true end,
          coalesce((v_fila->>'stock_actual')::numeric, 0),
          coalesce((v_fila->>'stock_minimo')::integer, 5),
          coalesce(nullif(v_fila->>'unidad',''), 'unidad'),
          coalesce((v_fila->>'venta_por_peso')::boolean, false),
          coalesce(v_iva_in, 21),
          coalesce(v_iva_in, 21),
          nullif(v_fila->>'ubicacion',''),
          nullif(v_fila->>'dias_vencimiento_minimo','')::integer,
          coalesce((v_fila->>'activo')::boolean, true)
        ) returning id into v_prod_id;
        v_creados := v_creados + 1;
      end if;

      -- Costo => costos_producto (gateada). Solo si vino en el lote.
      if v_costo_in is not null then
        perform public.fn_set_costo(v_prod_id, v_costo_in);
      end if;

      -- codigo_proveedor => catálogo N:M proveedor_producto
      if v_prov_id is not null and nullif(v_fila->>'codigo_proveedor','') is not null then
        insert into public.proveedor_producto (proveedor_id, producto_id, codigo_proveedor, costo, es_principal)
        values (v_prov_id, v_prod_id, btrim(v_fila->>'codigo_proveedor'),
                coalesce(v_costo_in, 0), true)
        on conflict (proveedor_id, producto_id)
          do update set codigo_proveedor = excluded.codigo_proveedor;
      end if;

    exception when others then
      v_errores := v_errores || jsonb_build_object(
        'fila', (v_fila->>'fila_origen')::int,
        'codigo', v_codigo,
        'mensaje', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'creados', v_creados,
    'actualizados', v_actualizados,
    'errores', v_errores);
end $$;

grant execute on function public.fn_importar_productos(jsonb) to authenticated;

-- Recargar el schema cache de PostgREST (firma idéntica, pero por prolijidad).
notify pgrst, 'reload schema';
