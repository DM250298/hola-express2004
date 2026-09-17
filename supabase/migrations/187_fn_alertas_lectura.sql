-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 187 · Alertas (Fase F, 5/7): lectura                     ║
-- ║                                                                     ║
-- ║  1. fn_alertas(p_dias_resueltas): la lista para /alertas — vivas    ║
-- ║     (abierta, en_curso, pospuesta) + resueltas de los últimos N     ║
-- ║     días, con la tarea y quién decidió (la trazabilidad completa).  ║
-- ║  2. fn_resumen_alertas(): conteos y grupos, liviano, para el        ║
-- ║     tablero del dueño y el menú.                                    ║
-- ║                                                                     ║
-- ║  Gates: exigen 'alertas'. Sin 'costos': el detalle pierde valor,    ║
-- ║  exceso_valor, costo_actual y margen_pct; impacto viene NULL en     ║
-- ║  las reglas que lo calculan a costo; y margen_bajo no aparece.      ║
-- ║                                                                     ║
-- ║  ORDER BY determinístico para traerTodo().                          ║
-- ║  REQUIERE: mig 183. Ejecutar UNA sola vez, COMPLETO.                ║
-- ╚════════════════════════════════════════════════════════════════════╝

drop function if exists public.fn_alertas(integer);

create function public.fn_alertas(p_dias_resueltas integer default 30)
returns table (
  id bigint,
  regla_codigo text,
  regla_nombre text,
  severidad text,
  entidad_tipo text,
  entidad_id integer,
  producto_id integer,
  grupo text,
  titulo text,
  detalle jsonb,
  impacto numeric,
  estado text,
  detectada_at timestamptz,
  ultima_deteccion_at timestamptz,
  decision text,
  decidida_por_nombre text,
  decidida_at timestamptz,
  nota_decision text,
  pospuesta_hasta date,
  tarea_id integer,
  tarea_titulo text,
  tarea_estado text,
  tarea_responsable text,
  tarea_fecha_limite date,
  tarea_completada_at timestamptz,
  resuelta_at timestamptz,
  resolucion text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_costos boolean := public.fn_tiene_permiso('costos');
begin
  if not public.fn_tiene_permiso('alertas') then
    raise exception 'No tenés permiso para ver las alertas.';
  end if;

  return query
  select
    a.id,
    a.regla_codigo,
    r.nombre,
    a.severidad,
    a.entidad_tipo,
    a.entidad_id,
    a.producto_id,
    a.grupo,
    a.titulo,
    case when v_costos then a.detalle
         else a.detalle - array['valor', 'exceso_valor', 'costo_actual', 'margen_pct'] end,
    case when v_costos or a.regla_codigo not in ('inmovilizado', 'sobrestock', 'vencimiento_proximo')
         then a.impacto end,
    a.estado,
    a.detectada_at,
    a.ultima_deteccion_at,
    a.decision,
    ud.nombre::text,
    a.decidida_at,
    a.nota_decision,
    a.pospuesta_hasta,
    a.tarea_id,
    t.titulo,
    t.estado,
    ur.nombre::text,
    t.fecha_limite,
    t.completada_at,
    a.resuelta_at,
    a.resolucion
  from public.alertas a
  join public.reglas_alerta r on r.codigo = a.regla_codigo
  left join public.usuarios ud on ud.id = a.decidida_por
  left join public.tareas t on t.id = a.tarea_id
  left join public.usuarios ur on ur.id = t.responsable_id
  where (a.estado <> 'resuelta'
         or a.resuelta_at >= now() - make_interval(days => greatest(coalesce(p_dias_resueltas, 0), 0)))
    and (v_costos or a.regla_codigo <> 'margen_bajo')
  order by
    case a.severidad when 'critico' then 1 when 'atencion' then 2
                     when 'oportunidad' then 3 else 4 end,
    r.orden,
    a.grupo nulls last,
    -- mismo enmascarado que la columna: sin 'costos' no se ordena por costo
    case when v_costos or a.regla_codigo not in ('inmovilizado', 'sobrestock', 'vencimiento_proximo')
         then a.impacto end desc nulls last,
    a.id;
end;
$$;

revoke execute on function public.fn_alertas(integer) from public, anon;
grant execute on function public.fn_alertas(integer) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 2. fn_resumen_alertas → jsonb
--    { ultima_evaluacion, abiertas: {critico, atencion, oportunidad,
--      informativo}, en_curso, pospuestas,
--      reglas: [{regla_codigo, regla, severidad, abiertas, en_curso,
--                grupos: [{grupo, cantidad}] (top 3 de las abiertas)}] }
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.fn_resumen_alertas();

create function public.fn_resumen_alertas()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_costos boolean := public.fn_tiene_permiso('costos');
  v_resultado jsonb;
begin
  if not public.fn_tiene_permiso('alertas') then
    raise exception 'No tenés permiso para ver las alertas.';
  end if;

  with vivas as (
    select a.*
    from public.alertas a
    where a.estado <> 'resuelta'
      and (v_costos or a.regla_codigo <> 'margen_bajo')
  ),
  por_regla as (
    select r.codigo, r.nombre, r.severidad as severidad_regla, r.orden,
           min(case v.severidad when 'critico' then 1 when 'atencion' then 2
                                when 'oportunidad' then 3 else 4 end) as rango,
           count(*) filter (where v.estado = 'abierta')::integer as abiertas,
           count(*) filter (where v.estado = 'en_curso')::integer as en_curso
    from vivas v
    join public.reglas_alerta r on r.codigo = v.regla_codigo
    group by r.codigo, r.nombre, r.severidad, r.orden
  )
  select jsonb_build_object(
    'ultima_evaluacion', (
      select max(e.fin_at) from public.alertas_evaluaciones e
      where e.error is null and e.fin_at is not null
    ),
    'abiertas', jsonb_build_object(
      'critico', count(*) filter (where v.estado = 'abierta' and v.severidad = 'critico'),
      'atencion', count(*) filter (where v.estado = 'abierta' and v.severidad = 'atencion'),
      'oportunidad', count(*) filter (where v.estado = 'abierta' and v.severidad = 'oportunidad'),
      'informativo', count(*) filter (where v.estado = 'abierta' and v.severidad = 'informativo')
    ),
    'en_curso', count(*) filter (where v.estado = 'en_curso'),
    'pospuestas', count(*) filter (where v.estado = 'pospuesta'),
    'reglas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'regla_codigo', pr.codigo,
               'regla', pr.nombre,
               'severidad', case pr.rango when 1 then 'critico' when 2 then 'atencion'
                                          when 3 then 'oportunidad' else 'informativo' end,
               'abiertas', pr.abiertas,
               'en_curso', pr.en_curso,
               'grupos', coalesce((
                 select jsonb_agg(jsonb_build_object('grupo', g.grupo, 'cantidad', g.cantidad)
                                  order by g.cantidad desc, g.grupo)
                 from (
                   select coalesce(v2.grupo, '—') as grupo, count(*)::integer as cantidad
                   from vivas v2
                   where v2.regla_codigo = pr.codigo and v2.estado = 'abierta'
                   group by 1
                   order by 2 desc, 1
                   limit 3
                 ) g
               ), '[]'::jsonb)
             ) order by pr.rango, pr.orden)
      from por_regla pr
      where pr.abiertas + pr.en_curso > 0
    ), '[]'::jsonb)
  )
  into v_resultado
  from vivas v;

  return v_resultado;
end;
$$;

revoke execute on function public.fn_resumen_alertas() from public, anon;
grant execute on function public.fn_resumen_alertas() to authenticated;

notify pgrst, 'reload schema';

-- Verificación (debe dar true, true). Se prueban desde la app: en el SQL
-- Editor no hay usuario y la función rechaza ("No tenés permiso").
select
  to_regprocedure('public.fn_alertas(integer)') is not null as lista,
  to_regprocedure('public.fn_resumen_alertas()') is not null as resumen;
