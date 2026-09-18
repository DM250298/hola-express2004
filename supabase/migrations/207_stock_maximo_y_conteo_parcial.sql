-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 207 · Stock máximo + conteo parcial por ubicación        ║
-- ║                                                                     ║
-- ║  PROBLEMA: /movil/ubicaciones le pedía al empleado "contá TODO lo   ║
-- ║  que hay en el local (góndola + depósito)". Parado en la góndola    ║
-- ║  eso es imposible: no ve el depósito. O adivina, o camina dos veces.║
-- ║                                                                     ║
-- ║  SOLUCIÓN (aprobada por el dueño):                                  ║
-- ║   · Se cuenta SOLO lo que se ve en la ubicación donde se está.      ║
-- ║   · Producto con UNA sola ubicación → ajusta en el acto, igual que  ║
-- ║     antes. Es el caso mayoritario: para ellos no cambia nada.       ║
-- ║   · Producto con DOS O MÁS ubicaciones → el conteo queda PARCIAL.   ║
-- ║     Cuando se cuenta la última que faltaba se suman todas y recién  ║
-- ║     ahí se ajusta el stock. El stock nunca queda a medias.          ║
-- ║   · Botón "ya conté todo" (p_cerrar) para cerrar asumiendo 0 en lo  ║
-- ║     que falte, y caducidad a las 24 hs para que ningún parcial      ║
-- ║     olvidado ensucie el conteo de mañana.                           ║
-- ║                                                                     ║
-- ║  Esto NO contradice la decisión de la mig 170 ("no hay stock por    ║
-- ║  ubicación"): conteo_parcial es el borrador efímero de un conteo en ║
-- ║  curso, no un saldo. Se vacía solo al consolidar.                   ║
-- ║                                                                     ║
-- ║  Además: productos.stock_maximo (techo del local), contracara del   ║
-- ║  stock_minimo que ya existía, editable desde el móvil y la ficha.   ║
-- ║                                                                     ║
-- ║  Después de correrla, actualizar types/database.ts:                 ║
-- ║   · productos.stock_maximo (Row/Insert/Update)                      ║
-- ║   · Tabla conteo_parcial + ConteoParcialRow/Insert/Update           ║
-- ║   · Functions: fn_guardar_conteo_ubicacion, fn_conteos_parciales_abiertos
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Stock máximo por producto
--    Nullable a propósito: NULL = sin techo definido. Así ningún producto
--    viejo queda inventado en un número, y los imports de maestros
--    (065/124/125/126, patrón coalesce(nullif(...), columna)) siguen
--    andando sin tocarlos.
--    El check "máximo >= mínimo" se valida en el formulario, NO acá: hay
--    productos históricos con stock_minimo alto que si no no se podrían
--    guardar.
-- ─────────────────────────────────────────────────────────────────────
-- numeric(12,3) y no integer: stock_minimo es numeric desde la mig 150 para
-- los productos por peso (0,500 kg de mínimo es un mínimo válido) y el techo
-- tiene que poder expresarse en la misma unidad.
alter table public.productos
  add column if not exists stock_maximo numeric(12,3)
    check (stock_maximo is null or stock_maximo >= 0);

comment on column public.productos.stock_maximo is
  'Techo de stock del LOCAL COMPLETO (no por ubicación). NULL = sin techo.
   Contracara de stock_minimo. No lo usa el Centro de Compras, que calcula
   su propio stock_objetivo por cobertura (migs 151/152).';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Conteos parciales por ubicación (borrador, no saldo)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.conteo_parcial (
  id           serial primary key,
  producto_id  integer not null references public.productos(id)   on delete cascade,
  ubicacion_id integer not null references public.ubicaciones(id) on delete cascade,
  cantidad     numeric(12,3) not null check (cantidad >= 0),
  usuario_id   uuid references public.usuarios(id),
  created_at   timestamptz not null default now(),
  unique (producto_id, ubicacion_id)
);

comment on table public.conteo_parcial is
  'Borrador de un conteo en curso: lo contado de un producto en UNA ubicación,
   esperando a que se cuenten las demás. Se vacía al consolidar el ajuste y
   caduca solo a las 24 hs. NO es stock por ubicación.';

create index if not exists conteo_parcial_producto_idx
  on public.conteo_parcial(producto_id);
create index if not exists conteo_parcial_ubicacion_idx
  on public.conteo_parcial(ubicacion_id);

-- RLS: leer lo puede todo el staff (el panel "falta contar" es colaborativo:
-- lo que dejó abierto uno lo cierra otro). Escribir, solo quien puede ajustar.
alter table public.conteo_parcial enable row level security;

drop policy if exists "conteo_parcial_select" on public.conteo_parcial;
drop policy if exists "conteo_parcial_write"  on public.conteo_parcial;
create policy "conteo_parcial_select" on public.conteo_parcial
  for select to authenticated using (true);
create policy "conteo_parcial_write" on public.conteo_parcial
  for all to authenticated
  using      ((select public.fn_tiene_permiso('inventario_ajustes')))
  with check ((select public.fn_tiene_permiso('inventario_ajustes')));

-- ─────────────────────────────────────────────────────────────────────
-- 3. fn_guardar_conteo_ubicacion
--
--    Guarda lo contado en UNA ubicación y consolida lo que ya esté completo.
--    Todo en una transacción: o se guarda el parcial y se ajusta, o nada.
--
--    p_ubicacion_id NULL = no se cuenta nada nuevo, solo se cierra lo que ya
--    está acumulado (botón "ya conté todo" desde el panel de pendientes).
--
--    Devuelve un array jsonb, una entrada por producto:
--      { producto_id, total, completo, ajustado, diferencia, faltan:[{id,nombre}] }
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_guardar_conteo_ubicacion(
  p_usuario_id   uuid,
  p_ubicacion_id integer,
  p_items        jsonb,
  p_cerrar       boolean default false
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_item         jsonb;
  v_prod_id      integer;
  v_cantidad     numeric;
  v_ids          integer[] := '{}';
  v_rec          record;
  v_ajuste_items jsonb := '[]'::jsonb;
  v_cerrados     integer[] := '{}';
  v_salida       jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'No hay nada para guardar.';
  end if;

  -- Los parciales viejos no valen: un conteo de ayer sumado a uno de hoy da
  -- un número que no existió nunca.
  delete from public.conteo_parcial
   where created_at < now() - interval '24 hours';

  -- 3.a Guardar lo contado en esta ubicación.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_prod_id  := (v_item->>'producto_id')::integer;
    v_cantidad := (v_item->>'cantidad')::numeric;
    if v_prod_id is null then
      raise exception 'Falta el producto en un renglón del conteo.';
    end if;
    if v_cantidad is null or v_cantidad < 0 then
      raise exception 'Cantidad inválida en un producto del conteo.';
    end if;
    v_ids := v_ids || v_prod_id;

    if p_ubicacion_id is not null then
      insert into public.conteo_parcial (producto_id, ubicacion_id, cantidad, usuario_id)
      values (v_prod_id, p_ubicacion_id, v_cantidad, p_usuario_id)
      on conflict (producto_id, ubicacion_id) do update
        set cantidad   = excluded.cantidad,
            usuario_id = excluded.usuario_id,
            created_at = now();
    end if;
  end loop;

  -- 3.b Decidir producto por producto si ya está completo.
  for v_rec in
    select p.id                          as producto_id,
           p.stock_actual                as stock_sistema,
           coalesce(sum(cp.cantidad), 0) as total,
           count(cp.id)                  as contadas,
           (select count(*) from public.producto_ubicacion pu
             where pu.producto_id = p.id) as ubicadas
      from public.productos p
      left join public.conteo_parcial cp on cp.producto_id = p.id
     where p.id = any(v_ids)
     group by p.id, p.stock_actual
  loop
    -- Cerrar sin un solo parcial vigente pondría el stock en cero: pasa si el
    -- pendiente caducó o lo cerró otro empleado entre que se abrió el panel y
    -- se tocó el botón. Se avisa y no se toca nada.
    if p_ubicacion_id is null and v_rec.contadas = 0 then
      v_salida := v_salida || jsonb_build_object(
        'producto_id', v_rec.producto_id,
        'total',       0,
        'completo',    false,
        'ajustado',    false,
        'sin_datos',   true,
        'diferencia',  0,
        'faltan',      '[]'::jsonb
      );
      continue;
    end if;

    -- Completo si ya se contaron todas sus ubicaciones, si vive en una sola
    -- (o en ninguna: producto todavía sin ubicar), o si se cerró a mano.
    if p_cerrar or v_rec.ubicadas <= 1 or v_rec.contadas >= v_rec.ubicadas then
      v_cerrados := v_cerrados || v_rec.producto_id;
      if v_rec.total <> v_rec.stock_sistema then
        v_ajuste_items := v_ajuste_items || jsonb_build_object(
          'producto_id', v_rec.producto_id,
          'tipo',        'ajuste',
          'cantidad',    v_rec.total
        );
      end if;
      v_salida := v_salida || jsonb_build_object(
        'producto_id', v_rec.producto_id,
        'total',       v_rec.total,
        'completo',    true,
        'ajustado',    v_rec.total <> v_rec.stock_sistema,
        'diferencia',  v_rec.total - v_rec.stock_sistema,
        'faltan',      '[]'::jsonb
      );
    else
      v_salida := v_salida || jsonb_build_object(
        'producto_id', v_rec.producto_id,
        'total',       v_rec.total,
        'completo',    false,
        'ajustado',    false,
        'diferencia',  0,
        'faltan',      coalesce((
          select jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre)
                           order by u.nombre)
            from public.producto_ubicacion pu
            join public.ubicaciones u on u.id = pu.ubicacion_id
           where pu.producto_id = v_rec.producto_id
             and not exists (select 1 from public.conteo_parcial cp
                              where cp.producto_id  = v_rec.producto_id
                                and cp.ubicacion_id = pu.ubicacion_id)
        ), '[]'::jsonb)
      );
    end if;
  end loop;

  -- 3.c Un solo ajuste con todos los que quedaron completos y difieren.
  --     Si fn_crear_ajuste_stock levanta excepción (stock negativo) cae toda
  --     la transacción: no queda ningún parcial consumido a medias.
  if jsonb_array_length(v_ajuste_items) > 0 then
    perform public.fn_crear_ajuste_stock(
      p_usuario_id, 'recuento', 'Ubicar productos (modo móvil)', v_ajuste_items
    );
  end if;

  -- 3.d Los cerrados ya no esperan a nadie.
  if array_length(v_cerrados, 1) is not null then
    delete from public.conteo_parcial where producto_id = any(v_cerrados);
  end if;

  return v_salida;
end;
$$;

comment on function public.fn_guardar_conteo_ubicacion(uuid, integer, jsonb, boolean) is
  'Guarda el conteo de una ubicación y ajusta el stock de los productos cuyas
   ubicaciones ya fueron contadas todas. p_ubicacion_id NULL = solo cerrar.';

-- ─────────────────────────────────────────────────────────────────────
-- 4. fn_conteos_parciales_abiertos
--    Alimenta el panel "Falta contar" del móvil: qué quedó a medias y dónde
--    hay que ir a terminarlo (propio o de otro empleado).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_conteos_parciales_abiertos()
returns table (
  producto_id     integer,
  producto_nombre text,
  venta_por_peso  boolean,
  contado         numeric,
  contadas        jsonb,
  faltan          jsonb,
  desde           timestamptz
)
language sql stable security definer set search_path = public
as $$
  select p.id,
         p.nombre,
         p.venta_por_peso,
         sum(cp.cantidad),
         jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre,
                                      'cantidad', cp.cantidad) order by u.nombre),
         coalesce((
           select jsonb_agg(jsonb_build_object('id', u2.id, 'nombre', u2.nombre)
                            order by u2.nombre)
             from public.producto_ubicacion pu
             join public.ubicaciones u2 on u2.id = pu.ubicacion_id
            where pu.producto_id = p.id
              and not exists (select 1 from public.conteo_parcial c2
                               where c2.producto_id  = p.id
                                 and c2.ubicacion_id = pu.ubicacion_id)
         ), '[]'::jsonb),
         min(cp.created_at)
    from public.conteo_parcial cp
    join public.productos   p on p.id = cp.producto_id
    join public.ubicaciones u on u.id = cp.ubicacion_id
   where cp.created_at >= now() - interval '24 hours'
   group by p.id, p.nombre, p.venta_por_peso
   order by min(cp.created_at);
$$;

comment on function public.fn_conteos_parciales_abiertos() is
  'Conteos a medias de las últimas 24 hs, con lo ya contado y las ubicaciones
   que faltan visitar.';
