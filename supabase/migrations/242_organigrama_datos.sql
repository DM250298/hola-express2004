-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 242 · Datos: organigrama y cadena de mando               ║
-- ║                                                                     ║
-- ║  Carga rol_operativo y reporta_a (mig 229) según la planilla        ║
-- ║  "Organigrama y cadena de mando" (Manual §3):                       ║
-- ║   1 Dirección ............ Rodrigo, Damián .......... (raíz)        ║
-- ║   2 Resp. Operativa Gral.  Sonia .................... → Rodrigo     ║
-- ║   3 Encargada turno tarde  Rebeca ................... → Sonia       ║
-- ║   3 Cobertura / pivote ... Matías ................... → Sonia       ║
-- ║   4 Cajera mañana ........ Camila ................... → Sonia       ║
-- ║   4 Fiambrería mañana .... Agustín .................. → Sonia       ║
-- ║   4 Fiambrería tarde ..... Tomás .................... → Rebeca      ║
-- ║   4 Cajero noche ......... Fabricio, Juan Ignacio ... → Sonia       ║
-- ║  (El pivote y el turno mañana/noche no tienen encargado propio:     ║
-- ║  reportan a la Resp. Operativa General.)                            ║
-- ║                                                                     ║
-- ║  Los empleados se buscan por primer nombre (sin tildes ni           ║
-- ║  mayúsculas) entre los activos. Si un nombre no existe o está       ║
-- ║  repetido, se SALTEA con un aviso y sigue con los demás: cargá el   ║
-- ║  legajo y volvé a correrla (idempotente, solo actualiza).           ║
-- ║  El `puesto` se completa solo si estaba vacío.                      ║
-- ║  REQUIERE: mig 229. Primero PRUEBA, después PRODUCCIÓN.             ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function pg_temp.fn_emp_por_nombre(p_nombre text) returns integer
language plpgsql as $$
declare v_n integer; v_id integer;
begin
  select count(*), min(id) into v_n, v_id
  from public.empleados
  where activo
    and lower(translate(split_part(trim(nombre), ' ', 1), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))
        = lower(translate(split_part(trim(p_nombre), ' ', 1), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'));
  if v_n = 1 then return v_id; end if;
  if v_n = 0 then raise notice 'Organigrama: no hay empleado activo llamado "%": se saltea.', p_nombre;
  else raise notice 'Organigrama: hay % empleados activos llamados "%": se saltea.', v_n, p_nombre; end if;
  return null;
end $$;

do $$
declare
  -- [nombre, rol_operativo, reporta_a (nombre o null), puesto]
  v_filas text[][] := array[
    ['Rodrigo',      'direccion',           null,      'Dirección'],
    ['Damián',       'direccion',           null,      'Dirección'],
    ['Sonia',        'responsable_general', 'Rodrigo', 'Responsable Operativa General'],
    ['Rebeca',       'encargado',           'Sonia',   'Encargada turno tarde'],
    ['Matías',       'pivote',              'Sonia',   'Cobertura / pivote'],
    ['Camila',       'cajero',              'Sonia',   'Cajera mañana'],
    ['Agustín',      'fiambreria',          'Sonia',   'Fiambrería / producción mañana'],
    ['Tomás',        'fiambreria',          'Rebeca',  'Fiambrería tarde'],
    ['Fabricio',     'cajero',              'Sonia',   'Cajero noche'],
    ['Juan Ignacio', 'cajero',              'Sonia',   'Cajero noche']
  ];
  v_i integer;
  v_id integer;
  v_jefe integer;
  v_ok integer := 0;
begin
  -- Primera pasada: roles (así los jefes existen aunque vengan después).
  for v_i in 1..array_length(v_filas, 1) loop
    v_id := pg_temp.fn_emp_por_nombre(v_filas[v_i][1]);
    if v_id is null then continue; end if;
    update public.empleados
    set rol_operativo = v_filas[v_i][2],
        puesto = coalesce(nullif(trim(puesto), ''), v_filas[v_i][4]),
        updated_at = now()
    where id = v_id;
    v_ok := v_ok + 1;
  end loop;

  -- Segunda pasada: reporta_a.
  for v_i in 1..array_length(v_filas, 1) loop
    v_id := pg_temp.fn_emp_por_nombre(v_filas[v_i][1]);
    if v_id is null then continue; end if;
    if v_filas[v_i][3] is null then
      v_jefe := null;
    else
      v_jefe := pg_temp.fn_emp_por_nombre(v_filas[v_i][3]);
      if v_jefe is null then
        raise notice 'Organigrama: % queda sin jefe porque "%" no existe.', v_filas[v_i][1], v_filas[v_i][3];
      end if;
    end if;
    update public.empleados set reporta_a = v_jefe, updated_at = now() where id = v_id;
  end loop;

  raise notice 'Organigrama: % de % personas actualizadas.', v_ok, array_length(v_filas, 1);
end $$;

drop function if exists pg_temp.fn_emp_por_nombre(text);

notify pgrst, 'reload schema';

-- Verificación:
--   select e.nombre, e.rol_operativo, j.nombre as reporta_a
--   from public.empleados e left join public.empleados j on j.id = e.reporta_a
--   where e.activo order by e.rol_operativo, e.nombre;
