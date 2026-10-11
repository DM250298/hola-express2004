-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 246 · Tipo de patrón 'bloques_alternados'                ║
-- ║                                                                     ║
-- ║  El turno noche real (oct-2026) no reparte los días de cada semana  ║
-- ║  entre dos personas (noche_ab): cada uno trabaja 7 días corridos    ║
-- ║  y se alternan, con semanas de jueves a miércoles. Se agrega el     ║
-- ║  tipo 'bloques_alternados' y la columna `bloque_dias` (días por     ║
-- ║  bloque, default 7). `fecha_ancla` = primer día del primer bloque   ║
-- ║  del 1º (cualquier día de la semana). La lógica va en la mig 247.   ║
-- ║  REQUIERE: mig 236. Ejecutar UNA sola vez. PRUEBA → PRODUCCIÓN.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.patrones_cronograma
  add column if not exists bloque_dias integer not null default 7
    check (bloque_dias between 1 and 31);

alter table public.patrones_cronograma
  drop constraint if exists patrones_cronograma_tipo_check;
alter table public.patrones_cronograma
  add constraint patrones_cronograma_tipo_check
  check (tipo in ('franco_rotativo', 'noche_ab', 'bloques_alternados'));

comment on column public.patrones_cronograma.bloque_dias is
  'bloques_alternados: días corridos que trabaja cada persona antes de pasar a la siguiente.';

notify pgrst, 'reload schema';
