-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 188 · Alertas (Fase F, 6/7): la decisión humana          ║
-- ║                                                                     ║
-- ║  1. fn_crear_tarea_alertas: UNA tarea (módulo proyectos) para N     ║
-- ║     alertas → quedan 'en_curso' con tarea_id. La tarea va al        ║
-- ║     tablero "Acciones de HEX" (se crea solo) y al "Mi día" del      ║
-- ║     responsable, que queda como miembro del tablero.                ║
-- ║  2. fn_posponer_alertas: 'pospuesta' N días (1-90) con motivo. Si   ║
-- ║     la condición sigue al vencer, el evaluador la reabre.           ║
-- ║  3. fn_reabrir_alertas: deshace un posponer.                        ║
-- ║  (La edición de reglas está en la mig 189.)                         ║
-- ║                                                                     ║
-- ║  No existe "resolver a mano": se resuelve cuando se va el problema. ║
-- ║  REQUIERE: mig 183. Ejecutar UNA sola vez, COMPLETO.                ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. Crear tarea ──────────────────────────────────────────────────
drop function if exists public.fn_crear_tarea_alertas(bigint[], text, text, uuid, date, text);

create function public.fn_crear_tarea_alertas(
  p_alerta_ids bigint[],
  p_titulo text,
  p_descripcion text,
  p_responsable_id uuid,
  p_fecha_limite date,
  p_prioridad text
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tablero integer;
  v_proyecto integer;
  v_tarea integer;
  v_cantidad integer;
begin
  if v_uid is null or not public.fn_tiene_permiso('alertas') then
    raise exception 'No tenés permiso para decidir sobre alertas.';
  end if;
  if coalesce(btrim(p_titulo), '') = '' then
    raise exception 'La tarea necesita un título.';
  end if;
  if coalesce(p_prioridad, '') not in ('baja', 'media', 'alta') then
    raise exception 'Prioridad inválida.';
  end if;
  if not exists (select 1 from public.usuarios u where u.id = p_responsable_id and u.activo) then
    raise exception 'Elegí un responsable activo.';
  end if;

  select count(*)::integer into v_cantidad
  from (
    select a.id from public.alertas a
    where a.id = any(p_alerta_ids) and a.estado in ('abierta', 'pospuesta')
    for update
  ) bloqueadas;
  if v_cantidad = 0 then
    raise exception 'Esas alertas ya tienen una tarea o se resolvieron. Actualizá la pantalla.';
  end if;

  -- Dos personas creando la primera tarea a la vez no duplican el tablero.
  perform pg_advisory_xact_lock(hashtext('hex_tablero_acciones'));

  select tb.id into v_tablero
  from public.tableros tb
  where tb.nombre = 'Acciones de HEX' and not tb.archivado
  order by tb.id limit 1;
  if v_tablero is null then
    insert into public.tableros (nombre, descripcion, color, creado_por)
    values ('Acciones de HEX', 'Tareas creadas desde las alertas de HEX.', '#c43e2c', v_uid)
    returning id into v_tablero;
  end if;

  select pr.id into v_proyecto
  from public.proyectos pr
  where pr.tablero_id = v_tablero and pr.nombre = 'Acciones sugeridas'
  order by pr.id limit 1;
  if v_proyecto is null then
    insert into public.proyectos (nombre, descripcion, tablero_id, usuario_id)
    values ('Acciones sugeridas', 'Una tarea por decisión tomada sobre alertas.', v_tablero, v_uid)
    returning id into v_proyecto;
  end if;

  insert into public.tablero_miembros (tablero_id, usuario_id, rol)
  values (v_tablero, v_uid, 'admin'), (v_tablero, p_responsable_id, 'editor')
  on conflict (tablero_id, usuario_id) do nothing;

  -- Si el responsable ya era solo lector del tablero, tiene que poder
  -- mover su tarea.
  update public.tablero_miembros tm
  set rol = 'editor'
  where tm.tablero_id = v_tablero
    and tm.usuario_id = p_responsable_id
    and tm.rol = 'lector';

  insert into public.tareas (
    proyecto_id, titulo, descripcion, estado, prioridad,
    responsable_id, fecha_limite, creado_por
  )
  values (
    v_proyecto, btrim(p_titulo), nullif(btrim(coalesce(p_descripcion, '')), ''),
    'pendiente', p_prioridad, p_responsable_id, p_fecha_limite, v_uid
  )
  returning id into v_tarea;

  update public.alertas a
  set estado = 'en_curso',
      decision = 'tarea',
      decidida_por = v_uid,
      decidida_at = now(),
      nota_decision = null,
      pospuesta_hasta = null,
      tarea_id = v_tarea
  where a.id = any(p_alerta_ids) and a.estado in ('abierta', 'pospuesta');

  return v_tarea;
end;
$$;

-- ─── 2. Posponer ─────────────────────────────────────────────────────
drop function if exists public.fn_posponer_alertas(bigint[], integer, text);

create function public.fn_posponer_alertas(
  p_alerta_ids bigint[],
  p_dias integer,
  p_motivo text
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_cantidad integer;
begin
  if auth.uid() is null or not public.fn_tiene_permiso('alertas') then
    raise exception 'No tenés permiso para decidir sobre alertas.';
  end if;
  if p_dias is null or p_dias < 1 or p_dias > 90 then
    raise exception 'Se puede posponer entre 1 y 90 días.';
  end if;

  update public.alertas a
  set estado = 'pospuesta',
      decision = 'posponer',
      decidida_por = auth.uid(),
      decidida_at = now(),
      nota_decision = nullif(btrim(coalesce(p_motivo, '')), ''),
      pospuesta_hasta = (now() at time zone 'America/Argentina/La_Rioja')::date + p_dias
  where a.id = any(p_alerta_ids) and a.estado in ('abierta', 'pospuesta');
  get diagnostics v_cantidad = row_count;
  return v_cantidad;
end;
$$;

-- ─── 3. Reabrir (deshacer posponer) ──────────────────────────────────
drop function if exists public.fn_reabrir_alertas(bigint[]);

create function public.fn_reabrir_alertas(p_alerta_ids bigint[])
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_cantidad integer;
begin
  if auth.uid() is null or not public.fn_tiene_permiso('alertas') then
    raise exception 'No tenés permiso para decidir sobre alertas.';
  end if;

  update public.alertas a
  set estado = 'abierta', pospuesta_hasta = null
  where a.id = any(p_alerta_ids) and a.estado = 'pospuesta';
  get diagnostics v_cantidad = row_count;
  return v_cantidad;
end;
$$;

revoke execute on function public.fn_crear_tarea_alertas(bigint[], text, text, uuid, date, text) from public, anon;
revoke execute on function public.fn_posponer_alertas(bigint[], integer, text) from public, anon;
revoke execute on function public.fn_reabrir_alertas(bigint[]) from public, anon;
grant execute on function public.fn_crear_tarea_alertas(bigint[], text, text, uuid, date, text) to authenticated;
grant execute on function public.fn_posponer_alertas(bigint[], integer, text) to authenticated;
grant execute on function public.fn_reabrir_alertas(bigint[]) to authenticated;

notify pgrst, 'reload schema';

-- Verificación (debe dar 3):
select count(*) as funciones
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('fn_crear_tarea_alertas', 'fn_posponer_alertas', 'fn_reabrir_alertas');
