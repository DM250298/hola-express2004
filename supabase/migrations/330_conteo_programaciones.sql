-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 330 · Conteo físico: sesiones programadas (1/4)         ║
-- ║                                                                    ║
-- ║  Una sesión de conteo se puede dejar PROGRAMADA con fecha y hora:  ║
-- ║  se guarda la receta (nombre, umbral, notas y las tareas tal cual  ║
-- ║  las manda el wizard) y a esa hora el sistema la abre con la       ║
-- ║  fn_abrir_sesion_conteo de siempre (mig 332). La foto del stock y  ║
-- ║  las listas se arman recién al abrirse. Por eso NO es un estado    ║
-- ║  nuevo de conteo_sesiones: una programada no es una sesión viva    ║
-- ║  (no toca el índice de "una sola abierta", la RLS del staff, el    ║
-- ║  banner ni el hub del celular).                                    ║
-- ║                                                                    ║
-- ║  Acá: tabla conteo_programaciones, RLS (solo conteo_cierre lee;    ║
-- ║  nadie escribe directo) y fn_conteo_programar_sesion.              ║
-- ║  Siguen: 331 (reprogramar, cancelar, abrir ahora), 332 (apertura   ║
-- ║  automática + pg_cron) y 333 (vista previa de una sesión nueva).   ║
-- ║                                                                    ║
-- ║  REQUIERE: migs 098, 222 a 225 y 260 (fn_sesion_es_sistema).       ║
-- ║  Ejecutar UNA sola vez, COMPLETO. Primero PRUEBA, después          ║
-- ║  PRODUCCIÓN (HEX-V1). Última línea: la verificación (select).      ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1 · Tabla ────────────────────────────────────────────────────────
create table if not exists public.conteo_programaciones (
  id serial primary key,
  nombre text not null,
  umbral_pesos numeric(12,2) not null default 5000,
  notas text,
  -- Las tareas como las manda el wizard: el mismo p_zonas de fn_abrir_sesion_conteo.
  zonas jsonb not null,
  programada_para timestamptz not null,
  programada_por uuid not null references public.usuarios(id),
  estado text not null default 'programada'
    check (estado in ('programada', 'abierta', 'cancelada', 'fallida')),
  sesion_id integer references public.conteo_sesiones(id) on delete set null,
  intentos integer not null default 0,
  ultimo_intento_at timestamptz,
  ultimo_error text,
  abierta_at timestamptz,
  -- NULL = la abrió el sistema a la hora; con valor = "Abrir ahora" de ese gestor.
  abierta_por uuid references public.usuarios(id),
  cancelada_at timestamptz,
  cancelada_por uuid references public.usuarios(id),
  created_at timestamptz not null default now()
);

create index if not exists conteo_programaciones_pendientes_idx
  on public.conteo_programaciones (programada_para) where estado = 'programada';

-- ─── 2 · RLS: leen los gestores; toda escritura pasa por las fn_* ──────
alter table public.conteo_programaciones enable row level security;
drop policy if exists "conteo_programaciones_select" on public.conteo_programaciones;
create policy "conteo_programaciones_select" on public.conteo_programaciones
  for select to authenticated
  using ((select public.fn_tiene_permiso('conteo_cierre')));

-- ─── 3 · Regla de la fecha (la comparte fn_conteo_reprogramar_sesion, 331) ──
create or replace function public.fn_conteo_validar_programada_para(p_para timestamptz)
returns void language plpgsql set search_path = public as $$
begin
  if p_para is null then
    raise exception 'Elegí fecha y hora.';
  end if;
  if p_para < now() + interval '2 minutes' then
    raise exception 'La fecha y hora ya pasaron: usá "Abrir ahora".';
  end if;
  if p_para > now() + interval '90 days' then
    raise exception 'Como mucho 90 días adelante.';
  end if;
end $$;
revoke execute on function public.fn_conteo_validar_programada_para(timestamptz)
  from public, anon, authenticated;

-- ─── 4 · fn_conteo_programar_sesion ───────────────────────────────────
drop function if exists public.fn_conteo_programar_sesion(text, numeric, jsonb, text, timestamptz);

create function public.fn_conteo_programar_sesion(
  p_nombre text,
  p_umbral numeric,
  p_zonas jsonb,
  p_notas text,
  p_programada_para timestamptz
) returns public.conteo_programaciones
language plpgsql security definer set search_path = public
as $$
declare
  c_uuid constant text := '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$';
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_resp text;
  v_fila public.conteo_programaciones;
begin
  if v_uid is null then
    raise exception 'No se pudo identificar al usuario.';
  end if;
  if not public.fn_tiene_permiso('conteo_cierre') then
    raise exception 'No tenés permiso para programar sesiones de conteo.';
  end if;
  if p_nombre is null or btrim(p_nombre) = '' then
    raise exception 'Poné un nombre a la sesión (ej. "Inventario Julio 2026").';
  end if;
  if p_zonas is null or jsonb_typeof(p_zonas) <> 'array'
     or jsonb_array_length(p_zonas) = 0 then
    raise exception 'Armá al menos una tarea: qué se cuenta y quién lo cuenta.';
  end if;
  perform public.fn_conteo_validar_programada_para(p_programada_para);

  -- Lo que fn_conteo_crear_tareas va a exigir al abrir, chequeado hoy para
  -- avisar ahora y no a la hora programada: nombre y responsables activos.
  -- Las listas (criterios, cantidades, ventana) sí se arman recién al abrir.
  for v_item in select * from jsonb_array_elements(p_zonas) loop
    if btrim(coalesce(v_item->>'nombre', '')) = '' then
      raise exception 'Todas las tareas necesitan un nombre.';
    end if;
    if jsonb_typeof(v_item->'responsables') = 'array' then
      for v_resp in select x from jsonb_array_elements_text(v_item->'responsables') x loop
        if v_resp !~* c_uuid then
          raise exception 'Un responsable de la tarea "%" no es válido.', btrim(v_item->>'nombre');
        end if;
        if not exists (select 1 from public.usuarios u where u.id = v_resp::uuid and u.activo) then
          raise exception 'Un responsable de la tarea "%" no es un usuario activo.', btrim(v_item->>'nombre');
        end if;
      end loop;
    end if;
  end loop;

  insert into public.conteo_programaciones
    (nombre, umbral_pesos, notas, zonas, programada_para, programada_por)
  values (btrim(p_nombre), coalesce(p_umbral, 5000), nullif(btrim(p_notas), ''),
          p_zonas, p_programada_para, v_uid)
  returning * into v_fila;

  begin
    perform public.fn_auditar(v_uid, 'programar_conteo_sesion', 'conteo_programacion', v_fila.id,
      jsonb_build_object('nombre', v_fila.nombre, 'programada_para', v_fila.programada_para,
                         'tareas', jsonb_array_length(p_zonas)));
  exception when others then null; end;
  return v_fila;
end;
$$;

revoke execute on function public.fn_conteo_programar_sesion(text, numeric, jsonb, text, timestamptz)
  from public, anon;
grant execute on function public.fn_conteo_programar_sesion(text, numeric, jsonb, text, timestamptz)
  to authenticated;

notify pgrst, 'reload schema';

-- Verificación (las tres columnas deben dar true). Después, chequeo T1:
--   select proname, count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and proname like 'fn_%' group by proname having count(*) > 1;
select
  to_regclass('public.conteo_programaciones') is not null as tabla,
  to_regprocedure('public.fn_conteo_programar_sesion(text,numeric,jsonb,text,timestamptz)') is not null as programar,
  not has_function_privilege('authenticated', 'public.fn_conteo_validar_programada_para(timestamptz)', 'EXECUTE') as helper_interno;
