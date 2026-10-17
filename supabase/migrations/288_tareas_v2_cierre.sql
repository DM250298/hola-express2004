-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  288 · Tareas v2: cierre de la Etapa 1                               ║
-- ║                                                                     ║
-- ║  CORRER SOLO con la app nueva (F1) publicada y 24 h sin escrituras   ║
-- ║  directas (consulta de control en MIGRACIONES.md / el chat).         ║
-- ║                                                                     ║
-- ║   · Agenda y rutina (tareas_turno, participantes, tareas_recurrentes ║
-- ║     y asignados): la app ya no puede escribir directo; todo pasa por ║
-- ║     las funciones (que validan permisos y dejan registro). Se sacan  ║
-- ║     las reglas de escritura de transición y los permisos de tabla.   ║
-- ║   · Horarios de turno: solo el administrador de tareas (tareas_admin);║
-- ║     la lectura no cambia.                                            ║
-- ║   · "No se pudo" queda habilitado para la app; "Omitir con motivo"   ║
-- ║     pasa a cerrar como "No se pudo" (motivo "otro", con el texto).   ║
-- ║   · Los "Omitir" de antes pasan a "No se pudo / otro" (no contaban   ║
-- ║     en contra y siguen sin contar). Las canceladas de verdad y las   ║
-- ║     trasladadas no se tocan.                                         ║
-- ║   · Queda en el registro desde cuándo está completo.                 ║
-- ║  Requiere la 287. Se puede correr de nuevo.                          ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

set local lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from public.tareas_recurrentes where codigo = 'N15') then
    raise exception '288: falta la carga del Anexo A (285–287).';
  end if;
end $$;

-- ─── 1. Sin escrituras directas en agenda y rutina ──────────────────────
drop policy if exists tareas_turno_insert on public.tareas_turno;
drop policy if exists tareas_turno_update on public.tareas_turno;
drop policy if exists tareas_turno_delete on public.tareas_turno;
drop policy if exists tareas_turno_part_write on public.tareas_turno_participantes;
drop policy if exists tareas_rec_write on public.tareas_recurrentes;
drop policy if exists tareas_rec_asig_rw on public.tareas_recurrentes_asignados;

-- La rutina asignada se sigue leyendo (gestión; privadas solo admin).
drop policy if exists tareas_rec_asig_select on public.tareas_recurrentes_asignados;
create policy tareas_rec_asig_select on public.tareas_recurrentes_asignados for select to authenticated using (
  (select public.fn_tiene_permiso('tareas_admin'))
  or (plantilla_id not in (select public.fn_rutina_privadas_ids())
      and (select public.fn_tiene_permiso('tareas_gestion'))));

revoke insert, update, delete, truncate on
  public.tareas_turno, public.tareas_turno_participantes,
  public.tareas_recurrentes, public.tareas_recurrentes_asignados
  from public, anon, authenticated;

-- ─── 2. Horarios de turno: solo el administrador de tareas ──────────────
alter table public.turnos_plantilla enable row level security;
drop policy if exists turnos_plantilla_write on public.turnos_plantilla;
create policy turnos_plantilla_write on public.turnos_plantilla for all to authenticated
  using ((select public.fn_tiene_permiso('tareas_admin')))
  with check ((select public.fn_tiene_permiso('tareas_admin')));

-- ─── 3. "Omitir" cierra como "No se pudo" ───────────────────────────────
create or replace function public.fn_omitir_tarea(p_tarea_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_t record;
begin
  perform public.fn_tarea_puede_operar(p_tarea_id);
  if p_motivo is null or length(btrim(p_motivo)) < 5 then
    raise exception 'Indicá el motivo (mínimo 5 caracteres).';
  end if;
  select estado, tipo_actividad into v_t from public.tareas_turno where id = p_tarea_id for update;
  if v_t.estado not in ('pendiente', 'en_curso', 'vencida') then
    raise exception 'La tarea no se puede cerrar en su estado actual (%).', v_t.estado;
  end if;
  update public.tareas_turno
     set estado = 'no_se_pudo', motivo_no_se_pudo = 'otro', detalle_motivo = btrim(p_motivo)
   where id = p_tarea_id;
  perform public.fn_tarea_evento('no_se_pudo', p_tarea_id, null,
    jsonb_build_object('estado', v_t.estado),
    jsonb_build_object('estado', 'no_se_pudo', 'motivo', 'otro', 'detalle', btrim(p_motivo)),
    btrim(p_motivo), 'app:omitir');
end $$;

revoke execute on function public.fn_omitir_tarea(uuid, text) from public, anon;
grant execute on function public.fn_omitir_tarea(uuid, text) to authenticated;
revoke execute on function public.fn_tarea_no_se_pudo(uuid, public.tarea_motivo_no_se_pudo, text) from public, anon;
grant execute on function public.fn_tarea_no_se_pudo(uuid, public.tarea_motivo_no_se_pudo, text) to authenticated;

-- ─── 4. Los "Omitir" de antes → "No se pudo / otro" ─────────────────────
-- Omitida = cancelada con motivo, que no fue trasladada ni cancelada con
-- la función nueva (esas tienen el evento "cancelada" de la app).
update public.tareas_turno t
   set estado = 'no_se_pudo', motivo_no_se_pudo = 'otro', detalle_motivo = t.motivo_omision
 where t.estado = 'cancelada' and t.motivo_omision is not null and t.trasladada_a is null
   and not exists (select 1 from public.tareas_eventos e
                    where e.tarea_turno_id = t.id and e.tipo = 'cancelada' and e.origen = 'app');

-- ─── 5. Desde acá el registro está completo ─────────────────────────────
do $$
begin
  if not exists (select 1 from public.tareas_eventos where tipo = 'registro_completo') then
    perform public.fn_tarea_evento('registro_completo', null, null, null,
      jsonb_build_object('desde', now()), 'Las tareas solo se escriben por funciones (mig 288)', 'migracion');
  end if;
end $$;

-- ─── 6. Verificación ────────────────────────────────────────────────────
do $$
begin
  if has_table_privilege('authenticated', 'public.tareas_turno', 'UPDATE')
     or has_table_privilege('authenticated', 'public.tareas_turno', 'INSERT')
     or has_table_privilege('authenticated', 'public.tareas_recurrentes', 'DELETE')
     or has_table_privilege('authenticated', 'public.tareas_turno_participantes', 'INSERT') then
    raise exception '288: la app todavía puede escribir directo.';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public'
               and tablename in ('tareas_turno', 'tareas_turno_participantes',
                                 'tareas_recurrentes', 'tareas_recurrentes_asignados')
               and cmd <> 'SELECT') then
    raise exception '288: quedaron reglas de escritura.';
  end if;
  if not has_function_privilege('authenticated',
       'public.fn_tarea_no_se_pudo(uuid,public.tarea_motivo_no_se_pudo,text)', 'EXECUTE') then
    raise exception '288: "No se pudo" no quedó habilitado.';
  end if;
  if exists (select 1 from public.tareas_turno where estado = 'cancelada' and motivo_omision is not null
               and trasladada_a is null and motivo_no_se_pudo is null
               and not exists (select 1 from public.tareas_eventos e where e.tarea_turno_id = tareas_turno.id
                                 and e.tipo = 'cancelada' and e.origen = 'app')) then
    raise exception '288: quedaron "Omitir" sin pasar.';
  end if;
end $$;

notify pgrst, 'reload schema';
