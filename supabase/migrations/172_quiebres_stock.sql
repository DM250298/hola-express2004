-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 172 · Quiebres de stock (eventos con inicio y fin)       ║
-- ║                                                                     ║
-- ║  Hoy el sistema NO registra cuándo un producto se queda sin stock   ║
-- ║  ni por cuánto tiempo. La frecuencia y duración de quiebres — y la  ║
-- ║  venta perdida estimada — son indicadores centrales del plan.       ║
-- ║                                                                     ║
-- ║  DISEÑO:                                                            ║
-- ║   · Tabla de EVENTOS: fin_at NULL = quiebre activo. Índice único    ║
-- ║     parcial → imposible tener 2 quiebres abiertos del mismo SKU.    ║
-- ║   · Trigger AFTER INSERT sobre movimientos_stock, el punto único    ║
-- ║     por donde pasa TODO cambio legítimo de stock (las ~12 RPCs      ║
-- ║     insertan ahí). O(1) y SOLO OBSERVA: no modifica stock, así que  ║
-- ║     respeta la disciplina del repo de "sin triggers de inventario"  ║
-- ║     (que aplica a MANTENER stock_actual, no a mirarlo).             ║
-- ║   · La estimación de venta perdida NO se calcula acá (sería una     ║
-- ║     query de 30 días dentro del hot path de fn_crear_venta): la     ║
-- ║     congela el snapshot nocturno (mig 173) al cerrar el evento, y   ║
-- ║     para los abiertos se calcula al vuelo en fn_quiebres.           ║
-- ║                                                                     ║
-- ║  LIMITACIONES CONOCIDAS (documentadas, no bugs):                    ║
-- ║   · controlar_stock = false no genera movimientos → invisible.      ║
-- ║   · Los combos no tienen movimientos propios: su quiebre se deriva  ║
-- ║     de los componentes en lectura, no se persiste.                  ║
-- ║   · Un UPDATE directo a productos.stock_actual fuera de las RPCs    ║
-- ║     no dispara el trigger (hardening en P1: fn_crear_lote /         ║
-- ║     fn_baja_lote + revoke de la columna).                           ║
-- ║                                                                     ║
-- ║  Después de correrla, actualizar types/database.ts:                 ║
-- ║   · Tables: quiebres_stock · Aliases: QuiebreStockRow/…             ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Tabla de eventos
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.quiebres_stock (
  id                  serial primary key,
  producto_id         integer not null references public.productos(id) on delete cascade,
  inicio_at           timestamptz not null,
  fin_at              timestamptz,
  mov_inicio_id       integer references public.movimientos_stock(id) on delete set null,
  mov_fin_id          integer references public.movimientos_stock(id) on delete set null,
  venta_perdida_unid  numeric(12,3),
  venta_perdida_pesos numeric(14,2),
  created_at          timestamptz not null default now()
);

comment on table public.quiebres_stock is
  'Eventos de quiebre de stock por SKU. fin_at NULL = quiebre activo.
   venta_perdida_* es una ESTIMACIÓN (velocity 30d previa × días de quiebre,
   a precio de venta vigente al cierre) — la UI SIEMPRE la etiqueta como
   estimación, nunca como dato contable. La congela el snapshot nocturno.';

-- Un solo quiebre abierto por producto (además le da al trigger su
-- on conflict y un índice barato para "quiebres activos").
create unique index if not exists quiebres_abierto_unq
  on public.quiebres_stock(producto_id) where fin_at is null;
create index if not exists quiebres_producto_idx
  on public.quiebres_stock(producto_id, inicio_at desc);
create index if not exists quiebres_fin_idx
  on public.quiebres_stock(fin_at desc) where fin_at is not null;

alter table public.quiebres_stock enable row level security;
drop policy if exists "quiebres_select" on public.quiebres_stock;
create policy "quiebres_select" on public.quiebres_stock
  for select to authenticated using (true);
-- Sin policy de escritura: escriben solo el trigger y las RPCs definer.

-- ─────────────────────────────────────────────────────────────────────
-- 2. Trigger observador sobre movimientos_stock
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_trg_quiebre()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stock_nuevo <= 0 and new.stock_anterior > 0 then
    -- Cruzó a quiebre: abre evento (si ya había uno abierto, no duplica).
    insert into public.quiebres_stock (producto_id, inicio_at, mov_inicio_id)
    values (new.producto_id, new.created_at, new.id)
    on conflict (producto_id) where fin_at is null do nothing;
  elsif new.stock_nuevo > 0 and new.stock_anterior <= 0 then
    -- Volvió a tener stock: cierra el evento abierto (si lo hay).
    update public.quiebres_stock
       set fin_at = new.created_at, mov_fin_id = new.id
     where producto_id = new.producto_id and fin_at is null;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_quiebre_stock on public.movimientos_stock;
create trigger trg_quiebre_stock
  after insert on public.movimientos_stock
  for each row execute function public.fn_trg_quiebre();

-- ─────────────────────────────────────────────────────────────────────
-- 3. Backfill de quiebres ACTUALMENTE abiertos.
--    Solo productos activos, con control de stock, hoy en <= 0, y que
--    tengan el cruce registrado en el kardex (un movimiento que los dejó
--    en <= 0 sin ningún movimiento posterior que los devuelva a > 0).
--    Los productos sin movimientos (nunca stockeados) NO abren evento:
--    "nunca tuvo stock" no es un quiebre, es catálogo sin cargar.
-- ─────────────────────────────────────────────────────────────────────
insert into public.quiebres_stock (producto_id, inicio_at, mov_inicio_id)
select p.id, m.created_at, m.id
from public.productos p
-- Desempate por id además de created_at: dentro de una misma transacción
-- todos los movimientos comparten now(), así que el timestamp solo no
-- alcanza para ordenar "posterior".
join lateral (
  select ms.id, ms.created_at
  from public.movimientos_stock ms
  where ms.producto_id = p.id
    and ms.stock_nuevo <= 0 and ms.stock_anterior > 0
    and not exists (
      select 1 from public.movimientos_stock ms2
      where ms2.producto_id = p.id
        and (ms2.created_at, ms2.id) > (ms.created_at, ms.id)
        and ms2.stock_nuevo > 0
    )
  order by ms.created_at desc, ms.id desc
  limit 1
) m on true
where p.activo
  and coalesce(p.controlar_stock, true)
  and p.stock_actual <= 0
  and not exists (
    select 1 from public.quiebres_stock q
    where q.producto_id = p.id and q.fin_at is null
  );

-- Reload PostgREST schema cache.
notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- Verificación post-migración:
--
--   -- Quiebres abiertos tras el backfill (comparar contra el KPI
--   -- "Sin stock" de /inventario; puede ser menor: solo entran los que
--   -- tienen el cruce en el kardex):
--   select count(*) from public.quiebres_stock where fin_at is null;
--
--   -- Smoke del trigger: vender un producto hasta 0 → aparece abierto;
--   -- recibirlo/ajustarlo a > 0 → se cierra con fin_at y mov_fin_id.
--   select * from public.quiebres_stock order by id desc limit 5;
-- ─────────────────────────────────────────────────────────────────────
