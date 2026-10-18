-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Script (NO migración) · La rutina de los 3 turnos rige desde el    ║
-- ║  MARTES 20/10 y la agenda de martes a domingo queda armada          ║
-- ║  (pedido de Damián, 2026-10-18).                                    ║
-- ║                                                                     ║
-- ║  Correr primero en PRUEBA y después en PRODUCCIÓN (HEX-V1).         ║
-- ║  Todo en un solo bloque: si algo falla, no cambia nada.             ║
-- ║   · Las 51 tareas (T004…T151) pasan de "rige desde el 19/10" a      ║
-- ║     "desde el 20/10". Queda en el registro de cambios.              ║
-- ║   · El lunes 19 queda sin tareas: se sacan las 44 pendientes que    ║
-- ║     nadie tocó (las empezadas o editadas a mano no se tocan).       ║
-- ║   · Se arma la agenda del 20 al 25 según el cronograma, sin         ║
-- ║     duplicar. Si el cronograma cambia, se reacomoda sola.           ║
-- ║  Se frena si el lunes 19 ya empezó (07:00). Se puede correr de      ║
-- ║  nuevo. Última línea del archivo: "order by 1;"                      ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
declare
  r record; v_n integer := 0; d integer; v_lunes integer;
  v_esperado integer[] := array[42, 43, 43, 42, 42, 41];  -- martes 20 … domingo 25 (tabla del Paso 3)
  v_real integer;
begin
  if now() >= public.fn_tarea_inicio_turno('2026-10-19',
       (select id from public.turnos_plantilla where nombre::text = 'manana')) then
    raise exception 'El lunes 19 ya empezó: no se cambió nada.';
  end if;
  if (select count(*) from public.tareas_recurrentes where codigo ~ '^T[0-9]{3}$' and activa) <> 51 then
    raise exception 'No están las 51 tareas de la rutina: no se cambió nada.';
  end if;

  for r in
    update public.tareas_recurrentes x set vigencia_desde = '2026-10-20', updated_at = now()
     where x.codigo ~ '^T[0-9]{3}$' and x.vigencia_desde is distinct from '2026-10-20'
    returning x.id
  loop
    perform public.fn_tarea_evento('editada', null, r.id, '{"vigencia_desde": "2026-10-19"}'::jsonb,
      '{"vigencia_desde": "2026-10-20"}'::jsonb, 'La rutina de los 3 turnos rige desde el martes 20/10', 'carga_rutina');
    v_n := v_n + 1;
  end loop;

  -- Lunes: se sacan las que ya no aplican. Martes a domingo: se arman.
  perform public.fn_tareas_sincronizar('2026-10-19');
  for d in 20..25 loop
    perform public.fn_tareas_sincronizar(make_date(2026, 10, d));
  end loop;

  select count(*) into v_lunes from public.tareas_turno t
    join public.tareas_recurrentes x on x.id = t.plantilla_id
   where t.fecha = '2026-10-19' and x.codigo ~ '^T[0-9]{3}$';
  if v_lunes > 0 then
    raise exception 'Quedaron % tareas el lunes (alguien las empezó o editó): no se cambió nada.', v_lunes;
  end if;
  for d in 20..25 loop
    select count(distinct t.plantilla_id) into v_real from public.tareas_turno t
      join public.tareas_recurrentes x on x.id = t.plantilla_id
     where t.fecha = make_date(2026, 10, d) and x.codigo ~ '^T[0-9]{3}$';
    if v_real <> v_esperado[d - 19] then
      raise exception 'El % quedaron % tareas (tienen que ser %): no se cambió nada.',
        make_date(2026, 10, d), v_real, v_esperado[d - 19];
    end if;
  end loop;
  raise notice 'Listo: % tareas pasaron a regir desde el 20/10; agenda del 20 al 25 armada.', v_n;
end $$;

-- Resultado: tareas por día y turno (lunes 19 en 0; martes a domingo como la tabla del Paso 3).
select t.fecha, to_char(t.fecha, 'Dy') as dia,
       count(distinct t.plantilla_id) filter (where tp.nombre::text = 'manana') as manana,
       count(distinct t.plantilla_id) filter (where tp.nombre::text = 'tarde') as tarde,
       count(distinct t.plantilla_id) filter (where tp.nombre::text = 'noche') as noche,
       count(distinct t.plantilla_id) as total
from public.tareas_turno t
join public.turnos_plantilla tp on tp.id = t.turno_id
join public.tareas_recurrentes x on x.id = t.plantilla_id and x.codigo ~ '^T[0-9]{3}$'
where t.fecha between '2026-10-19' and '2026-10-25'
group by t.fecha
order by 1;
