-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  262 · Tareas v2: estado "no se pudo"                               ║
-- ║  (Etapa 1 · bloque B)                                                ║
-- ║                                                                     ║
-- ║  ⚠ SE PEGA SOLA, en su propio pegado. Postgres no deja usar un      ║
-- ║  valor nuevo de un enum en la misma transacción en que se agrega:   ║
-- ║  si se pega junto con la 263, falla todo.                           ║
-- ║                                                                     ║
-- ║  No cambia nada visible: la app ya lo entiende (deploy F0) y nadie  ║
-- ║  escribe este estado hasta que se cierre la etapa.                  ║
-- ║  Se puede correr más de una vez.                                    ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter type public.estado_tarea_turno add value if not exists 'no_se_pudo' after 'completada';

-- Para mirar a mano después (tiene que aparecer no_se_pudo):
-- select enumlabel from pg_enum
--  where enumtypid = 'public.estado_tarea_turno'::regtype order by enumsortorder;

notify pgrst, 'reload schema';
