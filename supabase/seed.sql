-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Hola! Express — Datos de prueba                                   ║
-- ║  Ejecutar DESPUÉS de schema.sql, en SQL Editor de Supabase         ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- Nota: los usuarios NO se crean acá — se crean desde Auth de Supabase.
-- Una vez creado tu usuario admin, ejecutá:
--   update public.usuarios set rol = 'admin' where email = 'tu@email.com';

-- ─── Categorías ────────────────────────────────────────────────────

insert into public.categorias (nombre, descripcion) values
  ('Bebidas',      'Gaseosas, jugos, aguas, energizantes'),
  ('Almacén',      'Productos de despensa básica'),
  ('Lácteos',      'Leches, yogures, quesos'),
  ('Snacks',       'Papas fritas, galletitas, golosinas'),
  ('Panadería',    'Pan, facturas, masas'),
  ('Limpieza',     'Detergentes, lavandina, esponjas'),
  ('Higiene',      'Jabones, shampoos, papel'),
  ('Cigarrillos',  'Tabaco y derivados')
on conflict (nombre) do nothing;

-- ─── Proveedores ──────────────────────────────────────────────────

insert into public.proveedores (nombre, telefono, email, dias_entrega, condicion_pago) values
  ('Distribuidora Norte SA',  '+54 380 4567890', 'ventas@distnorte.com.ar',  3, '30 días'),
  ('La Riojana Mayorista',    '+54 380 4234567', 'pedidos@lariojana.com',    2, '15 días'),
  ('Coca-Cola Andina',        '+54 11 5555 0001','b2b@cocacola.com.ar',      1, 'Contado'),
  ('Arcor Distribución',      '+54 11 4444 0002','arcor.distribuidora@arcor.com', 5, '60 días'),
  ('Pyme Local La Rioja',     '+54 380 4111111', null,                       1, 'Contado')
on conflict do nothing;

-- ─── Productos ────────────────────────────────────────────────────
-- Los IDs de categoría y proveedor se referencian por nombre via subquery.

insert into public.productos
  (codigo_barras, nombre, categoria_id, proveedor_id, precio_venta, precio_costo, stock_actual, stock_minimo)
values
  -- Bebidas
  ('7790895000010', 'Coca-Cola 500ml',
    (select id from public.categorias where nombre = 'Bebidas'),
    (select id from public.proveedores where nombre = 'Coca-Cola Andina'),
    1200, 700, 48, 12),
  ('7790895000027', 'Coca-Cola 1.5L',
    (select id from public.categorias where nombre = 'Bebidas'),
    (select id from public.proveedores where nombre = 'Coca-Cola Andina'),
    2800, 1700, 24, 8),
  ('7790895000034', 'Agua mineral Eco 500ml',
    (select id from public.categorias where nombre = 'Bebidas'),
    (select id from public.proveedores where nombre = 'Distribuidora Norte SA'),
    600, 280, 60, 20),
  ('7790895000041', 'Cerveza Quilmes 1L',
    (select id from public.categorias where nombre = 'Bebidas'),
    (select id from public.proveedores where nombre = 'Distribuidora Norte SA'),
    2500, 1450, 36, 12),
  ('7790895000058', 'Speed XL 250ml',
    (select id from public.categorias where nombre = 'Bebidas'),
    (select id from public.proveedores where nombre = 'Distribuidora Norte SA'),
    1900, 1100, 24, 10),

  -- Almacén
  ('7790070100016', 'Yerba Mate Playadito 500g',
    (select id from public.categorias where nombre = 'Almacén'),
    (select id from public.proveedores where nombre = 'Distribuidora Norte SA'),
    4200, 2700, 18, 6),
  ('7790070100023', 'Azúcar Ledesma 1kg',
    (select id from public.categorias where nombre = 'Almacén'),
    (select id from public.proveedores where nombre = 'La Riojana Mayorista'),
    1500, 950, 30, 10),
  ('7790070100030', 'Fideos Lucchetti 500g',
    (select id from public.categorias where nombre = 'Almacén'),
    (select id from public.proveedores where nombre = 'La Riojana Mayorista'),
    1100, 680, 4, 10),
  ('7790070100047', 'Arroz Gallo Oro 1kg',
    (select id from public.categorias where nombre = 'Almacén'),
    (select id from public.proveedores where nombre = 'La Riojana Mayorista'),
    1800, 1100, 22, 8),

  -- Lácteos
  ('7790030100014', 'Leche La Serenísima 1L',
    (select id from public.categorias where nombre = 'Lácteos'),
    (select id from public.proveedores where nombre = 'La Riojana Mayorista'),
    1200, 750, 24, 12),
  ('7790030100021', 'Yogurt Yogurísimo bebible 1L',
    (select id from public.categorias where nombre = 'Lácteos'),
    (select id from public.proveedores where nombre = 'La Riojana Mayorista'),
    1900, 1200, 12, 6),
  ('7790030100038', 'Queso cremoso La Paulina 500g',
    (select id from public.categorias where nombre = 'Lácteos'),
    (select id from public.proveedores where nombre = 'La Riojana Mayorista'),
    3500, 2200, 8, 5),

  -- Snacks
  ('7790580100018', 'Lays Clásicas 90g',
    (select id from public.categorias where nombre = 'Snacks'),
    (select id from public.proveedores where nombre = 'Arcor Distribución'),
    1500, 850, 40, 15),
  ('7790580100025', 'Doritos Original 80g',
    (select id from public.categorias where nombre = 'Snacks'),
    (select id from public.proveedores where nombre = 'Arcor Distribución'),
    1400, 820, 0, 15),
  ('7790580100032', 'Mantecol 180g',
    (select id from public.categorias where nombre = 'Snacks'),
    (select id from public.proveedores where nombre = 'Arcor Distribución'),
    2200, 1300, 18, 8),
  ('7790580100049', 'Oreo 117g',
    (select id from public.categorias where nombre = 'Snacks'),
    (select id from public.proveedores where nombre = 'Arcor Distribución'),
    1300, 750, 32, 12),

  -- Panadería
  (null, 'Pan flauta (unidad)',
    (select id from public.categorias where nombre = 'Panadería'),
    (select id from public.proveedores where nombre = 'Pyme Local La Rioja'),
    600, 250, 14, 10),
  (null, 'Medialunas (docena)',
    (select id from public.categorias where nombre = 'Panadería'),
    (select id from public.proveedores where nombre = 'Pyme Local La Rioja'),
    3500, 2000, 6, 4),

  -- Limpieza
  ('7790250100012', 'Detergente Magistral 750ml',
    (select id from public.categorias where nombre = 'Limpieza'),
    (select id from public.proveedores where nombre = 'Distribuidora Norte SA'),
    1800, 1100, 16, 6),
  ('7790250100029', 'Lavandina Ayudín 1L',
    (select id from public.categorias where nombre = 'Limpieza'),
    (select id from public.proveedores where nombre = 'Distribuidora Norte SA'),
    900, 520, 20, 10),

  -- Higiene
  ('7790310100015', 'Papel higiénico Higienol x4',
    (select id from public.categorias where nombre = 'Higiene'),
    (select id from public.proveedores where nombre = 'Distribuidora Norte SA'),
    2400, 1450, 14, 8),
  ('7790310100022', 'Shampoo Sedal 350ml',
    (select id from public.categorias where nombre = 'Higiene'),
    (select id from public.proveedores where nombre = 'Distribuidora Norte SA'),
    2900, 1750, 10, 5),

  -- Cigarrillos
  ('7790018100011', 'Marlboro Box 20',
    (select id from public.categorias where nombre = 'Cigarrillos'),
    (select id from public.proveedores where nombre = 'Distribuidora Norte SA'),
    3200, 2400, 25, 10),
  ('7790018100028', 'Philip Morris Box 20',
    (select id from public.categorias where nombre = 'Cigarrillos'),
    (select id from public.proveedores where nombre = 'Distribuidora Norte SA'),
    2900, 2100, 18, 10)
on conflict (codigo_barras) do nothing;

-- ─── Lotes con vencimiento (para probar el módulo de vencimientos) ──
-- Lácteos y panadería vencen pronto.

insert into public.lotes (producto_id, fecha_vencimiento, cantidad_inicial, cantidad_actual, estado)
select
  p.id,
  current_date + interval '2 days',  -- vence en 2 días → semáforo rojo
  12, 12, 'activo'
from public.productos p where p.nombre = 'Leche La Serenísima 1L'
on conflict do nothing;

insert into public.lotes (producto_id, fecha_vencimiento, cantidad_inicial, cantidad_actual, estado)
select
  p.id,
  current_date + interval '5 days',  -- vence en 5 días → amarillo
  12, 12, 'activo'
from public.productos p where p.nombre = 'Yogurt Yogurísimo bebible 1L'
on conflict do nothing;

insert into public.lotes (producto_id, fecha_vencimiento, cantidad_inicial, cantidad_actual, estado)
select
  p.id,
  current_date + interval '15 days', -- vence en 15 días → verde
  8, 8, 'activo'
from public.productos p where p.nombre = 'Queso cremoso La Paulina 500g'
on conflict do nothing;

insert into public.lotes (producto_id, fecha_vencimiento, cantidad_inicial, cantidad_actual, estado)
select
  p.id,
  current_date + interval '1 day',   -- vence mañana → rojo urgente
  14, 14, 'activo'
from public.productos p where p.nombre = 'Pan flauta (unidad)'
on conflict do nothing;

-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Seed listo. La app tiene:                                         ║
-- ║   · 8 categorías                                                   ║
-- ║   · 5 proveedores                                                  ║
-- ║   · 24 productos (incluye un par bajo stock mínimo y uno agotado)  ║
-- ║   · 4 lotes con vencimientos variados                              ║
-- ║                                                                    ║
-- ║  Las ventas, turnos y movimientos los va a generar la app al usar. ║
-- ╚════════════════════════════════════════════════════════════════════╝
