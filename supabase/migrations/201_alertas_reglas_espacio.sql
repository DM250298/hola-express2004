-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 201 · Alertas del espacio: fuera de lugar y marca ajena  ║
-- ║                                                                     ║
-- ║  Usan lo que la mig 199 sumó a las ubicaciones:                     ║
-- ║   · fuera_de_lugar (informativo, APAGADA de entrada): el producto   ║
-- ║     vive en un espacio con categoría asignada y es de OTRA          ║
-- ║     categoría. Arranca apagada porque "Almacén" o "Kiosco" agrupan  ║
-- ║     muchas categorías reales: primero conviene revisar las          ║
-- ║     categorías de cada espacio, después prenderla desde Reglas.     ║
-- ║   · marca_ajena (atención): el producto está en una heladera o      ║
-- ║     freezer con marca exclusiva y es de otra marca.                 ║
-- ║                                                                     ║
-- ║  La categoría y la marca se heredan: un estante sin categoría usa   ║
-- ║  la de su góndola. Cuenta solo la ubicación PRINCIPAL del producto. ║
-- ║                                                                     ║
-- ║  fn__alertas_reglas_espacio sigue el contrato de las migs 184/185   ║
-- ║  (lee reglas activas, escribe en pg_temp._alertas_candidatas). La   ║
-- ║  llama fn__alertas_reglas_catalogo desde la mig 202.                ║
-- ║  REQUIERE: migs 183-187, 190 y 199. Ejecutar UNA sola vez.          ║
-- ╚════════════════════════════════════════════════════════════════════╝

insert into public.reglas_alerta
  (codigo, nombre, descripcion, severidad, activa, parametros, orden)
values
  ('fuera_de_lugar', 'Productos fuera de su lugar',
   'Productos ubicados en un espacio asignado a otra categoría (por ejemplo, una galletita en el divisor de Librería).',
   'informativo', false, '{}', 95),
  ('marca_ajena', 'Otra marca en heladera de marca',
   'Productos de otra marca dentro de una heladera o freezer exclusivo de una marca.',
   'atencion', true, '{}', 45)
on conflict (codigo) do nothing;

create or replace function public.fn__alertas_reglas_espacio(p_hoy date)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_par jsonb;
begin
  -- Cada ubicación con la categoría y la marca efectivas (propias o heredadas).
  drop table if exists pg_temp._alertas_espacio;
  create temp table _alertas_espacio on commit drop as
  with recursive cadena as (
    select u.id as origen, u.id, u.parent_id, u.categoria_id, u.marca_exclusiva_id, 0 as nivel
    from public.ubicaciones u
    where u.activo
    union all
    select c.origen, p.id, p.parent_id, p.categoria_id, p.marca_exclusiva_id, c.nivel + 1
    from cadena c
    join public.ubicaciones p on p.id = c.parent_id
  )
  select
    o.id as ubic_id,
    coalesce(o.codigo, o.nombre) as ubic_nombre,
    (select c.categoria_id from cadena c
     where c.origen = o.id and c.categoria_id is not null
     order by c.nivel limit 1) as cat_id,
    (select c.marca_exclusiva_id from cadena c
     where c.origen = o.id and c.marca_exclusiva_id is not null
     order by c.nivel limit 1) as marca_id
  from public.ubicaciones o
  where o.activo;

  -- ── marca_ajena ──
  select r.parametros into v_par
  from public.reglas_alerta r where r.codigo = 'marca_ajena' and r.activa;
  if found then
    insert into pg_temp._alertas_candidatas
    select 'marca_ajena', 'marca_ajena:producto:' || p.id,
           'producto', p.id, p.id,
           e.ubic_nombre, p.nombre,
           jsonb_build_object(
             'ubicacion', e.ubic_nombre,
             'marca_espacio', me.nombre,
             'marca_producto', mp.nombre
           ),
           coalesce(s.ingresos, 0)
    from public.producto_ubicacion pu
    join public.productos p on p.id = pu.producto_id and p.activo
    join pg_temp._alertas_espacio e on e.ubic_id = pu.ubicacion_id
    join public.marcas me on me.id = e.marca_id
    join public.marcas mp on mp.id = p.marca_id
    left join pg_temp._alertas_skus s on s.producto_id = p.id
    where pu.es_principal
      and e.marca_id is not null
      and p.marca_id is not null
      and p.marca_id <> e.marca_id;
  end if;

  -- ── fuera_de_lugar ──
  select r.parametros into v_par
  from public.reglas_alerta r where r.codigo = 'fuera_de_lugar' and r.activa;
  if found then
    insert into pg_temp._alertas_candidatas
    select 'fuera_de_lugar', 'fuera_de_lugar:producto:' || p.id,
           'producto', p.id, p.id,
           e.ubic_nombre, p.nombre,
           jsonb_build_object(
             'ubicacion', e.ubic_nombre,
             'categoria_espacio', ce.nombre,
             'categoria_producto', cp.nombre
           ),
           coalesce(s.ingresos, 0)
    from public.producto_ubicacion pu
    join public.productos p on p.id = pu.producto_id and p.activo
    join pg_temp._alertas_espacio e on e.ubic_id = pu.ubicacion_id
    join public.categorias ce on ce.id = e.cat_id
    join public.categorias cp on cp.id = p.categoria_id
    left join pg_temp._alertas_skus s on s.producto_id = p.id
    where pu.es_principal
      and e.cat_id is not null
      and p.categoria_id is not null
      and p.categoria_id <> e.cat_id;
  end if;
end;
$$;

revoke execute on function public.fn__alertas_reglas_espacio(date) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- Verificación (debe dar true y 2):
select
  to_regprocedure('public.fn__alertas_reglas_espacio(date)') is not null as funcion,
  (select count(*) from public.reglas_alerta
   where codigo in ('fuera_de_lugar', 'marca_ajena')) as reglas;
