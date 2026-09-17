-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 200 · Carga del local real (planta base, estado actual)  ║
-- ║                                                                     ║
-- ║  Fuente: "HOLA Express · Mapeo comercial y operativo · Estado       ║
-- ║  actual". Orden de caja hacia el fondo.                             ║
-- ║                                                                     ║
-- ║   Salón ........ GM-01 (10 divisores) · GI-01 isla (2 punteras +    ║
-- ║                  3 módulos por cara) · IMP-01 · LIM-G01 · LIM-G02   ║
-- ║   Línea de frío  FRZ-01 · HEL-01 … HEL-14                           ║
-- ║   Congelados ... FRZ-02 · FRZ-03 · FRZ-04                           ║
-- ║   Fiambrería ... mostrador · estantes de apoyo                      ║
-- ║   Depósito ..... 3 estanterías · mesa                               ║
-- ║   (Caja, baño y oficinas no guardan productos: no se cargan.)       ║
-- ║                                                                     ║
-- ║  Idempotente por `codigo`: correrla dos veces no duplica nada.      ║
-- ║  Lo que ya existía y no está en el documento (pruebas, góndolas     ║
-- ║  creadas desde el texto viejo productos.ubicacion) queda INACTIVO;  ║
-- ║  no se borra y sus productos siguen asignados hasta re-ubicarlos.   ║
-- ║                                                                     ║
-- ║  Categoría y marca se buscan por nombre en tus tablas. Si no hay    ║
-- ║  UNA coincidencia clara quedan vacías: el select final las lista    ║
-- ║  para completarlas desde el Mapa del local.                         ║
-- ║  REQUIERE: migs 170 y 199. Ejecutar UNA sola vez, COMPLETO.         ║
-- ╚════════════════════════════════════════════════════════════════════╝

drop table if exists pg_temp._seed_ubic;
create temp table _seed_ubic (
  codigo text primary key, cat_buscada text, marca_buscada text
);

-- Busca por patrón ilike (usar _ en letras con tilde); solo si hay UNA.
create or replace function pg_temp.buscar_id(p_tabla text, p_patron text)
returns integer language plpgsql as $$
declare v_ids integer[];
begin
  if p_patron is null then return null; end if;
  execute format('select array_agg(id) from public.%I where nombre ilike $1', p_tabla)
    into v_ids using p_patron;
  if cardinality(v_ids) = 1 then return v_ids[1]; end if;
  return null;
end $$;

create or replace function pg_temp.ubic(
  p_codigo text, p_padre text, p_tipo text, p_nombre text, p_orden int,
  p_mueble text default null, p_cat text default null, p_marca text default null
) returns void language plpgsql as $$
declare
  v_padre integer := (select id from public.ubicaciones where codigo = p_padre);
  v_cat integer := pg_temp.buscar_id('categorias', p_cat);
  v_marca integer := pg_temp.buscar_id('marcas', p_marca);
begin
  insert into pg_temp._seed_ubic values (p_codigo, p_cat, p_marca)
  on conflict (codigo) do nothing;
  if exists (select 1 from public.ubicaciones where codigo = p_codigo) then
    update public.ubicaciones
    set parent_id = v_padre, tipo = p_tipo, nombre = p_nombre, orden = p_orden,
        tipo_mueble = p_mueble, activo = true,
        categoria_id = coalesce(categoria_id, v_cat),
        marca_exclusiva_id = coalesce(marca_exclusiva_id, v_marca),
        updated_at = now()
    where codigo = p_codigo;
  else
    insert into public.ubicaciones
      (parent_id, tipo, nombre, codigo, orden, tipo_mueble, categoria_id, marca_exclusiva_id)
    values (v_padre, p_tipo, p_nombre, p_codigo, p_orden, p_mueble, v_cat, v_marca);
  end if;
end $$;

-- ─── Raíz y sectores existentes: se reutilizan poniéndoles código ────
update public.ubicaciones set codigo = 'CASA'
where id = (select min(id) from public.ubicaciones where tipo = 'sucursal')
  and codigo is null
  and not exists (select 1 from public.ubicaciones where codigo = 'CASA');
update public.ubicaciones set codigo = 'SAL'
where id = (select min(id) from public.ubicaciones where tipo = 'sector' and nombre ilike 'sal_n')
  and codigo is null
  and not exists (select 1 from public.ubicaciones where codigo = 'SAL');
update public.ubicaciones set codigo = 'DEP-01'
where id = (select min(id) from public.ubicaciones where tipo = 'sector' and nombre ilike 'dep_sito')
  and codigo is null
  and not exists (select 1 from public.ubicaciones where codigo = 'DEP-01');

select pg_temp.ubic('CASA',   null,   'sucursal', 'Casa Central', 0);
select pg_temp.ubic('SAL',    'CASA', 'sector', 'Salón', 1);
select pg_temp.ubic('FRIO',   'CASA', 'sector', 'Línea de frío', 2);
select pg_temp.ubic('CON-01', 'CASA', 'sector', 'Congelados', 3);
select pg_temp.ubic('FIAM-01','CASA', 'sector', 'Fiambrería', 4);
select pg_temp.ubic('DEP-01', 'CASA', 'sector', 'Depósito', 5);

-- ─── Salón ───────────────────────────────────────────────────────────
select pg_temp.ubic('GM-01', 'SAL', 'gondola', 'GM-01 · Góndola mural', 1, 'gondola');
select pg_temp.ubic('GM-01-D01', 'GM-01', 'estante', '01 · Parafernalia', 1, null, 'parafernalia');
select pg_temp.ubic('GM-01-D02', 'GM-01', 'estante', '02 · Kiosco / artículos chicos', 2, null, 'kiosco');
select pg_temp.ubic('GM-01-D03', 'GM-01', 'estante', '03 · Librería', 3, null, 'librer_a');
select pg_temp.ubic('GM-01-D04', 'GM-01', 'estante', '04 · Bebidas alcohólicas', 4, null, '%alcoh_lic%');
select pg_temp.ubic('GM-01-D05', 'GM-01', 'estante', '05 · Cuidado personal', 5, null, '%cuidado personal%');
select pg_temp.ubic('GM-01-D06', 'GM-01', 'estante', '06 · Galletas dulces', 6, null, 'galletas dulces');
select pg_temp.ubic('GM-01-D07', 'GM-01', 'estante', '07 · Galletas saladas', 7, null, 'galletas saladas');
select pg_temp.ubic('GM-01-D08', 'GM-01', 'estante', '08 · Panificados', 8, null, 'panificados');
select pg_temp.ubic('GM-01-D09', 'GM-01', 'estante', '09 · Harinas y premezclas', 9, null, '%harina%');
select pg_temp.ubic('GM-01-D10', 'GM-01', 'estante', '10 · Limpieza', 10, null, 'limpieza');

select pg_temp.ubic('GI-01', 'SAL', 'gondola', 'GI-01 · Isla central', 2, 'isla');
select pg_temp.ubic('GI-01-PC', 'GI-01', 'estante', 'Puntera caja · Promos Coca-Cola', 1, null, null, 'coca%cola');
select pg_temp.ubic('GI-01-A1', 'GI-01', 'estante', 'Cara A · Módulo 1', 2, null, 'almac_n');
select pg_temp.ubic('GI-01-A2', 'GI-01', 'estante', 'Cara A · Módulo 2', 3, null, 'almac_n');
select pg_temp.ubic('GI-01-A3', 'GI-01', 'estante', 'Cara A · Módulo 3', 4, null, 'almac_n');
select pg_temp.ubic('GI-01-B1', 'GI-01', 'estante', 'Cara B · Módulo 1 · Snacks', 5, null, 'snacks');
select pg_temp.ubic('GI-01-B2', 'GI-01', 'estante', 'Cara B · Módulo 2', 6, null, 'almac_n');
select pg_temp.ubic('GI-01-B3', 'GI-01', 'estante', 'Cara B · Módulo 3', 7, null, 'almac_n');
select pg_temp.ubic('GI-01-PF', 'GI-01', 'estante', 'Puntera fondo · Condimentos', 8, null, 'condimentos');

select pg_temp.ubic('IMP-01', 'SAL', 'gondola', 'IMP-01 · Impulso de caja', 0, 'exhibidor', 'golosinas');
select pg_temp.ubic('LIM-G01', 'SAL', 'gondola', 'LIM-G01 · Limpieza 1', 3, 'gondola', 'limpieza');
select pg_temp.ubic('LIM-G02', 'SAL', 'gondola', 'LIM-G02 · Limpieza 2', 4, 'gondola', 'limpieza');

-- ─── Línea de frío ───────────────────────────────────────────────────
select pg_temp.ubic('FRZ-01', 'FRIO', 'gondola', 'FRZ-01 · Helados Frigor', 0, 'freezer', 'helados', 'frigor');
select pg_temp.ubic('HEL-01', 'FRIO', 'gondola', 'HEL-01 · Red Bull', 1, 'heladera', '%energ%', 'red bull');
select pg_temp.ubic('HEL-02', 'FRIO', 'gondola', 'HEL-02 · Monster', 2, 'heladera', '%energ%', 'monster');
select pg_temp.ubic('HEL-03', 'FRIO', 'gondola', 'HEL-03 · Cervezas 1', 3, 'heladera', 'cervezas');
select pg_temp.ubic('HEL-04', 'FRIO', 'gondola', 'HEL-04 · Cervezas 2', 4, 'heladera', 'cervezas');
select pg_temp.ubic('HEL-05', 'FRIO', 'gondola', 'HEL-05 · Coca-Cola 1', 5, 'heladera', 'gaseosas', 'coca%cola');
select pg_temp.ubic('HEL-06', 'FRIO', 'gondola', 'HEL-06 · Coca-Cola 2', 6, 'heladera', 'gaseosas', 'coca%cola');
select pg_temp.ubic('HEL-07', 'FRIO', 'gondola', 'HEL-07 · Pepsi 1', 7, 'heladera', 'gaseosas', 'pepsi');
select pg_temp.ubic('HEL-08', 'FRIO', 'gondola', 'HEL-08 · Pepsi 2', 8, 'heladera', 'gaseosas', 'pepsi');
select pg_temp.ubic('HEL-09', 'FRIO', 'gondola', 'HEL-09 · Pritty', 9, 'heladera', 'gaseosas', 'pritty');
select pg_temp.ubic('HEL-10', 'FRIO', 'gondola', 'HEL-10 · Secco', 10, 'heladera', 'gaseosas', 'secco');
select pg_temp.ubic('HEL-11', 'FRIO', 'gondola', 'HEL-11 · Aguas y jugos', 11, 'heladera', '%agua%');
select pg_temp.ubic('HEL-12', 'FRIO', 'gondola', 'HEL-12 · Gaseosas + Manaos', 12, 'heladera', 'gaseosas');
select pg_temp.ubic('HEL-13', 'FRIO', 'gondola', 'HEL-13 · Lácteos', 13, 'heladera', 'l_cteos');
select pg_temp.ubic('HEL-14', 'FRIO', 'gondola', 'HEL-14 · Verdulería', 14, 'heladera', 'verduler_a');

-- ─── Congelados, fiambrería y depósito ───────────────────────────────
select pg_temp.ubic('FRZ-02', 'CON-01', 'gondola', 'FRZ-02 · Congelados 1', 1, 'freezer', 'congelados');
select pg_temp.ubic('FRZ-03', 'CON-01', 'gondola', 'FRZ-03 · Congelados 2', 2, 'freezer', 'congelados');
select pg_temp.ubic('FRZ-04', 'CON-01', 'gondola', 'FRZ-04 · Helados Arcor', 3, 'freezer', 'helados', 'arcor');
select pg_temp.ubic('FIAM-01-MOS', 'FIAM-01', 'gondola', 'Mostrador de fiambrería', 1, 'mostrador', '%fiambre%');
select pg_temp.ubic('FIAM-01-EST', 'FIAM-01', 'gondola', 'Estantes de apoyo', 2, 'estanteria', 'panificados');
select pg_temp.ubic('DEP-01-E1', 'DEP-01', 'gondola', 'Estantería 1', 1, 'estanteria');
select pg_temp.ubic('DEP-01-E2', 'DEP-01', 'gondola', 'Estantería 2', 2, 'estanteria');
select pg_temp.ubic('DEP-01-E3', 'DEP-01', 'gondola', 'Estantería 3', 3, 'estanteria');
select pg_temp.ubic('DEP-01-MESA', 'DEP-01', 'gondola', 'Mesa de apoyo', 4, 'mesa');

-- ─── Lo que no está en el documento queda inactivo ───────────────────
update public.ubicaciones u
set activo = false, updated_at = now()
where u.activo
  and not exists (select 1 from pg_temp._seed_ubic s where s.codigo = u.codigo);

notify pgrst, 'reload schema';

-- Verificación: qué quedó sin categoría o marca (completar desde el mapa).
select u.codigo, u.nombre,
       case when s.cat_buscada is not null and u.categoria_id is null
            then 'falta categoría' end as categoria,
       case when s.marca_buscada is not null and u.marca_exclusiva_id is null
            then 'falta marca' end as marca
from public.ubicaciones u
join pg_temp._seed_ubic s on s.codigo = u.codigo
where (s.cat_buscada is not null and u.categoria_id is null)
   or (s.marca_buscada is not null and u.marca_exclusiva_id is null)
order by u.codigo;
