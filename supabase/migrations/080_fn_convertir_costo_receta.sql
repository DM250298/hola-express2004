-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 080 · fn_convertir_unidad + fn_costo_receta (Fase 2)     ║
-- ║                                                                     ║
-- ║  · fn_convertir_unidad: espeja lib/utils/unidades.ts. Convierte     ║
-- ║    SOLO dentro de la misma dimensión (kg↔g, lt↔ml); lanza si cruza  ║
-- ║    dimensiones o la unidad no es canónica. Factores constantes.     ║
-- ║                                                                     ║
-- ║  · fn_costo_receta: costo unitario derivado de la receta, RECURSIVO ║
-- ║    (un ingrediente puede ser semi_elaborado con su propia receta).  ║
-- ║    Anti-ciclo por tope de profundidad duro (p_depth > 20). Convierte║
-- ║    cada cantidad de receta a la unidad de stock del insumo antes de ║
-- ║    multiplicar por su costo. Solo lectura (stable). Se usa para el   ║
-- ║    preview on-read en la UI de receta.                              ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- fn_convertir_unidad — conversión intra-dimensión (espejo de unidades.ts)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_convertir_unidad(
  p_cantidad numeric, p_desde text, p_hacia text
) returns numeric language plpgsql immutable as $$
declare v_fd numeric; v_fh numeric; v_dd text; v_dh text;
begin
  v_fd := case p_desde when 'kg' then 1000 when 'g' then 1 when 'lt' then 1000 when 'ml' then 1 when 'unidad' then 1 else null end;
  v_fh := case p_hacia when 'kg' then 1000 when 'g' then 1 when 'lt' then 1000 when 'ml' then 1 when 'unidad' then 1 else null end;
  v_dd := case p_desde when 'kg' then 'peso' when 'g' then 'peso' when 'lt' then 'volumen' when 'ml' then 'volumen' when 'unidad' then 'conteo' else null end;
  v_dh := case p_hacia when 'kg' then 'peso' when 'g' then 'peso' when 'lt' then 'volumen' when 'ml' then 'volumen' when 'unidad' then 'conteo' else null end;
  if v_fd is null or v_fh is null then
    raise exception 'Unidad no canónica: % / %', p_desde, p_hacia;
  end if;
  if v_dd <> v_dh then
    raise exception 'No se puede convertir de % a %: distinta dimensión', p_desde, p_hacia;
  end if;
  return (p_cantidad * v_fd) / v_fh;
end $$;

grant execute on function public.fn_convertir_unidad(numeric, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- fn_costo_receta — costeo recursivo con anti-ciclo por profundidad
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_costo_receta(
  p_producto_id integer, p_depth integer default 0
) returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  v_costo numeric := 0;
  v_rend numeric;
  v_ing record;
  v_costo_ing numeric;
  v_cant_stock numeric;
  v_unidad_insumo text;
begin
  if p_depth > 20 then
    raise exception 'Receta con ciclo o demasiado profunda (producto %).', p_producto_id;
  end if;

  select rendimiento into v_rend
    from public.recetas where producto_id = p_producto_id and activa = true;
  -- Sin receta activa: es un insumo hoja, su costo es el de costos_producto.
  if v_rend is null then
    return public.fn_costo(p_producto_id);
  end if;

  for v_ing in
    select ri.insumo_id, ri.cantidad, ri.unidad, ri.merma_pct
    from public.receta_ingredientes ri
    join public.recetas r on r.id = ri.receta_id
    where r.producto_id = p_producto_id and r.activa = true
  loop
    -- Costo del insumo: recursivo si es semi con receta, si no costo directo.
    if exists (select 1 from public.recetas where producto_id = v_ing.insumo_id and activa = true) then
      v_costo_ing := public.fn_costo_receta(v_ing.insumo_id, p_depth + 1);
    else
      v_costo_ing := public.fn_costo(v_ing.insumo_id);
    end if;

    -- Cantidad de receta convertida a la unidad de stock del insumo.
    select unidad into v_unidad_insumo from public.productos where id = v_ing.insumo_id;
    v_cant_stock := public.fn_convertir_unidad(v_ing.cantidad, v_ing.unidad, v_unidad_insumo);

    v_costo := v_costo + (v_cant_stock * (1 + v_ing.merma_pct / 100.0)) * v_costo_ing;
  end loop;

  return case when v_rend > 0 then v_costo / v_rend else 0 end;
end $$;

grant execute on function public.fn_costo_receta(integer, integer) to authenticated;

notify pgrst, 'reload schema';
