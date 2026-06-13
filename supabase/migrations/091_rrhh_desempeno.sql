-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 091 · RRHH Sprint 5 — Desempeño + Tablero RRHH            ║
-- ║                                                                     ║
-- ║  Cierra el módulo RRHH. Dos capacidades nuevas, sin tablas pesadas:  ║
-- ║                                                                     ║
-- ║  1) DESEMPEÑO por empleado/mes. Score 0-100 con 3 componentes        ║
-- ║     ponderados (rrhh_config, ya sembrados en S1):                    ║
-- ║       · Asistencia (auto) = 100 − penales por tardanza/ausencia/     ║
-- ║         incompleto (configurable). N/A si no tuvo días con turno.    ║
-- ║       · Tareas (auto) = completadas/asignadas. N/A si no tuvo tareas.║
-- ║       · Manual = lo carga el dueño/encargado (0-100).               ║
-- ║     El TOTAL pondera SÓLO los componentes disponibles (si falta uno, ║
-- ║     su peso se redistribuye). Snapshot en `evaluacion_desempeno`.    ║
-- ║                                                                     ║
-- ║  2) TABLERO RRHH operativo (fn_dashboard_rrhh → jsonb): quién está   ║
-- ║     trabajando ahora (paridad de fichajes), ausentes de hoy, tareas  ║
-- ║     de hoy / vencidas, documentos por vencer y rachas de tardanzas.  ║
-- ║                                                                     ║
-- ║  Permisos: todo 'rrhh' (operativo, SIN montos salariales). El propio ║
-- ║  empleado puede leer SU score por fn_calcular_evaluacion (mi-panel). ║
-- ║                                                                     ║
-- ║  Reusa: asistencia_diaria (S2), tareas_turno (S3),                   ║
-- ║  empleado_documentos (S1), fichajes (S2), fn_tiene_permiso (047).    ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. Parámetros nuevos de config (nada hardcodeado) ───────────────────
-- Las ponderaciones (eval_ponderacion_*) ya se sembraron en la mig 085.
-- Acá se agregan los penales del score de asistencia y los umbrales del
-- tablero. Penales ESTRICTOS confirmados con el dueño (2026-06-12).
insert into public.rrhh_config (clave, valor, descripcion) values
  ('eval_penal_tardanza',         '10', 'Puntos que resta cada tardanza en el score de asistencia'),
  ('eval_penal_ausencia',         '34', 'Puntos que resta cada ausencia injustificada en el score de asistencia'),
  ('eval_penal_incompleto',       '15', 'Puntos que resta cada día incompleto en el score de asistencia'),
  ('dashboard_dias_doc_por_vencer', '30', 'Días de anticipo para alertar documentos por vencer en el tablero'),
  ('dashboard_racha_tardanzas',     '3', 'Tardanzas en el mes para marcar una racha en el tablero')
on conflict (clave) do nothing;

-- ─── 2. Snapshot de la evaluación de desempeño (por empleado/mes) ────────
-- Una fila por (empleado, período). Guarda el score calculado al momento de
-- evaluar + la nota manual + el comentario del evaluador. Se re-genera con
-- fn_guardar_evaluacion (upsert), así que no es inmutable como un recibo:
-- es la "foto" vigente de la evaluación del mes.
create table if not exists public.evaluacion_desempeno (
  id                 serial primary key,
  empleado_id        integer not null references public.empleados(id) on delete cascade,
  periodo            text not null,                    -- YYYY-MM
  puntaje_asistencia numeric(5,2),                     -- null = sin días con turno
  puntaje_tareas     numeric(5,2),                     -- null = sin tareas asignadas
  puntaje_manual     numeric(5,2),                     -- null = aún sin evaluar a mano
  puntaje_total      numeric(5,2),                     -- ponderado de los disponibles; null = sin datos
  -- snapshot de las métricas que sustentan el score (para mostrar/auditar)
  dias_trabajados    integer not null default 0,
  tardanzas          integer not null default 0,
  ausencias          integer not null default 0,
  tareas_asignadas   integer not null default 0,
  tareas_completadas integer not null default 0,
  comentario         text,
  usuario_id         uuid references public.usuarios(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (empleado_id, periodo)
);
create index if not exists eval_desempeno_periodo_idx
  on public.evaluacion_desempeno (periodo);

-- ─── 3. fn_calcular_evaluacion — score EN VIVO (auto + manual guardado) ──
-- Devuelve una fila por empleado activo (o uno solo si se pasa p_empleado_id)
-- con los componentes calculados desde asistencia_diaria + tareas_turno del
-- período, más la nota manual ya guardada (si existe) y el total ponderado.
-- Gate: 'rrhh' ve a todos; un empleado puede pedir SU propio score (mi-panel).
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
    select tt.empleado_id,
      count(*) filter (where tt.estado <> 'cancelada')::int as asignadas,
      count(*) filter (where tt.estado = 'completada')::int as completadas
    from public.tareas_turno tt
    where tt.fecha between v_desde and v_hasta
    group by tt.empleado_id
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

revoke execute on function public.fn_calcular_evaluacion(text, integer) from public;
grant execute on function public.fn_calcular_evaluacion(text, integer) to authenticated;

-- ─── 4. fn_guardar_evaluacion — fija la nota manual y congela el snapshot ─
-- Recalcula los componentes auto (reusando fn_calcular_evaluacion), arma el
-- total con la nota manual NUEVA y hace upsert. Gate 'rrhh'.
create or replace function public.fn_guardar_evaluacion(
  p_empleado_id integer,
  p_periodo text,
  p_puntaje_manual numeric default null,
  p_comentario text default null,
  p_usuario_id uuid default null
) returns public.evaluacion_desempeno
language plpgsql security definer set search_path = public as $$
declare
  v_calc record;
  v_pon_asis numeric := 40;
  v_pon_tar  numeric := 40;
  v_pon_man  numeric := 20;
  v_total numeric;
  v_res public.evaluacion_desempeno;
begin
  if not public.fn_tiene_permiso('rrhh') then
    raise exception 'Sin permiso para evaluar el desempeño.';
  end if;
  if p_periodo !~ '^\d{4}-\d{2}$' then
    raise exception 'Período inválido (se espera YYYY-MM): %', p_periodo;
  end if;
  if p_puntaje_manual is not null and (p_puntaje_manual < 0 or p_puntaje_manual > 100) then
    raise exception 'El puntaje manual debe estar entre 0 y 100.';
  end if;

  -- Componentes auto vigentes del empleado en el período. Si no hay fila
  -- (empleado inexistente o inactivo) FOUND queda false (no se accede al
  -- record sin asignar).
  select * into v_calc
    from public.fn_calcular_evaluacion(p_periodo, p_empleado_id)
    limit 1;
  if not found then
    raise exception 'No se encontró el empleado activo % para el período %.', p_empleado_id, p_periodo;
  end if;

  select coalesce((valor #>> '{}')::numeric, v_pon_asis) into v_pon_asis from public.rrhh_config where clave = 'eval_ponderacion_asistencia';
  select coalesce((valor #>> '{}')::numeric, v_pon_tar)  into v_pon_tar  from public.rrhh_config where clave = 'eval_ponderacion_tareas';
  select coalesce((valor #>> '{}')::numeric, v_pon_man)  into v_pon_man  from public.rrhh_config where clave = 'eval_ponderacion_manual';

  -- Total con la nota manual nueva (misma normalización por pesos presentes).
  v_total := case
    when v_calc.puntaje_asistencia is null and v_calc.puntaje_tareas is null and p_puntaje_manual is null then null
    else round(
      ( coalesce(v_calc.puntaje_asistencia * v_pon_asis, 0)
      + coalesce(v_calc.puntaje_tareas     * v_pon_tar,  0)
      + coalesce(p_puntaje_manual          * v_pon_man,  0) )
      / nullif(
          (case when v_calc.puntaje_asistencia is not null then v_pon_asis else 0 end)
        + (case when v_calc.puntaje_tareas     is not null then v_pon_tar  else 0 end)
        + (case when p_puntaje_manual          is not null then v_pon_man  else 0 end)
      , 0)
    , 2)
  end;

  insert into public.evaluacion_desempeno (
    empleado_id, periodo, puntaje_asistencia, puntaje_tareas, puntaje_manual,
    puntaje_total, dias_trabajados, tardanzas, ausencias,
    tareas_asignadas, tareas_completadas, comentario, usuario_id, updated_at
  ) values (
    -- dias_trabajados = presente + tardanza (un día con tardanza es trabajado),
    -- mismo criterio que la liquidación 090 y el panel del empleado.
    p_empleado_id, p_periodo, v_calc.puntaje_asistencia, v_calc.puntaje_tareas, p_puntaje_manual,
    v_total, (v_calc.dias_presente + v_calc.tardanzas), v_calc.tardanzas, v_calc.ausencias,
    v_calc.tareas_asignadas, v_calc.tareas_completadas, p_comentario, p_usuario_id, now()
  )
  on conflict (empleado_id, periodo) do update set
    puntaje_asistencia = excluded.puntaje_asistencia,
    puntaje_tareas     = excluded.puntaje_tareas,
    puntaje_manual     = excluded.puntaje_manual,
    puntaje_total      = excluded.puntaje_total,
    dias_trabajados    = excluded.dias_trabajados,
    tardanzas          = excluded.tardanzas,
    ausencias          = excluded.ausencias,
    tareas_asignadas   = excluded.tareas_asignadas,
    tareas_completadas = excluded.tareas_completadas,
    comentario         = excluded.comentario,
    usuario_id         = excluded.usuario_id,
    updated_at         = now()
  returning * into v_res;

  return v_res;
end $$;

revoke execute on function public.fn_guardar_evaluacion(integer, text, numeric, text, uuid) from public;
grant execute on function public.fn_guardar_evaluacion(integer, text, numeric, text, uuid) to authenticated;

-- ─── 5. fn_dashboard_rrhh — agregados del tablero operativo (jsonb) ──────
-- Un solo round-trip para todas las tarjetas del tablero. Gate 'rrhh'.
-- TZ fija America/Argentina/Buenos_Aires (sin DST → UTC-3), igual que S2/S3.
create or replace function public.fn_dashboard_rrhh()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text := 'America/Argentina/Buenos_Aires';
  v_ahora timestamptz := now();
  v_hoy date;
  v_mes_desde date;
  v_dias_doc int := 30;
  v_racha int := 3;
  v_result jsonb;
begin
  if not public.fn_tiene_permiso('rrhh') then
    raise exception 'Sin permiso para ver el tablero de RRHH.';
  end if;

  v_hoy := (timezone(v_tz, v_ahora))::date;
  v_mes_desde := date_trunc('month', v_hoy)::date;

  select coalesce((valor #>> '{}')::int, v_dias_doc) into v_dias_doc from public.rrhh_config where clave = 'dashboard_dias_doc_por_vencer';
  select coalesce((valor #>> '{}')::int, v_racha)    into v_racha    from public.rrhh_config where clave = 'dashboard_racha_tardanzas';

  select jsonb_build_object(
    'fecha', v_hoy,
    'generado_at', v_ahora,

    -- Trabajando ahora: paridad impar de fichajes válidos en las últimas 16h
    -- (cubre un turno completo incl. noche, sin reiniciar a las 00:00). Bajo el
    -- modelo de emparejamiento, paridad impar ⇒ el último fichaje es la entrada
    -- del tramo abierto, así que `desde` = max(momento) es el inicio del tramo
    -- actual. Se excluyen marcaciones anuladas y se colapsan los rebotes del
    -- reloj a < 3 min (aprox. del anti-rebote de fn_recalcular_asistencia) para
    -- que un doble-punch no invierta el estado presente/ausente.
    'trabajando_ahora', coalesce((
      select jsonb_agg(jsonb_build_object(
               'empleado_id', t.empleado_id, 'nombre', t.nombre,
               'apellido', t.apellido, 'desde', t.ultima
             ) order by t.ultima)
      from (
        select p.empleado_id, p.nombre, p.apellido, max(p.momento) as ultima
        from (
          select e.id as empleado_id, e.nombre, e.apellido, f.momento,
                 f.momento - lag(f.momento) over (
                   partition by f.empleado_id order by f.momento
                 ) as gap
          from public.fichajes f
          join public.empleados e on e.id = f.empleado_id and e.activo
          where f.tipo in ('entrada','salida','marcacion')
            and f.momento >  v_ahora - interval '16 hours'
            and f.momento <= v_ahora
            and not exists (
              select 1 from public.fichajes c
              where c.tipo = 'correccion' and c.fichaje_corregido_id = f.id
            )
        ) p
        where p.gap is null or p.gap >= interval '3 minutes'
        group by p.empleado_id, p.nombre, p.apellido
        having count(*) % 2 = 1
      ) t
    ), '[]'::jsonb),

    -- Ausentes ahora: turno EN CURSO (ya pasó inicio + tolerancia y todavía no
    -- terminó) sin ningún fichaje válido desde el arranque de la jornada. Se
    -- construye inicio/fin reales desde h.fecha (no v_hoy) para tratar el turno
    -- noche que cruza medianoche, y se incluye el de AYER que sigue corriendo.
    'ausentes_hoy', coalesce((
      select jsonb_agg(jsonb_build_object(
               'empleado_id', j.empleado_id, 'nombre', j.nombre, 'apellido', j.apellido,
               'turno', j.turno, 'hora_inicio', j.hora_inicio
             ) order by j.inicio_ts)
      from (
        select e.id as empleado_id, e.nombre, e.apellido,
               tp.nombre as turno, tp.hora_inicio, tp.tolerancia_min,
               (h.fecha + tp.hora_inicio) at time zone v_tz as inicio_ts,
               (case when tp.cruza_medianoche
                     then ((h.fecha + 1) + tp.hora_fin) at time zone v_tz
                     else (h.fecha + tp.hora_fin) at time zone v_tz end) as fin_ts
        from public.horarios_asignados h
        join public.empleados e on e.id = h.empleado_id and e.activo
        join public.turnos_plantilla tp on tp.id = h.turno_id
        where h.turno_id is not null
          and h.estado in ('planificado','cubierto')
          -- la noche planificada AYER sigue en curso pasada la medianoche
          and h.fecha in (v_hoy, v_hoy - 1)
      ) j
      where v_ahora > j.inicio_ts + make_interval(mins => j.tolerancia_min)
        and v_ahora < j.fin_ts
        and not exists (
          select 1 from public.fichajes f
          where f.empleado_id = j.empleado_id
            and f.tipo in ('entrada','salida','marcacion')
            and f.momento >= j.inicio_ts and f.momento <= v_ahora
            and not exists (
              select 1 from public.fichajes c
              where c.tipo = 'correccion' and c.fichaje_corregido_id = f.id
            )
        )
    ), '[]'::jsonb),

    -- Tareas de hoy (instancias materializadas).
    'tareas_hoy', (
      select jsonb_build_object(
        'total',       count(*),
        'completadas', count(*) filter (where estado = 'completada'),
        'pendientes',  count(*) filter (where estado in ('pendiente','en_curso'))
      )
      from public.tareas_turno where fecha = v_hoy
    ),

    -- Tareas vencidas de los últimos 14 días, agrupadas por responsable.
    'tareas_vencidas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'empleado_id', x.empleado_id, 'nombre', x.nombre,
               'apellido', x.apellido, 'cantidad', x.cantidad
             ) order by x.cantidad desc)
      from (
        select e.id as empleado_id, e.nombre, e.apellido, count(*) as cantidad
        from public.tareas_turno tt
        join public.empleados e on e.id = tt.empleado_id and e.activo
        where tt.estado = 'vencida'
          and tt.fecha >= v_hoy - 14
        group by e.id, e.nombre, e.apellido
      ) x
    ), '[]'::jsonb),

    -- Documentos por vencer (o ya vencidos): aptos médicos, certificados, etc.
    -- Sólo el documento MÁS RECIENTE por (empleado, tipo): si se renovó el apto,
    -- la fila vieja vencida no dispara la alerta. Se acota a vencidos de hasta
    -- 60 días atrás para no arrastrar ruido perpetuo de legajos viejos.
    'docs_por_vencer', coalesce((
      select jsonb_agg(jsonb_build_object(
               'empleado_id', ult.empleado_id, 'nombre', ult.nombre, 'apellido', ult.apellido,
               'tipo', ult.tipo, 'fecha_vencimiento', ult.fecha_vencimiento,
               'dias', (ult.fecha_vencimiento - v_hoy)
             ) order by ult.fecha_vencimiento)
      from (
        select distinct on (d.empleado_id, d.tipo)
               e.id as empleado_id, e.nombre, e.apellido, d.tipo, d.fecha_vencimiento
        from public.empleado_documentos d
        join public.empleados e on e.id = d.empleado_id and e.activo
        where d.fecha_vencimiento is not null
        order by d.empleado_id, d.tipo, d.fecha_vencimiento desc
      ) ult
      where ult.fecha_vencimiento <= v_hoy + v_dias_doc
        and ult.fecha_vencimiento >= v_hoy - 60
    ), '[]'::jsonb),

    -- Racha de tardanzas del mes en curso (>= umbral configurable).
    'rachas_tardanzas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'empleado_id', x.empleado_id, 'nombre', x.nombre,
               'apellido', x.apellido, 'tardanzas', x.tardanzas
             ) order by x.tardanzas desc)
      from (
        select e.id as empleado_id, e.nombre, e.apellido, count(*) as tardanzas
        from public.asistencia_diaria ad
        join public.empleados e on e.id = ad.empleado_id and e.activo
        where ad.estado = 'tardanza'
          and ad.fecha between v_mes_desde and v_hoy
        group by e.id, e.nombre, e.apellido
        having count(*) >= v_racha
      ) x
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

revoke execute on function public.fn_dashboard_rrhh() from public;
grant execute on function public.fn_dashboard_rrhh() to authenticated;

-- ─── 6. RLS de evaluacion_desempeno ──────────────────────────────────────
-- 'rrhh' lee/escribe todo; el empleado lee SU propia evaluación (su panel).
-- La escritura real va por fn_guardar_evaluacion (definer, bypassa RLS).
alter table public.evaluacion_desempeno enable row level security;
drop policy if exists "eval_desempeno_select" on public.evaluacion_desempeno;
drop policy if exists "eval_desempeno_write"  on public.evaluacion_desempeno;
create policy "eval_desempeno_select" on public.evaluacion_desempeno for select to authenticated
  using (
    public.fn_tiene_permiso('rrhh')
    or empleado_id in (select id from public.empleados where usuario_id = auth.uid())
  );
create policy "eval_desempeno_write" on public.evaluacion_desempeno for all to authenticated
  using (public.fn_tiene_permiso('rrhh')) with check (public.fn_tiene_permiso('rrhh'));

notify pgrst, 'reload schema';
