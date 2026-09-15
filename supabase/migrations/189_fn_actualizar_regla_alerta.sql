-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 189 · Alertas (Fase F, 7/7): configurar reglas           ║
-- ║                                                                     ║
-- ║  fn_actualizar_regla_alerta: activa, severidad y parámetros — solo  ║
-- ║  las claves que la regla ya tiene y del mismo tipo (no se inventan  ║
-- ║  reglas desde la UI). Números entre 0 y 1.000.000.000; los días,    ║
-- ║  enteros hasta 3650 (un decimal frenaría al evaluador).             ║
-- ║  Exige 'tablero'.                                                   ║
-- ║                                                                     ║
-- ║  REQUIERE: mig 183. Ejecutar UNA sola vez, COMPLETO.                ║
-- ╚════════════════════════════════════════════════════════════════════╝

drop function if exists public.fn_actualizar_regla_alerta(text, boolean, text, jsonb);

create function public.fn_actualizar_regla_alerta(
  p_codigo text,
  p_activa boolean,
  p_severidad text,
  p_parametros jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actual jsonb;
  v_nuevo jsonb;
begin
  if auth.uid() is null or not public.fn_tiene_permiso('tablero') then
    raise exception 'No tenés permiso para configurar las alertas.';
  end if;
  if coalesce(p_severidad, '') not in ('critico', 'atencion', 'oportunidad', 'informativo') then
    raise exception 'Severidad inválida.';
  end if;

  select r.parametros into v_actual
  from public.reglas_alerta r where r.codigo = p_codigo
  for update;
  if not found then
    raise exception 'La regla % no existe.', p_codigo;
  end if;

  if exists (
    select 1
    from jsonb_each(coalesce(p_parametros, '{}'::jsonb)) n
    where v_actual ? n.key
      and (jsonb_typeof(n.value) <> jsonb_typeof(v_actual -> n.key)
           or case when jsonb_typeof(n.value) = 'number'
                   then (n.value)::text::numeric < 0
                        or (n.value)::text::numeric > 1000000000
                        or (n.key in ('dias', 'dias_cobertura', 'dias_sin_venta',
                                      'dias_venta_reciente')
                            and ((n.value)::text::numeric > 3650
                                 or (n.value)::text::numeric <> trunc((n.value)::text::numeric)))
                   else false end)
  ) then
    raise exception 'Parámetros inválidos para la regla %.', p_codigo;
  end if;

  select v_actual || coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb)
  into v_nuevo
  from jsonb_each(coalesce(p_parametros, '{}'::jsonb)) n
  where v_actual ? n.key;

  update public.reglas_alerta r
  set activa = coalesce(p_activa, r.activa),
      severidad = p_severidad,
      parametros = v_nuevo,
      updated_by = auth.uid(),
      updated_at = now()
  where r.codigo = p_codigo;

  -- La severidad nueva se ve ya; lo demás, en la próxima evaluación.
  update public.alertas a
  set severidad = p_severidad
  where a.regla_codigo = p_codigo and a.estado <> 'resuelta';
end;
$$;

revoke execute on function public.fn_actualizar_regla_alerta(text, boolean, text, jsonb) from public, anon;
grant execute on function public.fn_actualizar_regla_alerta(text, boolean, text, jsonb) to authenticated;

notify pgrst, 'reload schema';

-- Verificación (debe dar true):
select to_regprocedure('public.fn_actualizar_regla_alerta(text,boolean,text,jsonb)') is not null as creada;
