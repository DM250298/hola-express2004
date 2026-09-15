-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 170 · Ubicaciones físicas (árbol) + producto↔ubicación   ║
-- ║                                                                     ║
-- ║  Primera pieza del modelo físico del local (Fase A del plan de      ║
-- ║  evolución). Solo SCHEMA + SEED — la UI del mapa llega en Fase B.   ║
-- ║  Va primero porque metricas_sku_diarias (mig 173) necesita la FK    ║
-- ║  gondola_id.                                                        ║
-- ║                                                                     ║
-- ║  DISEÑO (aprobado por el dueño):                                    ║
-- ║   · Árbol ÚNICO auto-referenciado con `tipo`, no 5 tablas: la       ║
-- ║     profundidad real es variable (una heladera es una góndola sin   ║
-- ║     módulos; el depósito es un sector sin góndolas). Un producto    ║
-- ║     puede colgar de CUALQUIER nivel.                                ║
-- ║   · La "posición" dentro del estante NO es entidad: es              ║
-- ║     producto_ubicacion.orden (entero, izquierda→derecha).           ║
-- ║   · La raíz tipo 'sucursal' deja el modelo conceptualmente listo    ║
-- ║     para multi-local, pero NADA se particiona por sucursal todavía. ║
-- ║   · N:M producto↔ubicación con es_principal: un SKU puede estar en  ║
-- ║     góndola + heladera + depósito; el análisis de góndola se        ║
-- ║     atribuye a la principal.                                        ║
-- ║   · NO hay stock por ubicación (decisión explícita: registrar cada  ║
-- ║     reposición interna góndola↔depósito es carga manual que nadie   ║
-- ║     va a hacer). producto_ubicacion dice DÓNDE VIVE el SKU, no      ║
-- ║     cuánto hay en cada lugar.                                       ║
-- ║                                                                     ║
-- ║  SEED: migra lo que ya existe — cada valor distinto de              ║
-- ║  productos.ubicacion (texto libre, mig 065) se convierte en una     ║
-- ║  góndola bajo "Salón", y cada producto recibe su fila principal.    ║
-- ║  productos.ubicacion queda DEPRECADA (se dropea recién cuando       ║
-- ║  producto_ubicacion tenga cobertura, criterio migs 050→052).        ║
-- ║                                                                     ║
-- ║  Después de correrla, actualizar types/database.ts:                 ║
-- ║   · Tables: ubicaciones, producto_ubicacion                         ║
-- ║   · Aliases: UbicacionRow/Insert/Update, ProductoUbicacionRow/…     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Árbol de ubicaciones
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.ubicaciones (
  id         serial primary key,
  parent_id  integer references public.ubicaciones(id) on delete restrict,
  tipo       text not null
    check (tipo in ('sucursal', 'sector', 'gondola', 'modulo', 'estante')),
  nombre     text not null,
  codigo     text unique,
  orden      integer not null default 0,
  activo     boolean not null default true,
  notas      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ubicaciones is
  'Árbol físico del local: sucursal → sector → góndola → módulo → estante.
   Niveles salteables (un estante puede colgar directo de una góndola).
   La "posición" dentro del estante NO es un nivel: es producto_ubicacion.orden.';
comment on column public.ubicaciones.codigo is
  'Código corto para etiqueta física / QR, ej. G03-M2-E1. Opcional, único.';
comment on column public.ubicaciones.orden is
  'Orden visual y de recorrido de reposición entre hermanos.';

create index if not exists ubicaciones_parent_idx on public.ubicaciones(parent_id);

-- Coherencia jerárquica por trigger (patrón trg_valida_componente_combo,
-- mig 112). Los ciclos son imposibles: cada tipo solo acepta padres de
-- tipo estrictamente superior.
create or replace function public.fn_valida_ubicacion()
returns trigger
language plpgsql
as $$
declare
  v_parent_tipo text;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'Una ubicación no puede ser su propio padre.';
    end if;
    select tipo into v_parent_tipo from public.ubicaciones where id = new.parent_id;
    if v_parent_tipo is null then
      raise exception 'La ubicación padre % no existe.', new.parent_id;
    end if;
  end if;

  if new.tipo = 'sucursal' then
    if new.parent_id is not null then
      raise exception 'Una sucursal es raíz: no puede tener padre.';
    end if;
  elsif new.tipo = 'sector' then
    if v_parent_tipo is distinct from 'sucursal' then
      raise exception 'Un sector debe colgar de una sucursal.';
    end if;
  elsif new.tipo = 'gondola' then
    if v_parent_tipo is distinct from 'sector' then
      raise exception 'Una góndola debe colgar de un sector.';
    end if;
  elsif new.tipo = 'modulo' then
    if v_parent_tipo is distinct from 'gondola' then
      raise exception 'Un módulo debe colgar de una góndola.';
    end if;
  elsif new.tipo = 'estante' then
    -- NULL-safe: con parent_id nulo, v_parent_tipo NULL haría que NOT IN
    -- evalúe NULL y el estante huérfano pasara sin excepción.
    if v_parent_tipo is null or v_parent_tipo not in ('modulo', 'gondola') then
      raise exception 'Un estante debe colgar de un módulo o de una góndola.';
    end if;
  end if;

  -- Si cambia el tipo de un nodo con hijos, los hijos deben seguir siendo
  -- válidos (ej: no se puede convertir una góndola con módulos en estante).
  if tg_op = 'UPDATE' and new.tipo is distinct from old.tipo then
    if exists (
      select 1 from public.ubicaciones h
      where h.parent_id = new.id
        and not (
          (new.tipo = 'sucursal' and h.tipo = 'sector') or
          (new.tipo = 'sector'   and h.tipo = 'gondola') or
          (new.tipo = 'gondola'  and h.tipo in ('modulo', 'estante')) or
          (new.tipo = 'modulo'   and h.tipo = 'estante')
        )
    ) then
      raise exception 'No se puede cambiar el tipo: tiene ubicaciones hijas incompatibles.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_valida_ubicacion on public.ubicaciones;
create trigger trg_valida_ubicacion
  before insert or update on public.ubicaciones
  for each row execute function public.fn_valida_ubicacion();

drop trigger if exists ubicaciones_set_updated_at on public.ubicaciones;
create trigger ubicaciones_set_updated_at
  before update on public.ubicaciones
  for each row execute procedure public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- 2. producto_ubicacion — N:M con principal única
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.producto_ubicacion (
  id           serial primary key,
  producto_id  integer not null references public.productos(id) on delete cascade,
  ubicacion_id integer not null references public.ubicaciones(id) on delete cascade,
  es_principal boolean not null default false,
  orden        integer not null default 0,
  capacidad    numeric(12,3) check (capacidad is null or capacidad > 0),
  notas        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (producto_id, ubicacion_id)
);

comment on table public.producto_ubicacion is
  'Dónde VIVE cada SKU (no cuánto hay ahí). Un producto puede estar en varias
   ubicaciones; es_principal marca la de venta, a la que se atribuye el
   análisis por góndola.';
comment on column public.producto_ubicacion.orden is
  'Posición dentro del estante (izquierda→derecha). Reemplaza al nivel
   "Posición" de la jerarquía: dato de orden, no entidad.';
comment on column public.producto_ubicacion.capacidad is
  'Unidades que entran con los frentes llenos. NULL = sin dato. Habilita a
   futuro stock objetivo por espacio físico, sin nueva migración.';

create unique index if not exists producto_ubicacion_principal_unq
  on public.producto_ubicacion(producto_id) where es_principal;
create index if not exists producto_ubicacion_ubic_idx
  on public.producto_ubicacion(ubicacion_id);

drop trigger if exists producto_ubicacion_set_updated_at on public.producto_ubicacion;
create trigger producto_ubicacion_set_updated_at
  before update on public.producto_ubicacion
  for each row execute procedure public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- 3. RLS (patrón del repo: wrapper (select ...) → InitPlan, mig 111)
--    · ubicaciones: estructura del local → escribe 'configuracion'.
--    · producto_ubicacion: mover un producto es acción operativa liviana
--      → escribe 'inventario'. Lectura abierta a authenticated (el mapa
--      y el filtro de stock los usa todo el staff; no expone costos).
-- ─────────────────────────────────────────────────────────────────────
alter table public.ubicaciones enable row level security;
alter table public.producto_ubicacion enable row level security;

drop policy if exists "ubicaciones_select" on public.ubicaciones;
drop policy if exists "ubicaciones_write" on public.ubicaciones;
create policy "ubicaciones_select" on public.ubicaciones
  for select to authenticated using (true);
create policy "ubicaciones_write" on public.ubicaciones
  for all to authenticated
  using      ((select public.fn_tiene_permiso('configuracion')))
  with check ((select public.fn_tiene_permiso('configuracion')));

drop policy if exists "producto_ubicacion_select" on public.producto_ubicacion;
drop policy if exists "producto_ubicacion_write" on public.producto_ubicacion;
create policy "producto_ubicacion_select" on public.producto_ubicacion
  for select to authenticated using (true);
create policy "producto_ubicacion_write" on public.producto_ubicacion
  for all to authenticated
  using      ((select public.fn_tiene_permiso('inventario'))
           or (select public.fn_tiene_permiso('configuracion')))
  with check ((select public.fn_tiene_permiso('inventario'))
           or (select public.fn_tiene_permiso('configuracion')));

-- ─────────────────────────────────────────────────────────────────────
-- 4. SEED idempotente (todo con guardas where not exists)
-- ─────────────────────────────────────────────────────────────────────

-- 4.a Raíz + sectores base.
insert into public.ubicaciones (parent_id, tipo, nombre, orden)
select null, 'sucursal', 'Casa Central', 0
where not exists (select 1 from public.ubicaciones where tipo = 'sucursal');

insert into public.ubicaciones (parent_id, tipo, nombre, orden)
select s.id, 'sector', 'Salón', 0
from public.ubicaciones s
where s.tipo = 'sucursal'
  and not exists (
    select 1 from public.ubicaciones x
    where x.tipo = 'sector' and x.nombre = 'Salón' and x.parent_id = s.id
  )
limit 1;

insert into public.ubicaciones (parent_id, tipo, nombre, orden)
select s.id, 'sector', 'Depósito', 1
from public.ubicaciones s
where s.tipo = 'sucursal'
  and not exists (
    select 1 from public.ubicaciones x
    where x.tipo = 'sector' and x.nombre = 'Depósito' and x.parent_id = s.id
  )
limit 1;

-- 4.b Una góndola por cada valor distinto del texto legacy
--     productos.ubicacion, colgada de "Salón", nombre tal cual.
--     (Si en realidad es una heladera o un depósito, se corrige después
--     desde el ABM del mapa — acá solo se migra el dato existente.)
insert into public.ubicaciones (parent_id, tipo, nombre, orden)
select salon.id, 'gondola', t.nombre,
       row_number() over (order by t.nombre) as orden
from (
  select distinct btrim(p.ubicacion) as nombre
  from public.productos p
  where p.ubicacion is not null and btrim(p.ubicacion) <> ''
) t
cross join lateral (
  select u.id from public.ubicaciones u
  where u.tipo = 'sector' and u.nombre = 'Salón'
  order by u.id limit 1
) salon
where not exists (
  select 1 from public.ubicaciones x
  where x.tipo = 'gondola' and x.nombre = t.nombre and x.parent_id = salon.id
);

-- 4.c Fila principal por producto, apuntando a la góndola homónima BAJO
--     "Salón" (restringida al sector seed + limit 1: si alguien creó otra
--     góndola con el mismo nombre en otro sector, el join no puede
--     duplicar filas y romper el índice único parcial de es_principal).
--     Solo para productos que aún no tienen NINGUNA ubicación asignada
--     (re-correr la migración no pisa asignaciones hechas a mano).
insert into public.producto_ubicacion (producto_id, ubicacion_id, es_principal)
select p.id, g.id, true
from public.productos p
cross join lateral (
  select s.id from public.ubicaciones s
  where s.tipo = 'sector' and s.nombre = 'Salón'
  order by s.id limit 1
) salon
join lateral (
  select u.id from public.ubicaciones u
  where u.tipo = 'gondola' and u.nombre = btrim(p.ubicacion)
    and u.parent_id = salon.id
  order by u.id limit 1
) g on true
where p.ubicacion is not null and btrim(p.ubicacion) <> ''
  and not exists (
    select 1 from public.producto_ubicacion pu where pu.producto_id = p.id
  );

-- Reload PostgREST schema cache.
notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- Verificación post-migración (correr a mano):
--
--   select tipo, count(*) from public.ubicaciones group by tipo;
--     → 1 sucursal, 2+ sectores, N góndolas (N = valores distintos de
--       productos.ubicacion).
--
--   select count(*) from public.producto_ubicacion where es_principal;
--     → ≈ cantidad de productos con ubicacion texto no vacía.
--
--   -- La jerarquía rechaza incoherencias:
--   insert into public.ubicaciones (parent_id, tipo, nombre)
--   values (null, 'gondola', 'prueba');   -- debe FALLAR
-- ─────────────────────────────────────────────────────────────────────
