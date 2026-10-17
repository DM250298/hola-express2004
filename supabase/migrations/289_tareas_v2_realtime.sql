-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  289 · Tareas v2: la agenda se actualiza en vivo (Etapa 2)          ║
-- ║                                                                     ║
-- ║  Suma tareas_turno y tareas_turno_participantes a Realtime          ║
-- ║  (publicación supabase_realtime). Realtime respeta las reglas de    ║
-- ║  acceso: cada uno recibe solo los cambios de lo que puede ver (las  ║
-- ║  privadas, solo los administradores). El registro de cambios NO se  ║
-- ║  publica.                                                           ║
-- ║                                                                     ║
-- ║  No cambia nada hasta que la app nueva escuche los cambios.         ║
-- ║  Requiere la 288. Se puede correr de nuevo.                         ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"         ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['tareas_turno', 'tareas_turno_participantes'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

do $$
begin
  if (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename in ('tareas_turno', 'tareas_turno_participantes')) <> 2 then
    raise exception '289: las tablas no quedaron en Realtime.';
  end if;
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
               and tablename in ('tareas_eventos', 'tareas_pedidos')) then
    raise exception '289: el registro no se tiene que publicar.';
  end if;
end $$;

notify pgrst, 'reload schema';
