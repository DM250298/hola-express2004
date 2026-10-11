-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 235 · fn_dashboard_disciplina (KPIs del tab "Hoy")       ║
-- ║                                                                     ║
-- ║  RPC hermana de fn_dashboard_rrhh (091): devuelve en un jsonb los   ║
-- ║  indicadores de incidencias y pase de turno para el tablero del hub ║
-- ║  Personal. Se dejó aparte para no re-emitir las ~170 líneas de      ║
-- ║  fn_dashboard_rrhh sin cambios; el cliente las une con Promise.all. ║
-- ║                                                                     ║
-- ║  Claves: incidencias_abiertas, reincidencias_30d, graves_30d,       ║
-- ║  incidencias_empleados_30d [{empleado_id,nombre,apellido,cantidad,  ║
-- ║  max_instancia}], pases_pendientes_recibir, pases_no_conformes_7d   ║
-- ║  [{pase_id,fecha,turno,saliente_empleado_id,nombre,apellido,        ║
-- ║  no_conformes}].                                                    ║
-- ║  Gate: 'rrhh'. REQUIERE: migs 230 y 233.                            ║
-- ║                                                                     ║
-- ║  TODO (fuera de alcance): si Dirección quiere que las incidencias   ║
-- ║  resten puntos en el desempeño, sembrar `eval_penal_incidencia` en  ║
-- ║  rrhh_config y re-emitir fn_calcular_evaluacion (091/158) restando  ║
-- ║  penal × incidencias del mes al componente de asistencia.           ║
-- ║  Ejecutar UNA sola vez. Primero PRUEBA, después PRODUCCIÓN.         ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_dashboard_disciplina()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_hoy date := (timezone('America/Argentina/Buenos_Aires', now()))::date;
  v_abiertas integer;
  v_reinc integer;
  v_graves integer;
  v_pend integer;
  v_por_emp jsonb;
  v_no_conf jsonb;
begin
  if not public.fn_tiene_permiso('rrhh') then
    raise exception 'Sin permiso para ver el tablero de personal.';
  end if;

  select count(*) into v_abiertas
  from public.incidencias where estado = 'abierta';

  select count(*) into v_reinc
  from public.incidencias
  where fecha between v_hoy - 30 and v_hoy
    and (instancia >= 2 or escalada);

  select count(*) into v_graves
  from public.incidencias
  where fecha between v_hoy - 30 and v_hoy and gravedad = 'grave';

  select coalesce(jsonb_agg(x order by x.cantidad desc, x.max_instancia desc), '[]'::jsonb)
  into v_por_emp
  from (
    select i.empleado_id, e.nombre, e.apellido,
           count(*)::int as cantidad,
           max(i.instancia)::int as max_instancia,
           bool_or(i.escalada) as escalada
    from public.incidencias i
    join public.empleados e on e.id = i.empleado_id
    where i.fecha between v_hoy - 30 and v_hoy
    group by i.empleado_id, e.nombre, e.apellido
  ) x;

  select count(*) into v_pend
  from public.pases_turno
  where estado = 'entregado'
    and entregado_at >= now() - interval '48 hours';

  select coalesce(jsonb_agg(y order by y.fecha desc), '[]'::jsonb)
  into v_no_conf
  from (
    select p.id as pase_id, p.fecha, t.nombre::text as turno,
           p.saliente_empleado_id, e.nombre, e.apellido,
           (
             (case when p.conforme_reposicion = false then 1 else 0 end) +
             (case when p.conforme_orden = false then 1 else 0 end) +
             (case when p.conforme_novedades = false then 1 else 0 end) +
             (case when p.conforme_pendientes = false then 1 else 0 end)
           )::int as no_conformes
    from public.pases_turno p
    join public.empleados e on e.id = p.saliente_empleado_id
    join public.turnos_plantilla t on t.id = p.turno_saliente_id
    where p.estado = 'recibido'
      and p.fecha between v_hoy - 7 and v_hoy
      and (p.conforme_reposicion = false or p.conforme_orden = false
           or p.conforme_novedades = false or p.conforme_pendientes = false)
  ) y;

  return jsonb_build_object(
    'incidencias_abiertas', v_abiertas,
    'reincidencias_30d', v_reinc,
    'graves_30d', v_graves,
    'incidencias_empleados_30d', v_por_emp,
    'pases_pendientes_recibir', v_pend,
    'pases_no_conformes_7d', v_no_conf
  );
end;
$$;

revoke execute on function public.fn_dashboard_disciplina() from public, anon;
grant execute on function public.fn_dashboard_disciplina() to authenticated;

notify pgrst, 'reload schema';

-- Chequeo T1 (debe dar 0 filas):
-- select proname, count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
-- where n.nspname='public' and proname like 'fn_%' group by proname having count(*)>1;
