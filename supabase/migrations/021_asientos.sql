-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 021 · FASE 1 — Asientos contables (libro diario)         ║
-- ║                                                                     ║
-- ║  Partida doble: cada asiento tiene líneas con Debe/Haber que deben  ║
-- ║  balancear. `fn_crear_asiento` valida el balance y lo registra      ║
-- ║  atómicamente.                                                      ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

create table if not exists public.asientos (
  id serial primary key,
  fecha date not null default current_date,
  descripcion text not null,
  tipo text not null default 'manual',
  origen text,
  referencia_id integer,
  usuario_id uuid references public.usuarios(id),
  anulado boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.asientos_items (
  id serial primary key,
  asiento_id integer not null
    references public.asientos(id) on delete cascade,
  cuenta_id integer not null references public.plan_cuentas(id),
  debe numeric(14,2) not null default 0,
  haber numeric(14,2) not null default 0,
  orden integer not null default 0
);

alter table public.asientos enable row level security;
alter table public.asientos_items enable row level security;

do $$ begin
  create policy "todo" on public.asientos
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "todo" on public.asientos_items
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- Crear un asiento manual validando la partida doble
create or replace function public.fn_crear_asiento(
  p_fecha date,
  p_descripcion text,
  p_usuario_id uuid,
  p_lineas jsonb
) returns public.asientos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asiento public.asientos;
  v_linea jsonb;
  v_total_debe numeric := 0;
  v_total_haber numeric := 0;
  v_orden integer := 0;
begin
  if p_lineas is null or jsonb_array_length(p_lineas) < 2 then
    raise exception 'El asiento debe tener al menos 2 líneas.';
  end if;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_total_debe := v_total_debe + coalesce((v_linea->>'debe')::numeric, 0);
    v_total_haber := v_total_haber + coalesce((v_linea->>'haber')::numeric, 0);
  end loop;

  if round(v_total_debe, 2) <> round(v_total_haber, 2) then
    raise exception 'El asiento no balancea: Debe % ≠ Haber %',
      round(v_total_debe, 2), round(v_total_haber, 2);
  end if;
  if round(v_total_debe, 2) = 0 then
    raise exception 'El asiento no puede ser por importe cero.';
  end if;

  insert into public.asientos (fecha, descripcion, tipo, usuario_id)
  values (p_fecha, p_descripcion, 'manual', p_usuario_id)
  returning * into v_asiento;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (
      v_asiento.id,
      (v_linea->>'cuenta_id')::integer,
      coalesce((v_linea->>'debe')::numeric, 0),
      coalesce((v_linea->>'haber')::numeric, 0),
      v_orden
    );
    v_orden := v_orden + 1;
  end loop;

  return v_asiento;
end;
$$;

notify pgrst, 'reload schema';
