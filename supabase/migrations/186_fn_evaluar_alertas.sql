-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 186 · Alertas (Fase F, 4/7): el evaluador                ║
-- ║                                                                     ║
-- ║  fn_evaluar_alertas(p_origen, p_si_antiguedad_min) → jsonb          ║
-- ║   1. Arma pg_temp._alertas_skus desde fn_resumen_skus (30 días) +   ║
-- ║      costo actual SIN gate (ver mig 184).                           ║
-- ║   2. Corre las reglas (migs 184 y 185) → _alertas_candidatas.       ║
-- ║   3. Reconcilia contra alertas:                                     ║
-- ║      · pospuesta vencida que sigue → vuelve a 'abierta'             ║
-- ║      · en_curso cuya tarea se borró → vuelve a 'abierta'            ║
-- ║      · la que sigue → refresca detalle/impacto/severidad            ║
-- ║      · la nueva → inserta (el índice único impide duplicar)         ║
-- ║      · la que ya no se cumple → 'resuelta' (sola, nunca a mano)     ║
-- ║   4. Deja el log en alertas_evaluaciones.                           ║
-- ║                                                                     ║
-- ║  p_si_antiguedad_min: si hubo una evaluación OK hace menos de esos  ║
-- ║  minutos, no hace nada (las pantallas la llaman al abrir).          ║
-- ║  Un advisory lock evita dos corridas simultáneas.                   ║
-- ║                                                                     ║
-- ║  Quién puede: el cron (service_role, sin usuario) o un usuario con  ║
-- ║  permiso 'alertas'.                                                 ║
-- ║  REQUIERE: migs 183-185. Ejecutar UNA sola vez, COMPLETO.           ║
-- ╚════════════════════════════════════════════════════════════════════╝

drop function if exists public.fn_evaluar_alertas(text, integer);

create function public.fn_evaluar_alertas(
  p_origen text default 'manual',
  p_si_antiguedad_min integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_hoy date := (now() at time zone 'America/Argentina/La_Rioja')::date;
  v_inicio timestamptz := clock_timestamp();
  v_eval bigint;
  v_ultima timestamptz;
  v_nuevas integer := 0;
  v_resueltas integer := 0;
  v_reaparecidas integer := 0;
  v_tmp integer := 0;
  v_vivas integer := 0;
begin
  if auth.uid() is not null and not public.fn_tiene_permiso('alertas') then
    raise exception 'No tenés permiso para revisar las alertas.';
  end if;
  if p_origen not in ('cron', 'auto', 'manual')
     or (p_origen = 'cron' and auth.uid() is not null) then
    raise exception 'Origen inválido: %', p_origen;
  end if;

  select max(e.fin_at) into v_ultima
  from public.alertas_evaluaciones e
  where e.error is null and e.fin_at is not null;

  if p_si_antiguedad_min is not null
     and v_ultima is not null
     and v_ultima > now() - make_interval(mins => p_si_antiguedad_min) then
    return jsonb_build_object('evaluada', false, 'motivo', 'reciente', 'ultima', v_ultima);
  end if;

  if not pg_try_advisory_xact_lock(hashtext('hex_fn_evaluar_alertas')) then
    return jsonb_build_object('evaluada', false, 'motivo', 'en_curso', 'ultima', v_ultima);
  end if;

  insert into public.alertas_evaluaciones (origen, usuario_id)
  values (p_origen, auth.uid())
  returning id into v_eval;

  begin
    -- ── 1. Base por producto ──
    drop table if exists pg_temp._alertas_skus;
    drop table if exists pg_temp._alertas_candidatas;
    drop table if exists pg_temp._alertas_final;

    create temp table _alertas_skus on commit drop as
    select
      rs.producto_id, rs.nombre, rs.categoria, rs.proveedor, rs.es_critico,
      rs.venta_por_peso, rs.stock_actual, rs.ingresos,
      rs.unidades_vendidas + rs.unidades_via_combo as unidades,
      (rs.unidades_vendidas + rs.unidades_via_combo) / 30.0 as venta_diaria,
      rs.dias_sin_venta, rs.ultima_compra, rs.clase_abc, rs.precio_venta,
      coalesce(p.controlar_stock, true)
        and not exists (
          select 1 from public.producto_componentes pc where pc.producto_id = rs.producto_id
        ) as stockeable,
      public.fn_costo(rs.producto_id) as costo,
      p.categoria_id is not null as tiene_categoria
    from public.fn_resumen_skus(v_hoy - 29, v_hoy) rs
    join public.productos p on p.id = rs.producto_id;

    create temp table _alertas_candidatas (
      regla_codigo text,
      dedupe_key text,
      entidad_tipo text,
      entidad_id integer,
      producto_id integer,
      grupo text,
      titulo text,
      detalle jsonb,
      impacto numeric
    ) on commit drop;

    -- ── 2. Reglas ──
    perform public.fn__alertas_reglas_productos(v_hoy);
    perform public.fn__alertas_reglas_catalogo(v_hoy);

    create temp table _alertas_final on commit drop as
    select distinct on (c.dedupe_key) c.*, r.severidad
    from pg_temp._alertas_candidatas c
    join public.reglas_alerta r on r.codigo = c.regla_codigo
    order by c.dedupe_key, c.impacto desc nulls last;

    -- ── 3a. Reaparecen: pospuestas vencidas y en curso sin tarea ──
    update public.alertas a
    set estado = 'abierta', pospuesta_hasta = null
    from pg_temp._alertas_final f
    where a.dedupe_key = f.dedupe_key
      and a.estado = 'pospuesta'
      and a.pospuesta_hasta <= v_hoy;
    get diagnostics v_reaparecidas = row_count;

    update public.alertas a
    set estado = 'abierta'
    from pg_temp._alertas_final f
    where a.dedupe_key = f.dedupe_key
      and a.estado = 'en_curso'
      and a.tarea_id is null;
    get diagnostics v_tmp = row_count;
    v_reaparecidas := v_reaparecidas + v_tmp;

    -- ── 3b. Siguen: refrescar lo que cambia día a día ──
    update public.alertas a
    set severidad = f.severidad,
        grupo = f.grupo,
        titulo = f.titulo,
        detalle = f.detalle,
        impacto = f.impacto,
        producto_id = f.producto_id,
        ultima_deteccion_at = now()
    from pg_temp._alertas_final f
    where a.dedupe_key = f.dedupe_key
      and a.estado <> 'resuelta';

    -- ── 3c. Nuevas ──
    -- Si la misma condición se resolvió hace menos de 7 días (ej.: entró 1
    -- unidad y se volvió a quebrar), hereda la decisión: la tarea si sigue
    -- sin hacer, o lo pospuesto si el plazo no venció.
    insert into public.alertas (
      regla_codigo, severidad, dedupe_key, entidad_tipo, entidad_id,
      producto_id, grupo, titulo, detalle, impacto,
      estado, decision, decidida_por, decidida_at, nota_decision,
      pospuesta_hasta, tarea_id
    )
    select f.regla_codigo, f.severidad, f.dedupe_key, f.entidad_tipo, f.entidad_id,
           f.producto_id, f.grupo, f.titulo, f.detalle, f.impacto,
           case when prev.tarea_viva is not null then 'en_curso'
                when prev.pospuesta_hasta > v_hoy then 'pospuesta'
                else 'abierta' end,
           case when prev.tarea_viva is not null then 'tarea'
                when prev.pospuesta_hasta > v_hoy then 'posponer' end,
           case when prev.tarea_viva is not null or prev.pospuesta_hasta > v_hoy
                then prev.decidida_por end,
           case when prev.tarea_viva is not null or prev.pospuesta_hasta > v_hoy
                then prev.decidida_at end,
           case when prev.tarea_viva is not null or prev.pospuesta_hasta > v_hoy
                then prev.nota_decision end,
           case when prev.tarea_viva is null and prev.pospuesta_hasta > v_hoy
                then prev.pospuesta_hasta end,
           prev.tarea_viva
    from pg_temp._alertas_final f
    left join lateral (
      select a.decidida_por, a.decidida_at, a.nota_decision, a.pospuesta_hasta,
             case when t.id is not null and t.estado <> 'hecha' then t.id end as tarea_viva
      from public.alertas a
      left join public.tareas t on t.id = a.tarea_id
      where a.dedupe_key = f.dedupe_key
        and a.estado = 'resuelta'
        and a.resolucion = 'condicion_superada'
        and a.resuelta_at > now() - interval '7 days'
      order by a.resuelta_at desc
      limit 1
    ) prev on true
    where not exists (
      select 1 from public.alertas a
      where a.dedupe_key = f.dedupe_key and a.estado <> 'resuelta'
    );
    get diagnostics v_nuevas = row_count;

    -- ── 3d. Resueltas: la condición ya no se cumple ──
    update public.alertas a
    set estado = 'resuelta',
        resuelta_at = now(),
        resolucion = case when r.activa then 'condicion_superada' else 'regla_desactivada' end
    from public.reglas_alerta r
    where r.codigo = a.regla_codigo
      and a.estado <> 'resuelta'
      and not exists (
        select 1 from pg_temp._alertas_final f where f.dedupe_key = a.dedupe_key
      );
    get diagnostics v_resueltas = row_count;

    select count(*)::integer into v_vivas
    from public.alertas a where a.estado <> 'resuelta';

    update public.alertas_evaluaciones
    set fin_at = clock_timestamp(),
        nuevas = v_nuevas,
        resueltas = v_resueltas,
        reaparecidas = v_reaparecidas,
        vivas = v_vivas
    where id = v_eval;
  exception when others then
    update public.alertas_evaluaciones
    set fin_at = clock_timestamp(), error = sqlerrm
    where id = v_eval;
    return jsonb_build_object('evaluada', false, 'motivo', 'error', 'error', sqlerrm);
  end;

  return jsonb_build_object(
    'evaluada', true,
    'nuevas', v_nuevas,
    'resueltas', v_resueltas,
    'reaparecidas', v_reaparecidas,
    'vivas', v_vivas,
    'duracion_ms', round(extract(epoch from clock_timestamp() - v_inicio) * 1000)
  );
end;
$$;

revoke execute on function public.fn_evaluar_alertas(text, integer) from public, anon;
grant execute on function public.fn_evaluar_alertas(text, integer) to authenticated, service_role;

notify pgrst, 'reload schema';

-- Verificación (debe dar true). La corrida real se prueba desde la app o
-- desde el cron: en el SQL Editor no hay usuario, así que corre como el cron.
--   select public.fn_evaluar_alertas('manual');
select to_regprocedure('public.fn_evaluar_alertas(text,integer)') is not null as creada;
