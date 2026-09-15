-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 191 · Alertas: faltante real vs. stock mal contado       ║
-- ║                                                                     ║
-- ║  Reemplaza fn__alertas_reglas_productos (mig 184) para separar:     ║
-- ║   · stock_desfasado → stock negativo, o en cero pero el producto    ║
-- ║     se siguió vendiendo DESPUÉS de que arrancó el quiebre (si no    ║
-- ║     hay quiebre registrado, vendió en los últimos N días). Hay      ║
-- ║     mercadería: se cuenta y se ajusta, no se repone.                ║
-- ║   · quiebre_clave → solo lo que está realmente en cero y dejó de    ║
-- ║     venderse. Eso sí es reposición.                                 ║
-- ║                                                                     ║
-- ║  N sale del parámetro 'dias_venta_reciente' de stock_desfasado      ║
-- ║  (mig 190); si esa regla no existe o está apagada, 2 días.          ║
-- ║  El resto de las reglas queda igual que en la 184.                  ║
-- ║                                                                     ║
-- ║  REQUIERE: migs 183-187 y 190. Ejecutar UNA sola vez, COMPLETO.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn__alertas_reglas_productos(p_hoy date)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_par jsonb;
  v_clases text[];
  v_dias_venta integer;
begin
  -- ── Base común: todo lo que hoy figura sin stock, con su quiebre
  --    abierto y su última venta real (kardex). ──
  select least(round(coalesce((r.parametros->>'dias_venta_reciente')::numeric, 2))::integer, 365)
  into v_dias_venta
  from public.reglas_alerta r where r.codigo = 'stock_desfasado';
  v_dias_venta := coalesce(v_dias_venta, 2);

  drop table if exists pg_temp._alertas_sin_stock;
  create temp table _alertas_sin_stock on commit drop as
  select s.*,
         q.inicio_at,
         uv.ultima_venta,
         coalesce(
           s.stock_actual < 0
           or case when q.inicio_at is not null
                   then uv.ultima_venta > q.inicio_at
                   else uv.ultima_venta > now() - make_interval(days => v_dias_venta) end,
           false
         ) as desfasado
  from (
    select s2.* from pg_temp._alertas_skus s2
    where s2.stockeable and s2.stock_actual <= 0
  ) s
  left join lateral (
    select min(qs.inicio_at) as inicio_at
    from public.quiebres_stock qs
    where qs.producto_id = s.producto_id and qs.fin_at is null
  ) q on true
  left join lateral (
    select max(m.created_at) as ultima_venta
    from public.movimientos_stock m
    where m.producto_id = s.producto_id and m.tipo = 'venta'
  ) uv on true;

  -- ── stock_desfasado: hay mercadería, el número está mal ──
  select r.parametros into v_par
  from public.reglas_alerta r where r.codigo = 'stock_desfasado' and r.activa;
  if found then
    insert into pg_temp._alertas_candidatas
    select 'stock_desfasado', 'stock_desfasado:producto:' || s.producto_id,
           'producto', s.producto_id, s.producto_id,
           coalesce(s.categoria, 'Sin categoría'), s.nombre,
           jsonb_build_object(
             'stock', s.stock_actual,
             'ultima_venta', s.ultima_venta,
             'sin_stock_desde', s.inicio_at,
             'venta_diaria', round(s.venta_diaria, 2),
             'clase_abc', s.clase_abc,
             'venta_por_peso', s.venta_por_peso
           ),
           s.ingresos
    from pg_temp._alertas_sin_stock s
    where s.desfasado;
  end if;

  -- ── quiebre_clave: en cero de verdad y dejó de venderse ──
  select r.parametros into v_par
  from public.reglas_alerta r where r.codigo = 'quiebre_clave' and r.activa;
  if found then
    v_clases := array(select jsonb_array_elements_text(coalesce(v_par->'clases', '[]'::jsonb)));
    insert into pg_temp._alertas_candidatas
    select 'quiebre_clave', 'quiebre_clave:producto:' || s.producto_id,
           'producto', s.producto_id, s.producto_id,
           coalesce(s.categoria, 'Sin categoría'), s.nombre,
           jsonb_build_object(
             'stock', s.stock_actual,
             'sin_stock_desde', s.inicio_at,
             'ultima_venta', s.ultima_venta,
             'venta_diaria', round(s.venta_diaria, 2),
             'clase_abc', s.clase_abc,
             'es_critico', s.es_critico,
             'proveedor', s.proveedor,
             'venta_por_peso', s.venta_por_peso
           ),
           -- venta que se deja de hacer por día (estimación)
           round(s.venta_diaria * s.precio_venta, 2)
    from pg_temp._alertas_sin_stock s
    where not s.desfasado
      and (s.clase_abc = any(v_clases)
           or (coalesce((v_par->>'incluir_criticos')::boolean, false) and s.es_critico)
           -- Sin stock no vende y se puede caer de la clase A: si ya estaba
           -- alertado, sigue alertado hasta que vuelva a tener stock.
           or exists (
             select 1 from public.alertas a
             where a.dedupe_key = 'quiebre_clave:producto:' || s.producto_id
               and a.estado <> 'resuelta'
           ));
  end if;

  -- ── por_quebrar: con stock, pero alcanza para menos de N días ──
  select r.parametros into v_par
  from public.reglas_alerta r where r.codigo = 'por_quebrar' and r.activa;
  if found then
    v_clases := array(select jsonb_array_elements_text(coalesce(v_par->'clases', '[]'::jsonb)));
    insert into pg_temp._alertas_candidatas
    select 'por_quebrar', 'por_quebrar:producto:' || s.producto_id,
           'producto', s.producto_id, s.producto_id,
           coalesce(s.categoria, 'Sin categoría'), s.nombre,
           jsonb_build_object(
             'stock', s.stock_actual,
             'dias_cobertura', round(s.stock_actual / nullif(s.venta_diaria, 0), 1),
             'venta_diaria', round(s.venta_diaria, 2),
             'clase_abc', s.clase_abc,
             'proveedor', s.proveedor,
             'venta_por_peso', s.venta_por_peso
           ),
           round(s.venta_diaria * s.precio_venta, 2)
    from pg_temp._alertas_skus s
    where s.stockeable
      and s.stock_actual > 0
      and s.venta_diaria > 0
      and s.stock_actual / nullif(s.venta_diaria, 0) < coalesce((v_par->>'dias_cobertura')::numeric, 3)
      and s.clase_abc = any(v_clases);
  end if;

  -- ── inmovilizado: stock quieto hace más de N días y vale algo ──
  select r.parametros into v_par
  from public.reglas_alerta r where r.codigo = 'inmovilizado' and r.activa;
  if found then
    insert into pg_temp._alertas_candidatas
    select 'inmovilizado', 'inmovilizado:producto:' || x.producto_id,
           'producto', x.producto_id, x.producto_id,
           coalesce(x.categoria, 'Sin categoría'), x.nombre,
           jsonb_build_object(
             'stock', x.stock_actual,
             'dias_sin_venta', x.dias_sin_venta,
             'ultima_compra', x.ultima_compra,
             'valor', round(x.valor, 2),
             'venta_por_peso', x.venta_por_peso
           ),
           round(x.valor, 2)
    from (
      select s.*,
             s.stock_actual * coalesce(s.costo, 0) as valor,
             coalesce(
               s.dias_sin_venta,
               floor(extract(epoch from now() - s.ultima_compra) / 86400)::integer,
               9999
             ) as dias_quieto
      from pg_temp._alertas_skus s
      where s.stockeable and s.stock_actual > 0
    ) x
    where x.dias_quieto > coalesce((v_par->>'dias_sin_venta')::numeric, 45)
      and x.valor >= coalesce((v_par->>'valor_minimo')::numeric, 0)
      and x.valor > 0;
  end if;

  -- ── sobrestock: se vende, pero el stock cubre más de N días ──
  select r.parametros into v_par
  from public.reglas_alerta r where r.codigo = 'sobrestock' and r.activa;
  if found then
    insert into pg_temp._alertas_candidatas
    select 'sobrestock', 'sobrestock:producto:' || x.producto_id,
           'producto', x.producto_id, x.producto_id,
           coalesce(x.categoria, 'Sin categoría'), x.nombre,
           jsonb_build_object(
             'stock', x.stock_actual,
             'dias_cobertura', round(x.cobertura, 0),
             'venta_diaria', round(x.venta_diaria, 2),
             'valor', round(x.valor, 2),
             'exceso_valor', round(x.exceso_valor, 2),
             'venta_por_peso', x.venta_por_peso
           ),
           round(x.exceso_valor, 2)
    from (
      select s.*,
             s.stock_actual / nullif(s.venta_diaria, 0) as cobertura,
             s.stock_actual * coalesce(s.costo, 0) as valor,
             greatest(
               s.stock_actual - s.venta_diaria * coalesce((v_par->>'dias_cobertura')::numeric, 90),
               0
             ) * coalesce(s.costo, 0) as exceso_valor
      from pg_temp._alertas_skus s
      where s.stockeable and s.stock_actual > 0 and s.venta_diaria > 0
    ) x
    where x.cobertura > coalesce((v_par->>'dias_cobertura')::numeric, 90)
      and x.valor >= coalesce((v_par->>'valor_minimo')::numeric, 0);
  end if;

  -- ── sin_ubicacion: los que más venden sin ubicación principal ──
  select r.parametros into v_par
  from public.reglas_alerta r where r.codigo = 'sin_ubicacion' and r.activa;
  if found then
    v_clases := array(select jsonb_array_elements_text(coalesce(v_par->'clases', '[]'::jsonb)));
    insert into pg_temp._alertas_candidatas
    select 'sin_ubicacion', 'sin_ubicacion:producto:' || s.producto_id,
           'producto', s.producto_id, s.producto_id,
           coalesce(s.categoria, 'Sin categoría'), s.nombre,
           jsonb_build_object('ingresos', s.ingresos, 'clase_abc', s.clase_abc),
           s.ingresos
    from pg_temp._alertas_skus s
    where s.clase_abc = any(v_clases)
      and not exists (
        select 1 from public.producto_ubicacion pu
        where pu.producto_id = s.producto_id and pu.es_principal
      );
  end if;
end;
$$;

revoke execute on function public.fn__alertas_reglas_productos(date) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- Verificación: correr el evaluador y ver el reparto por regla.
--   select public.fn_evaluar_alertas('manual');
--   select regla_codigo, severidad, count(*) from public.alertas
--   where estado <> 'resuelta' group by 1, 2 order by 2, 1;
select to_regprocedure('public.fn__alertas_reglas_productos(date)') is not null as creada;
