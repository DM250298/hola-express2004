-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 037 · Tareas recurrentes                                 ║
-- ║                                                                     ║
-- ║  Se agrega `tareas.recurrencia` con valores:                        ║
-- ║    · none      → tarea única (default)                              ║
-- ║    · diaria    → se repite todos los días                           ║
-- ║    · semanal   → mismo día de la semana                             ║
-- ║    · mensual   → mismo día del mes                                  ║
-- ║    · anual     → misma fecha cada año                               ║
-- ║                                                                     ║
-- ║  Cuando una tarea recurrente se marca como hecha, la UI calcula     ║
-- ║  la próxima fecha_limite y resetea el estado a 'pendiente'.         ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.tareas
  add column if not exists recurrencia text not null default 'none';

notify pgrst, 'reload schema';
