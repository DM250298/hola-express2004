-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 125 · fn_margen_desde_precio (inverso) +                  ║
-- ║  fn_importar_productos v3                                            ║
-- ║                                                                     ║
-- ║  Complemento del modo directo (costo+margen → precio, mig 124): el   ║
-- ║  modo INVERSO deduce el margen NETO a partir de un precio fijado a   ║
-- ║  mano. Sirve para cuando ya tenés el precio decidido (número redondo,║
-- ║  precio de la competencia) y querés que el sistema calcule y GUARDE  ║
-- ║  cuánto ganás realmente tras las cargas.                            ║
-- ║                                                                     ║
-- ║  1. fn_margen_desde_precio(costo, precio_final, iva_venta): espejo   ║
-- ║     SQL de lib/pricing/motor.ts calcularDesdePrecio. Devuelve el     ║
-- ║     margen NETO % (puede ser negativo si el precio no cubre costo +  ║
-- ║     cargas). Lee la misma config (config_fiscal + medios_pago).      ║
-- ║                                                                     ║
-- ║  2. fn_importar_productos v3: si una fila trae precio_venta + costo  ║
-- ║     SIN margen, deduce el margen con la fn nueva y lo guarda (antes  ║
-- ║     quedaba en 0 → el detalle mostraba +0% engañoso).               ║
-- ║     Precedencia por fila:                                           ║
-- ║       margen presente        → precio = fn_precio_venta (directo)    ║
-- ║       precio presente, s/margen → margen = fn_margen_desde_precio     ║
-- ║       ninguno                 → conserva (update) / precio 0 (alta)  ║
-- ║                                                                     ║
-- ║  Firma idéntica (p_filas jsonb) → CREATE OR REPLACE limpio.          ║
-- ║  REQUIERE: migraciones 108 + 109 + 124.                             ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. fn_margen_desde_precio — inverso del motor (precio → margen neto %)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_margen_desde_precio(
  p_costo numeric,
  p_precio_final numeric,
  p_iva_venta_pct numeric default null
) returns numeric
language plpgsql stable set search_path = public
as $$
declare
  v_cfg record;
  v_iva_venta numeric;  -- IVA de venta del producto (fracción)
  v_com_ef numeric;     -- comisión MP peor caso, CON IVA, fracción
  v_cargas numeric;
  v_base numeric;       -- base neta (RI) o precio final (mono)
  v_ganancia numeric;
begin
  if p_costo is null or p_costo < 0 then
    raise exception 'fn_margen_desde_precio: costo >= 0 (recibido %).', p_costo;
  end if;
  if p_precio_final is null or p_precio_final < 0 then
    raise exception 'fn_margen_desde_precio: precio >= 0 (recibido %).', p_precio_final;
  end if;
  if p_costo = 0 then return 0; end if;  -- sin costo no hay margen que medir

  select iibb_alicuota, iva_alicuota_general, impuesto_deb_cred_alicuota, condicion_iva
    into v_cfg from public.config_fiscal where id = 1;
  if not found then
    raise exception 'fn_margen_desde_precio: falta config_fiscal (id=1).';
  end if;

  v_iva_venta := coalesce(p_iva_venta_pct, v_cfg.iva_alicuota_general) / 100;

  select coalesce(max(comision_porcentaje), 0) / 100
    into v_com_ef
    from public.medios_pago
    where (mp_payment_type is not null or mp_channel is not null)
      and comision_porcentaje > 0;

  v_cargas := v_cfg.iibb_alicuota / 100
            + v_cfg.impuesto_deb_cred_alicuota / 100
            + v_com_ef;

  -- Ganancia neta = base − costo − cargas sobre el precio final. Para el RI la
  -- base es el neto (el IVA se remite, es neutro); para el mono es el precio.
  if v_cfg.condicion_iva = 'monotributista' then
    v_base := p_precio_final;
  else
    v_base := p_precio_final / (1 + v_iva_venta);
  end if;
  v_ganancia := v_base - p_costo - p_precio_final * v_cargas;

  return round(v_ganancia / p_costo * 100, 2);
end;
$$;

comment on function public.fn_margen_desde_precio(numeric, numeric, numeric) is
  'Inverso del motor de precios: dado un precio final y el costo, devuelve el margen NETO % que ese precio deja tras las cargas (IIBB + imp. créd/déb + comisión MP peor caso). Puede ser negativo. Espejo TS: lib/pricing/motor.ts calcularDesdePrecio.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. fn_importar_productos v3 = v2 (mig 124) + deducción de margen
-- ─────────────────────────────────────────────────────────────────────
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
  v_margen numeric;
  v_costo_in numeric;
  v_iva_in numeric;
  v_precio_in numeric;
  v_iva_eff numeric;
  v_costo_eff numeric;
  v_precio_final numeric;
begin
  if not public.fn_tiene_permiso('configuracion') then
    raise exception 'Sin permiso para importar productos';
  end if;

  for v_fila in select * from jsonb_array_elements(p_filas) loop
    begin
      v_codigo := nullif(btrim(coalesce(v_fila->>'codigo_barras','')), '');
      if v_codigo is null then v_codigo := public.fn_generar_codigo(); end if;

      v_cat_id := null;
      if nullif(btrim(v_fila->>'categoria'),'') is not null then
        select id into v_cat_id from public.categorias
          where lower(nombre) = lower(btrim(v_fila->>'categoria')) limit 1;
        if v_cat_id is null then
          insert into public.categorias (nombre) values (btrim(v_fila->>'categoria'))
            returning id into v_cat_id;
        end if;
      end if;

      v_prov_id := null;
      if nullif(btrim(v_fila->>'proveedor'),'') is not null then
        select id into v_prov_id from public.proveedores
          where lower(nombre) = lower(btrim(v_fila->>'proveedor')) limit 1;
        if v_prov_id is null then
          insert into public.proveedores (nombre) values (btrim(v_fila->>'proveedor'))
            returning id into v_prov_id;
        end if;
      end if;

      select id into v_prod_id from public.productos where codigo_barras = v_codigo limit 1;

      -- ── Pricing: directo (margen→precio) o inverso (precio→margen) ──
      v_margen    := nullif(v_fila->>'margen','')::numeric;
      v_costo_in  := nullif(v_fila->>'precio_costo','')::numeric;
      v_iva_in    := nullif(v_fila->>'iva','')::numeric;
      v_precio_in := nullif(v_fila->>'precio_venta','')::numeric;

      v_iva_eff := coalesce(
        v_iva_in,
        (select iva_venta from public.productos where id = v_prod_id),
        21
      );
      v_costo_eff := coalesce(
        v_costo_in,
        case when v_prod_id is not null then public.fn_costo(v_prod_id) else null end
      );

      if v_margen is not null and v_costo_eff is not null and v_costo_eff > 0 then
        -- DIRECTO: costo + margen → precio con margen asegurado.
        v_precio_final := public.fn_precio_venta(v_costo_eff, v_margen, v_iva_eff);
      elsif v_precio_in is not null and v_costo_eff is not null and v_costo_eff > 0 then
        -- INVERSO: precio a mano sin margen → guardar el precio y DEDUCIR el margen.
        v_precio_final := v_precio_in;
        v_margen := public.fn_margen_desde_precio(v_costo_eff, v_precio_in, v_iva_eff);
      else
        -- Sin con qué calcular: precio del archivo (o null → conserva/0).
        v_precio_final := v_precio_in;
      end if;

      if v_prod_id is not null then
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

      if v_costo_in is not null then
        perform public.fn_set_costo(v_prod_id, v_costo_in);
      end if;

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

notify pgrst, 'reload schema';
