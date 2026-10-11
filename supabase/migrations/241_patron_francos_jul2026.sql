-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 241 · Datos: patrón "Francos mañana/tarde" (jul-2026)    ║
-- ║                                                                     ║
-- ║  Carga el patrón del "Cronograma de Francos — Hola Express" vigente ║
-- ║  del dom 19/7/2026 en adelante:                                     ║
-- ║   · Semana domingo → sábado. Viernes: local lleno, nadie descansa.  ║
-- ║   · 6 personas, un franco semanal cada una. El día de franco rota   ║
-- ║     Dom → Lun → Mié → Mar → Jue → Sáb → Dom (finde Sáb+Dom          ║
-- ║     rotativo cada 6 semanas).                                       ║
-- ║   · Alan cubre como comodín (pivote).                               ║
-- ║  Semana 1 (ancla dom 19/7/2026): Dom Camila · Lun Sonia · Mar Tomas ║
-- ║  · Mié Alan · Jue Rebeca · Sáb Agustin → en orden de slots          ║
-- ║  (Dom, Lun, Mié, Mar, Jue, Sáb): Camila, Sonia, Alan, Tomas,        ║
-- ║  Rebeca, Agustin.                                                   ║
-- ║                                                                     ║
-- ║  Los empleados se buscan por nombre (primer nombre, sin distinguir  ║
-- ║  mayúsculas ni tildes). Si alguno no existe o hay más de uno con    ║
-- ║  ese nombre, la migración FALLA y no carga nada: corregir el legajo ║
-- ║  y volver a correrla. Los turnos de cada uno salen del Manual §3    ║
-- ║  (mañana: Camila, Agustín, Sonia; tarde: Rebeca, Tomás) — revisar   ║
-- ║  en Personal › Cronograma › Patrones antes de generar.              ║
-- ║  Idempotente: si ya existe un patrón con ese nombre, no hace nada.  ║
-- ║  REQUIERE: migs 236, 239 y 240. Primero PRUEBA, después PRODUCCIÓN. ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
declare
  v_nombre constant text := 'Francos mañana/tarde (desde 19/7/2026)';
  v_manana integer;
  v_tarde integer;
  v_patron integer;
  -- [nombre, turno]: en orden de slots Dom, Lun, Mié, Mar, Jue, Sáb
  v_lista text[][] := array[
    ['Camila',  'manana'],
    ['Sonia',   'manana'],
    ['Alan',    null],       -- pivote: cubre el turno del que descansa
    ['Tomas',   'tarde'],
    ['Rebeca',  'tarde'],
    ['Agustin', 'manana']
  ];
  v_ids integer[] := '{}';
  v_id integer;
  v_n integer;
  v_i integer;
begin
  if exists (select 1 from public.patrones_cronograma where nombre = v_nombre) then
    raise notice 'El patrón "%" ya existe: no se carga de nuevo.', v_nombre;
    return;
  end if;

  select id into v_manana from public.turnos_plantilla where nombre = 'manana';
  select id into v_tarde  from public.turnos_plantilla where nombre = 'tarde';
  if v_manana is null or v_tarde is null then
    raise exception 'Faltan los turnos manana/tarde en turnos_plantilla (mig 087).';
  end if;

  -- Resolver cada nombre a un legajo activo, sin ambigüedad.
  for v_i in 1..array_length(v_lista, 1) loop
    select count(*), min(id) into v_n, v_id
    from public.empleados
    where activo
      and lower(translate(split_part(trim(nombre), ' ', 1), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))
          = lower(translate(v_lista[v_i][1], 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'));
    if v_n = 0 then
      raise exception 'No hay un empleado activo llamado "%". Cargalo o corregí el nombre en el legajo.', v_lista[v_i][1];
    elsif v_n > 1 then
      raise exception 'Hay % empleados activos llamados "%": no se puede elegir solo.', v_n, v_lista[v_i][1];
    end if;
    v_ids := v_ids || v_id;
  end loop;

  insert into public.patrones_cronograma
    (nombre, tipo, turno_id, fecha_ancla, orden_dias, pivote_empleado_id, notas)
  values (
    v_nombre, 'franco_rotativo', null, date '2026-07-19',
    '{0,1,3,2,4,6}',           -- Dom, Lun, Mié, Mar, Jue, Sáb (viernes todos trabajan)
    v_ids[3],                  -- Alan
    'Cronograma de Francos jul–nov 2026. Semana domingo→sábado, viernes local lleno, finde Sáb+Dom rotativo.'
  ) returning id into v_patron;

  for v_i in 1..array_length(v_lista, 1) loop
    insert into public.patron_cronograma_miembros (patron_id, empleado_id, orden, turno_id)
    values (
      v_patron, v_ids[v_i], v_i,
      case v_lista[v_i][2] when 'manana' then v_manana when 'tarde' then v_tarde else null end
    );
  end loop;

  raise notice 'Patrón % cargado con % miembros (id %).', v_nombre, array_length(v_ids, 1), v_patron;
end $$;

notify pgrst, 'reload schema';
