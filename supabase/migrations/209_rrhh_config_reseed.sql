-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 209 · Re-siembra de rrhh_config                          ║
-- ║                                                                     ║
-- ║  "Generar liquidación" falla en producción con "null value in       ║
-- ║  column presentismo_perdido": fn_generar_liquidacion (090) lee sus  ║
-- ║  parámetros de rrhh_config y, si falta una clave, la variable queda ║
-- ║  en NULL. Lo más probable es que el seed de la 085 no haya llegado  ║
-- ║  completo a producción (pegado cortado en el SQL Editor).           ║
-- ║                                                                     ║
-- ║  Vuelve a insertar las claves con los mismos valores de la 085.     ║
-- ║  `on conflict do nothing`: NO pisa lo que ya esté configurado.      ║
-- ║  La 210 además hace que la función no dependa de estas filas.       ║
-- ║                                                                     ║
-- ║  Diagnóstico ANTES de correrla (qué claves hay hoy):                ║
-- ║    select clave, valor from public.rrhh_config order by clave;      ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO.                                   ║
-- ╚════════════════════════════════════════════════════════════════════╝

insert into public.rrhh_config (clave, valor, descripcion) values
  ('tolerancia_tardanza_min',   '10',    'Minutos de gracia antes de marcar tardanza'),
  ('divisor_valor_hora',        '200',   'Divisor del sueldo básico para el valor hora'),
  ('presentismo_porcentaje',    '8.33',  'Presentismo como % del sueldo básico'),
  ('presentismo_max_tardanzas', '3',     'Tardanzas que hacen perder el presentismo'),
  ('presentismo_max_ausencias', '1',     'Ausencias injustificadas que hacen perder el presentismo'),
  ('hora_extra_50_factor',      '1.5',   'Factor de hora extra al 50% (días hábiles)'),
  ('hora_extra_100_factor',     '2.0',   'Factor de hora extra al 100% (feriados/domingos)'),
  ('eval_ponderacion_asistencia', '40',  'Peso % de asistencia en la evaluación de desempeño'),
  ('eval_ponderacion_tareas',     '40',  'Peso % de tareas en la evaluación de desempeño'),
  ('eval_ponderacion_manual',     '20',  'Peso % de la evaluación manual del dueño')
on conflict (clave) do nothing;

-- Verificación: deben salir las 10 claves, ninguna con valor null.
--   select clave, valor from public.rrhh_config order by clave;

notify pgrst, 'reload schema';
