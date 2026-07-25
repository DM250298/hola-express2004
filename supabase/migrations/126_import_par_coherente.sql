-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 126 · fn_importar_productos v4 — par coherente            ║
-- ║                                                                     ║
-- ║  PROBLEMA (caso real, 2026-07-24): una fila con precio_venta a mano  ║
-- ║  (ej. 3299,99) + costo entra por la rama INVERSA de la v3: guarda el ║
-- ║  precio tal cual y deduce el margen (round a 2 decimales, 17,67%).   ║
-- ║  Ese par NO es punto fijo del motor directo: fn_precio_venta(costo,  ║
-- ║  17,67) = 3300,06 exacto → techo a múltiplo 50 → 3350. Cualquier     ║
-- ║  reimportación del export (que trae margen Y precio) o repricing     ║
-- ║  directo sube el precio $50 sin que nadie lo haya pedido.            ║
-- ║                                                                     ║
-- ║  FIX: cuando la fila trae margen Y precio Y el par es COHERENTE      ║
-- ║  (el margen deducido del precio ≈ el margen de la fila, ±0,05),      ║
-- ║  se conserva el PRECIO del archivo: la fila describe el estado        ║
-- ║  actual, no pide repricear. Si el margen difiere de verdad, manda    ║
-- ║  el margen (repricea con fn_precio_venta, como la v3).               ║
-- ║  Resultado: export → reimport es una operación NEUTRA.               ║
-- ║                                                                     ║
-- ║  Precedencia por fila (v4):                                         ║
-- ║    margen+precio coherentes → conserva el precio del archivo         ║
-- ║    margen presente          → precio = fn_precio_venta (directo)     ║
-- ║    precio sin margen        → margen = fn_margen_desde_precio        ║
-- ║    ninguno                  → conserva (update) / precio 0 (alta)    ║
-- ║                                                                     ║
-- ║  Firma idéntica (p_filas jsonb) → CREATE OR REPLACE limpio.          ║
-- ║  REQUIERE: migraciones 108 + 109 + 124 + 125.                       ║
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
  v_margen numeric;
  v_costo_in numeric;
  v_iva_in numeric;
  v_precio_in numeric;
  v_iva_eff numeric;
  v_costo_eff numeric;
  v_precio_final numeric;
  v_margen_del_precio numeric;
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

      -- ── Pricing: coherencia (conservar) / directo (margen→precio) /
      --    inverso (precio→margen) ──
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
        if v_precio_in is not null and v_precio_in > 0
           and abs(public.fn_margen_desde_precio(v_costo_eff, v_precio_in, v_iva_eff) - v_margen) <= 0.05 then
          -- PAR COHERENTE (típico export→reimport): el margen de la fila ya es
          -- el margen real de ese precio → conservar el precio TAL CUAL.
          -- Repricear con fn_precio_venta lo subiría al múltiplo siguiente
          -- (round-trip no idempotente: 3299,99 → 3350).
          v_precio_final := v_precio_in;
        else
          -- DIRECTO: costo + margen → precio con margen asegurado.
          v_precio_final := public.fn_precio_venta(v_costo_eff, v_margen, v_iva_eff);
        end if;
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
