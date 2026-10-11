-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 239 · patrones_cronograma.orden_dias                     ║
-- ║                                                                     ║
-- ║  El cronograma vigente desde jul-2026 no es "un franco por día de   ║
-- ║  lunes a domingo": la semana va de domingo a sábado, el viernes     ║
-- ║  nadie descansa (local lleno) y el franco de cada persona avanza en ║
-- ║  el orden Dom → Lun → Mié → Mar → Jue → Sáb (finde Sáb+Dom          ║
-- ║  rotativo). Para expresarlo, cada patrón franco_rotativo guarda:    ║
-- ║   · orden_dias: posiciones 0..6 dentro de la semana, contadas desde ║
-- ║     el día del ancla, en el orden en que rota el franco. Los días   ║
-- ║     que no figuran no tienen franco. Default {0..6} = patrón de     ║
-- ║     abril (ancla lunes, los 7 días).                                ║
-- ║   · fecha_ancla pasa a ser el PRIMER DÍA de la semana 1, de         ║
-- ║     cualquier día de la semana (se quita el check "lunes"; en       ║
-- ║     noche_ab lo exige la RPC, mig 240).                             ║
-- ║  REQUIERE: mig 236. Ejecutar UNA sola vez. PRUEBA → PRODUCCIÓN.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.patrones_cronograma
  add column if not exists orden_dias integer[] not null default '{0,1,2,3,4,5,6}';

alter table public.patrones_cronograma
  drop constraint if exists patrones_ancla_lunes;

alter table public.patrones_cronograma
  drop constraint if exists patrones_orden_dias_rango;
alter table public.patrones_cronograma
  add constraint patrones_orden_dias_rango check (
    orden_dias <@ '{0,1,2,3,4,5,6}'::integer[]
    and array_length(orden_dias, 1) between 1 and 7
  );

comment on column public.patrones_cronograma.orden_dias is
  'franco_rotativo: posiciones 0..6 desde fecha_ancla con franco, en orden de rotación. Días ausentes = nadie descansa.';
comment on column public.patrones_cronograma.fecha_ancla is
  'Primer día de la semana 1 del ciclo (k = 0). En noche_ab debe ser lunes (semana A).';

notify pgrst, 'reload schema';

-- Verificación:
--   select column_name from information_schema.columns
--   where table_name = 'patrones_cronograma' and column_name = 'orden_dias';
