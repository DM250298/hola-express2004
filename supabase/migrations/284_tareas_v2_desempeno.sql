-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  284 · Tareas v2: Desempeño cuenta solo lo que corresponde          ║
-- ║  (Etapa 1 · bloque G)                                                ║
-- ║                                                                     ║
-- ║  fn_calcular_evaluacion(periodo, empleado) v3, misma firma. Único    ║
-- ║  cambio: el puntaje de tareas ya no cuenta "no se pudo", los         ║
-- ║  recordatorios ("todo el turno"), los bloques ni las privadas (antes ║
-- ║  los recordatorios quedaban vencidos y bajaban el puntaje).          ║
-- ║                                                                     ║
-- ║  Base: mig 158 (igual a producción el 2026-10-16). Requiere la 283.  ║
-- ║  Se puede correr de nuevo.                                           ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_calcular_evaluacion(
  p_periodo text,
  p_empleado_id integer default null
) returns table (
  empleado_id        integer,
  nombre             text,
  apellido           text,
  legajo             text,
  puesto             text,
  dias_esperados     integer,
  dias_presente      integer,
  tardanzas          integer,
  ausencias          integer,
  incompletos        integer,
  tareas_asignadas   integer,
  tareas_completadas integer,
  puntaje_asistencia numeric,
  puntaje_tareas     numeric,
  puntaje_manual     numeric,
  puntaje_total      numeric,
  comentario         text,
  evaluado_at        timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_desde date;
  v_hasta date;
  v_es_propio boolean;
  v_pen_tard  numeric := 10;
  v_pen_aus   numeric := 34;
  v_pen_inc   numeric := 15;
  v_pon_asis  numeric := 40;
  v_pon_tar   numeric := 40;
  v_pon_man   numeric := 20;
begin
  if p_periodo !~ '^\d{4}-\d{2}$' then
    raise exception 'Período inválido (se espera YYYY-MM): %', p_periodo;
  end if;

  -- Permiso: rrhh ve a todos; un empleado sólo SU propio legajo.
  v_es_propio := p_empleado_id is not null and exists (
    select 1 from public.empleados e
    where e.id = p_empleado_id and e.usuario_id = auth.uid()
  );
  if not public.fn_tiene_permiso('rrhh') and not v_es_propio then
    raise exception 'Sin permiso para ver evaluaciones de desempeño.';
  end if;

  v_desde := (p_periodo || '-01')::date;
  v_hasta := (v_desde + interval '1 month' - interval '1 day')::date;

  -- Parámetros (defaults defensivos si falta la clave).
  select coalesce((valor #>> '{}')::numeric, v_pen_tard) into v_pen_tard from public.rrhh_config where clave = 'eval_penal_tardanza';
  select coalesce((valor #>> '{}')::numeric, v_pen_aus)  into v_pen_aus  from public.rrhh_config where clave = 'eval_penal_ausencia';
  select coalesce((valor #>> '{}')::numeric, v_pen_inc)  into v_pen_inc  from public.rrhh_config where clave = 'eval_penal_incompleto';
  select coalesce((valor #>> '{}')::numeric, v_pon_asis) into v_pon_asis from public.rrhh_config where clave = 'eval_ponderacion_asistencia';
  select coalesce((valor #>> '{}')::numeric, v_pon_tar)  into v_pon_tar  from public.rrhh_config where clave = 'eval_ponderacion_tareas';
  select coalesce((valor #>> '{}')::numeric, v_pon_man)  into v_pon_man  from public.rrhh_config where clave = 'eval_ponderacion_manual';

  return query
  with emp as (
    select e.id, e.nombre, e.apellido, e.legajo, e.puesto
    from public.empleados e
    where e.activo = true
      and (p_empleado_id is null or e.id = p_empleado_id)
  ),
  asis as (
    select ad.empleado_id,
      count(*) filter (where ad.estado in ('presente','tardanza','ausente_injustificado','incompleto'))::int as dias_esperados,
      count(*) filter (where ad.estado = 'presente')::int               as dias_presente,
      count(*) filter (where ad.estado = 'tardanza')::int               as tardanzas,
      count(*) filter (where ad.estado = 'ausente_injustificado')::int  as ausencias,
      count(*) filter (where ad.estado = 'incompleto')::int             as incompletos
    from public.asistencia_diaria ad
    where ad.fecha between v_desde and v_hasta
    group by ad.empleado_id
  ),
  tar as (
    select x.empleado_id,
      sum(x.asig)::int as asignadas,
      sum(x.comp)::int as completadas
    from (
      -- individuales: sin canceladas, "no se pudo", recordatorios, bloques ni privadas
      select tt.empleado_id, 1 as asig, (tt.estado = 'completada')::int as comp
      from public.tareas_turno tt
      where tt.fecha between v_desde and v_hasta
        and tt.estado not in ('cancelada', 'no_se_pudo')
        and tt.tipo_actividad = 'puntual' and not tt.privada
        and tt.empleado_id is not null
      union all
      -- grupales completadas: 1/1 solo para quien la cerró
      select tt.completada_por, 1, 1
      from public.tareas_turno tt
      where tt.fecha between v_desde and v_hasta
        and tt.empleado_id is null
        and tt.estado = 'completada'
        and tt.tipo_actividad = 'puntual' and not tt.privada
        and tt.completada_por is not null
    ) x
    group by x.empleado_id
  ),
  calc as (
    select
      emp.id as empleado_id, emp.nombre, emp.apellido, emp.legajo, emp.puesto,
      coalesce(a.dias_esperados, 0)  as dias_esperados,
      coalesce(a.dias_presente, 0)   as dias_presente,
      coalesce(a.tardanzas, 0)       as tardanzas,
      coalesce(a.ausencias, 0)       as ausencias,
      coalesce(a.incompletos, 0)     as incompletos,
      coalesce(t.asignadas, 0)       as tareas_asignadas,
      coalesce(t.completadas, 0)     as tareas_completadas,
      -- Asistencia: null si no tuvo días con turno; si no, 100 menos penales.
      case when coalesce(a.dias_esperados, 0) = 0 then null
           else greatest(0, least(100,
                  100 - v_pen_tard * coalesce(a.tardanzas, 0)
                      - v_pen_aus  * coalesce(a.ausencias, 0)
                      - v_pen_inc  * coalesce(a.incompletos, 0)))
      end as p_asis,
      -- Tareas: null si no tenía tareas; si no, tasa de cumplimiento.
      case when coalesce(t.asignadas, 0) = 0 then null
           else round(coalesce(t.completadas, 0)::numeric / t.asignadas * 100, 2)
      end as p_tar,
      ev.puntaje_manual as p_man,
      ev.comentario,
      ev.updated_at as evaluado_at
    from emp
    left join asis a on a.empleado_id = emp.id
    left join tar  t on t.empleado_id = emp.id
    left join public.evaluacion_desempeno ev
      on ev.empleado_id = emp.id and ev.periodo = p_periodo
  )
  select
    calc.empleado_id, calc.nombre, calc.apellido, calc.legajo, calc.puesto,
    calc.dias_esperados, calc.dias_presente, calc.tardanzas, calc.ausencias, calc.incompletos,
    calc.tareas_asignadas, calc.tareas_completadas,
    calc.p_asis, calc.p_tar, calc.p_man,
    -- Total ponderado SÓLO sobre los componentes disponibles (peso del que
    -- falta se redistribuye al normalizar por la suma de pesos presentes).
    case
      when calc.p_asis is null and calc.p_tar is null and calc.p_man is null then null
      else round(
        ( coalesce(calc.p_asis * v_pon_asis, 0)
        + coalesce(calc.p_tar  * v_pon_tar,  0)
        + coalesce(calc.p_man  * v_pon_man,  0) )
        / nullif(
            (case when calc.p_asis is not null then v_pon_asis else 0 end)
          + (case when calc.p_tar  is not null then v_pon_tar  else 0 end)
          + (case when calc.p_man  is not null then v_pon_man  else 0 end)
        , 0)
      , 2)
    end as puntaje_total,
    calc.comentario, calc.evaluado_at
  from calc
  order by calc.nombre, calc.apellido;
end $$;

revoke execute on function public.fn_calcular_evaluacion(text, integer) from public, anon;
grant execute on function public.fn_calcular_evaluacion(text, integer) to authenticated;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'fn_calcular_evaluacion' and prosrc like '%no_se_pudo%') then
    raise exception '284: fn_calcular_evaluacion no quedó en la versión 3.';
  end if;
end $$;

notify pgrst, 'reload schema';
