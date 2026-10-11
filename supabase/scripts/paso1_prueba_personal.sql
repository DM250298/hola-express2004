-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Script (NO migración) · Paso 1 en la base de PRUEBA: dejar el      ║
-- ║  módulo Personal listo para una semana de prueba operativa.         ║
-- ║                                                                     ║
-- ║  1. Vincular las cuentas de prueba (STAGING.md paso 7) a legajos:   ║
-- ║       encargado@pruebas.local → Sonia                               ║
-- ║       cajero@pruebas.local    → Camila                              ║
-- ║       fiambrero@pruebas.local → Agustín                             ║
-- ║       empleado@pruebas.local  → Tomás                               ║
-- ║     (así cada rol puede entrar y ver Mi panel, Mis tareas y el pase)║
-- ║  2. Fabricio con rol operativo Cajero.                              ║
-- ║  3. Crear a Rodrigo y Damián (Dirección) si no existen, y colgar a  ║
-- ║     Sonia de Rodrigo.                                               ║
-- ║  4. Permisos: cajero y fiambrero dejan de tener 'rrhh' (con él      ║
-- ║     podían registrar incidencias y ver todo Personal) y pasan a     ║
-- ║     'mi_panel'. admin ya tiene 'rrhh_sanciones' (mig 232).          ║
-- ║  Idempotente. Solo para PRUEBA: en producción las cuentas son las   ║
-- ║  reales y se vinculan desde la ficha (Editar › Cuenta de login).    ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function pg_temp.fn_emp(p_nombre text) returns integer
language sql as $$
  select min(id) from public.empleados
  where activo
    and lower(translate(split_part(trim(nombre), ' ', 1), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))
        = lower(translate(p_nombre, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))
  having count(*) = 1
$$;

do $$
declare v_u uuid; v_e integer; v_rod integer; v_dam integer; v_son integer;
begin
  -- 1. Cuentas de prueba → legajos
  for v_u, v_e in
    select u.id, pg_temp.fn_emp(m.nombre)
    from (values ('encargado@pruebas.local', 'Sonia'),
                 ('cajero@pruebas.local',    'Camila'),
                 ('fiambrero@pruebas.local', 'Agustin'),
                 ('empleado@pruebas.local',  'Tomas')) m(email, nombre)
    join public.usuarios u on u.email = m.email
  loop
    if v_e is null then continue; end if;
    -- un usuario solo puede estar vinculado a un legajo: liberar el anterior
    update public.empleados set usuario_id = null where usuario_id = v_u and id <> v_e;
    update public.empleados set usuario_id = v_u, updated_at = now() where id = v_e;
  end loop;

  -- 2. Fabricio → cajero
  update public.empleados set rol_operativo = 'cajero', updated_at = now()
  where id = pg_temp.fn_emp('Fabricio');

  -- 3. Dirección
  v_rod := pg_temp.fn_emp('Rodrigo');
  if v_rod is null then
    insert into public.empleados (nombre, puesto, rol_operativo, unidad_negocio)
    values ('Rodrigo', 'Dirección', 'direccion', 'hola_express') returning id into v_rod;
  end if;
  v_dam := pg_temp.fn_emp('Damian');
  if v_dam is null then
    insert into public.empleados (nombre, puesto, rol_operativo, unidad_negocio)
    values ('Damián', 'Dirección', 'direccion', 'hola_express') returning id into v_dam;
  end if;
  v_son := pg_temp.fn_emp('Sonia');
  if v_son is not null then
    update public.empleados set reporta_a = v_rod, updated_at = now() where id = v_son;
  end if;

  -- 4. Permisos de cajero y fiambrero
  update public.roles
  set permisos = array_append(array_remove(permisos, 'rrhh'), 'mi_panel'),
      updated_at = now()
  where codigo in ('cajero', 'fiambrero')
    and ('rrhh' = any(permisos) or not ('mi_panel' = any(permisos)));
  -- sin duplicados
  update public.roles set permisos = (select array_agg(distinct p) from unnest(permisos) p)
  where codigo in ('cajero', 'fiambrero');
end $$;

drop function if exists pg_temp.fn_emp(text);

-- Verificación
select e.nombre, e.rol_operativo, j.nombre as reporta_a, u.email as cuenta
from public.empleados e
left join public.empleados j on j.id = e.reporta_a
left join public.usuarios u on u.id = e.usuario_id
where e.activo
order by e.rol_operativo, e.nombre;

select codigo, permisos from public.roles where codigo in ('admin','encargado','cajero','fiambrero','empleado') order by codigo;
