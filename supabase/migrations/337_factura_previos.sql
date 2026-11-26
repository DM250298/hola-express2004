-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 337 · Foto del costo y precio ANTES de cada factura      ║
-- ║                                                                     ║
-- ║  Para poder ELIMINAR una factura y volver el costo y el precio de   ║
-- ║  cada producto a lo que tenían antes (mig 342), hay que guardarlos: ║
-- ║  historial_costos solo anota el costo y solo cuando cambia.         ║
-- ║                                                                     ║
-- ║  Un trigger BEFORE INSERT en items_factura_compra saca la foto del  ║
-- ║  producto. fn_guardar_factura_compra (325) y                        ║
-- ║  fn_registrar_compra_directa (323) insertan el ítem ANTES de tocar  ║
-- ║  costo y precio, así que la foto ve los valores previos.            ║
-- ║                                                                     ║
-- ║  Editar una factura la borra y la reinserta: la foto se guarda UNA  ║
-- ║  sola vez por (deuda, producto) y sobrevive a las re-ediciones      ║
-- ║  (cuelga de la deuda, no de la factura). Las compras directas sin   ║
-- ║  deuda cuelgan de la factura.                                       ║
-- ║                                                                     ║
-- ║  Las facturas anteriores a esta migración no tienen foto: al        ║
-- ║  eliminarlas el costo sale de historial_costos y el precio no se    ║
-- ║  toca.                                                              ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

create table if not exists public.factura_compra_previos (
  id               serial primary key,
  cuenta_id        integer references public.cuentas_a_pagar(id) on delete cascade,
  factura_id       integer references public.facturas_compra(id) on delete cascade,
  producto_id      integer not null references public.productos(id) on delete cascade,
  costo            numeric(14,4),
  costo_proveedor  numeric(14,4),
  precio_venta     numeric(14,2),
  margen           numeric(10,2),
  precio_mayorista numeric(14,2),
  margen_mayorista numeric(10,2),
  pendiente_precio boolean,
  created_at       timestamptz not null default now(),
  constraint factura_compra_previos_dueno check (cuenta_id is not null or factura_id is not null)
);

create unique index if not exists uq_factura_previos_cuenta
  on public.factura_compra_previos (cuenta_id, producto_id) where cuenta_id is not null;
create unique index if not exists uq_factura_previos_factura
  on public.factura_compra_previos (factura_id, producto_id) where cuenta_id is null;

-- Solo la leen y escriben las funciones security definer: sin policies.
alter table public.factura_compra_previos enable row level security;
revoke all on public.factura_compra_previos from anon, authenticated;

create or replace function public.fn_trg_factura_previos()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_cuenta_id integer;
  v_proveedor_id integer;
begin
  if new.producto_id is null then
    return new;
  end if;

  select cuenta_id, proveedor_id into v_cuenta_id, v_proveedor_id
    from public.facturas_compra where id = new.factura_id;

  if v_cuenta_id is not null then
    if exists (select 1 from public.factura_compra_previos
               where cuenta_id = v_cuenta_id and producto_id = new.producto_id) then
      return new;
    end if;
  elsif exists (select 1 from public.factura_compra_previos
                where cuenta_id is null and factura_id = new.factura_id
                  and producto_id = new.producto_id) then
    return new;
  end if;

  insert into public.factura_compra_previos (
    cuenta_id, factura_id, producto_id, costo, costo_proveedor,
    precio_venta, margen, precio_mayorista, margen_mayorista, pendiente_precio
  )
  select v_cuenta_id,
         case when v_cuenta_id is null then new.factura_id end,
         p.id,
         (select c.precio_costo from public.costos_producto c where c.producto_id = p.id),
         (select pp.costo from public.proveedor_producto pp
           where pp.proveedor_id = v_proveedor_id and pp.producto_id = p.id),
         p.precio_venta, p.margen, p.precio_mayorista, p.margen_mayorista, p.pendiente_precio
    from public.productos p
   where p.id = new.producto_id;

  return new;
end;
$$;

drop trigger if exists trg_factura_previos on public.items_factura_compra;
create trigger trg_factura_previos
  before insert on public.items_factura_compra
  for each row execute function public.fn_trg_factura_previos();

notify pgrst, 'reload schema';
