-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 254 · Organigrama real (oct-2026): puestos y reportes    ║
-- ║                                                                     ║
-- ║  Datos, idempotente. Reemplaza la seed por primer nombre (mig 242): ║
-- ║  ahora se matchea por NOMBRE + APELLIDO sin acentos; si hay 0 o     ║
-- ║  varias coincidencias se saltea con NOTICE, nunca adivina.          ║
-- ║                                                                     ║
-- ║  Puestos (valores internos sin cambios; las etiquetas nuevas van en ║
-- ║  components/rrhh/constantes.ts):                                    ║
-- ║   responsable_general = Encargada de Sucursal · Sonia Saquilan      ║
-- ║   encargado           = Encargado/a de Turno  · Rebeca Fajardo      ║
-- ║   cajero              · Camila Gramajo, Juan Ignacio, Fabricio Oliva║
-- ║   fiambreria          = Fiambrero/Producción · Tomas Cejas,         ║
-- ║                         Agustin Agüero                              ║
-- ║   pivote              = Pivot · Matias Mercado                      ║
-- ║   compras             · Fernanda Lucero                             ║
-- ║  Reporta a: todos a Sonia, salvo Sonia y Fernanda → Dirección       ║
-- ║  (Rodrigo). Si Rodrigo no existe quedan como raíz y se avisa.       ║
-- ║  Correr en PRUEBA y después en PRODUCCIÓN.                          ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function pg_temp.fn_norm(p text) returns text language sql immutable as $$
  select lower(translate(trim(coalesce(p, '')), 'áéíóúÁÉÍÓÚüÜñÑ', 'aeiouAEIOUuUnN'))
$$;

-- Empleado activo por nombre (prefijo: "Juan" matchea "Juan Ignacio") y apellido.
-- Si el apellido está vacío en la ficha, exige que el nombre completo coincida.
create or replace function pg_temp.fn_emp(p_nombre text, p_apellido text) returns integer
language plpgsql as $$
declare v_n integer; v_id integer;
begin
  select count(*), min(id) into v_n, v_id
  from public.empleados e
  where e.activo
    and (
      (coalesce(e.apellido, '') <> ''
        and pg_temp.fn_norm(e.apellido) = pg_temp.fn_norm(p_apellido)
        and (pg_temp.fn_norm(e.nombre) = pg_temp.fn_norm(p_nombre)
             or pg_temp.fn_norm(e.nombre) like pg_temp.fn_norm(p_nombre) || ' %'
             or pg_temp.fn_norm(p_nombre) like pg_temp.fn_norm(e.nombre) || ' %'))
      or (coalesce(e.apellido, '') = ''
        and pg_temp.fn_norm(e.nombre) in (pg_temp.fn_norm(p_nombre),
                                          pg_temp.fn_norm(p_nombre || ' ' || p_apellido)))
    );
  if v_n = 1 then return v_id; end if;
  if v_n = 0 then
    raise notice 'Organigrama: no hay empleado activo "% %": se saltea.', p_nombre, p_apellido;
  else
    raise notice 'Organigrama: hay % empleados activos "% %": se saltea.', v_n, p_nombre, p_apellido;
  end if;
  return null;
end $$;

do $$
declare
  -- [nombre, apellido, rol_operativo, puesto (solo si está vacío)]
  v_filas text[][] := array[
    ['Sonia',        'Saquilan', 'responsable_general', 'Encargada de Sucursal'],
    ['Rebeca',       'Fajardo',  'encargado',           'Encargada de Turno'],
    ['Camila',       'Gramajo',  'cajero',              'Cajera'],
    ['Juan Ignacio', '',         'cajero',              'Cajero'],
    ['Fabricio',     'Oliva',    'cajero',              'Cajero'],
    ['Tomas',        'Cejas',    'fiambreria',          'Fiambrero / producción'],
    ['Agustin',      'Aguero',   'fiambreria',          'Fiambrero / producción'],
    ['Matias',       'Mercado',  'pivote',              'Pivot'],
    ['Fernanda',     'Lucero',   'compras',             'Compras']
  ];
  v_i integer; v_id integer; v_ok integer := 0;
  v_sonia integer; v_fernanda integer; v_rodrigo integer;
begin
  -- 1. Puestos.
  for v_i in 1 .. array_length(v_filas, 1) loop
    -- "Juan Ignacio" no tiene apellido en la lista: se busca por nombre completo
    -- o por nombre "Juan Ignacio" con cualquier apellido (debe ser único).
    if v_filas[v_i][2] = '' then
      select case when count(*) = 1 then min(id) end into v_id
      from public.empleados e
      where e.activo and pg_temp.fn_norm(e.nombre) = pg_temp.fn_norm(v_filas[v_i][1]);
      if v_id is null then
        raise notice 'Organigrama: "%" no es único o no existe: se saltea.', v_filas[v_i][1];
      end if;
    else
      v_id := pg_temp.fn_emp(v_filas[v_i][1], v_filas[v_i][2]);
    end if;
    if v_id is not null then
      update public.empleados
        set rol_operativo = v_filas[v_i][3],
            puesto = case when coalesce(puesto, '') = '' then v_filas[v_i][4] else puesto end
        where id = v_id;
      v_ok := v_ok + 1;
    end if;
  end loop;

  -- 2. Reportes.
  v_sonia := pg_temp.fn_emp('Sonia', 'Saquilan');
  v_fernanda := pg_temp.fn_emp('Fernanda', 'Lucero');
  select case when count(*) = 1 then min(id) end into v_rodrigo
  from public.empleados where activo and rol_operativo = 'direccion'
    and pg_temp.fn_norm(nombre) like 'rodrigo%';
  if v_rodrigo is null then
    raise notice 'Organigrama: no encontré a Rodrigo (direccion): Sonia y Fernanda quedan como raíz.';
  end if;

  if v_sonia is not null then
    update public.empleados set reporta_a = v_rodrigo where id = v_sonia;
    -- Todos los demás del organigrama reportan a Sonia (menos Dirección y Fernanda).
    update public.empleados e
      set reporta_a = v_sonia
      where e.activo and e.id <> v_sonia
        and e.rol_operativo in ('encargado', 'pivote', 'cajero', 'fiambreria')
        and (e.reporta_a is distinct from v_sonia);
  else
    raise notice 'Organigrama: sin Sonia no se tocan los reportes.';
  end if;
  if v_fernanda is not null then
    update public.empleados set reporta_a = v_rodrigo where id = v_fernanda;
  end if;

  raise notice 'Organigrama 2026-10: % de % puestos asignados.', v_ok, array_length(v_filas, 1);
end $$;

notify pgrst, 'reload schema';

-- Verificación (correr después, debe mostrar los 9 con su puesto y jefe):
-- select e.nombre, e.apellido, e.rol_operativo, j.nombre as reporta_a
--   from public.empleados e left join public.empleados j on j.id = e.reporta_a
--  where e.activo order by e.rol_operativo, e.nombre;
