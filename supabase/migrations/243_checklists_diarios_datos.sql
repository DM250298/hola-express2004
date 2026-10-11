-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 243 · Datos: checklists diarios por turno como tareas    ║
-- ║                                                                     ║
-- ║  Carga las tareas recurrentes (todos los días) de la planilla       ║
-- ║  "Sistema Operativo" hojas 03/04/05 (checklist mañana, tarde y      ║
-- ║  noche), asignadas por rol según el organigrama (mig 242):          ║
-- ║   · Mañana: Sonia (resp. general: pase, incidencias), Camila        ║
-- ║     (caja, precios, conteo, ambiente), Agustín (producción e        ║
-- ║     insumos); reposición/limpieza/vencimientos/recepción grupales.  ║
-- ║   · Tarde: Rebeca (encargada: pase, precios, recepción,             ║
-- ║     incidencias), Tomás (limpieza, vencimientos, producción,        ║
-- ║     depósito); reposición grupal.                                   ║
-- ║   · Noche: todas grupales entre Fabricio y Juan Ignacio (trabaja    ║
-- ║     uno solo por noche; el que tiene franco queda afuera gracias a  ║
-- ║     la mig 244).                                                    ║
-- ║  Los nombres se resuelven como en la 242 (primer nombre, activos);  ║
-- ║  si falta alguien, la tarea se carga igual sin ese asignado y se    ║
-- ║  avisa (se completa después desde Tareas › Recurrentes).            ║
-- ║  Idempotente: no duplica una plantilla con el mismo título y turno. ║
-- ║  REQUIERE: migs 158 y 229. Primero PRUEBA, después PRODUCCIÓN.      ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function pg_temp.fn_emp_por_nombre(p_nombre text) returns integer
language plpgsql as $$
declare v_n integer; v_id integer;
begin
  select count(*), min(id) into v_n, v_id from public.empleados
  where activo
    and lower(translate(split_part(trim(nombre), ' ', 1), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))
        = lower(translate(split_part(trim(p_nombre), ' ', 1), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'));
  if v_n = 1 then return v_id; end if;
  raise notice 'Checklists: "%" no encontrado o repetido (% coincidencias): la tarea queda sin ese asignado.', p_nombre, v_n;
  return null;
end $$;

create or replace function pg_temp.fn_cargar_tarea(
  p_turno text, p_titulo text, p_modo text, p_prioridad text, p_asignados text[], p_descripcion text default null
) returns void language plpgsql as $$
declare v_turno integer; v_id uuid; v_nombre text; v_emp integer; v_k integer := 0;
begin
  select id into v_turno from public.turnos_plantilla where nombre = p_turno::public.nombre_turno;
  if v_turno is null then raise exception 'Falta el turno % en turnos_plantilla.', p_turno; end if;
  if exists (select 1 from public.tareas_recurrentes where titulo = p_titulo and turno_id = v_turno) then
    return;
  end if;
  insert into public.tareas_recurrentes
    (titulo, descripcion, turno_id, dias_semana, prioridad, requiere_evidencia, activa,
     alcance, modo, tipo_recurrencia)
  values
    (p_titulo, p_descripcion, v_turno, '{0,1,2,3,4,5,6}', p_prioridad::public.prioridad_tarea, false, true,
     'empleados', p_modo::public.modo_tarea, 'dias_semana')
  returning id into v_id;
  foreach v_nombre in array p_asignados loop
    v_emp := pg_temp.fn_emp_por_nombre(v_nombre);
    if v_emp is not null then
      insert into public.tareas_recurrentes_asignados (plantilla_id, empleado_id)
      values (v_id, v_emp) on conflict do nothing;
      v_k := v_k + 1;
    end if;
  end loop;
  if v_k = 0 then
    raise notice 'Checklists: "%" (%) quedó SIN asignados: completar desde Tareas › Recurrentes.', p_titulo, p_turno;
  end if;
end $$;

-- ─── Mañana (07:00–15:00) ────────────────────────────────────────────
select pg_temp.fn_cargar_tarea('manana', 'Validar pase recibido del turno noche y marcar conformidad', 'individual', 'alta', '{Sonia}',
  'Marcar conforme / no conforme cada bloque del pase en Pase de turno.');
select pg_temp.fn_cargar_tarea('manana', 'Verificar orden y limpieza inicial del salón, caja, fiambrería y zonas críticas', 'grupal', 'media', '{Camila,Agustín}');
select pg_temp.fn_cargar_tarea('manana', 'Controlar insumos críticos de producción antes de producir', 'individual', 'alta', '{Agustín}',
  'Si falta algo, informar primero al encargado (que valida y eleva a Compras).');
select pg_temp.fn_cargar_tarea('manana', 'Iniciar producción a más tardar a las 07:20', 'individual', 'alta', '{Agustín}');
select pg_temp.fn_cargar_tarea('manana', 'Registrar producción realizada en el sistema (hecho / no hecho vs. plan)', 'individual', 'media', '{Agustín}');
select pg_temp.fn_cargar_tarea('manana', 'Verificar reposición de góndolas y heladeras', 'grupal', 'media', '{Camila,Agustín}',
  'Primero góndola, heladera y exhibidor; solo el excedente va al depósito.');
select pg_temp.fn_cargar_tarea('manana', 'Verificar precios visibles y correctos; corregir en el momento', 'individual', 'media', '{Camila}');
select pg_temp.fn_cargar_tarea('manana', 'Ejecutar el conteo cíclico del sector asignado del día', 'individual', 'media', '{Camila}',
  'Contar físico y cargar la diferencia. Quien cuenta NO ajusta stock.');
select pg_temp.fn_cargar_tarea('manana', 'Controlar vencimientos del sector asignado del día', 'grupal', 'media', '{Camila,Agustín}',
  'Retirar vencidos y anticipar acción sobre los próximos a vencer.');
select pg_temp.fn_cargar_tarea('manana', 'Procesar recepciones de mercadería y asegurar guardado / reposición', 'grupal', 'media', '{Camila,Agustín}',
  'La mercadería no se guarda ni se exhibe hasta cerrar la recepción en el sistema.');
select pg_temp.fn_cargar_tarea('manana', 'Mantener música / ambiente, orden y limpieza acordes', 'individual', 'baja', '{Camila}');
select pg_temp.fn_cargar_tarea('manana', 'Registrar incidencias y pendientes del turno', 'individual', 'media', '{Sonia}');
select pg_temp.fn_cargar_tarea('manana', 'Completar el pase de turno a la tarde', 'individual', 'alta', '{Sonia}',
  'Reposición, orden y limpieza, novedades y pendientes con responsable.');

-- ─── Tarde (15:00–23:00) ─────────────────────────────────────────────
select pg_temp.fn_cargar_tarea('tarde', 'Validar pase recibido del turno mañana y revisar pendientes', 'individual', 'alta', '{Rebeca}');
select pg_temp.fn_cargar_tarea('tarde', 'Mantener reposición continua de góndolas y heladeras', 'grupal', 'media', '{Rebeca,Tomás}');
select pg_temp.fn_cargar_tarea('tarde', 'Verificar precios visibles y correctos; corregir en el momento', 'individual', 'media', '{Rebeca}');
select pg_temp.fn_cargar_tarea('tarde', 'Mantener orden y limpieza del salón y sectores operativos', 'individual', 'media', '{Tomás}');
select pg_temp.fn_cargar_tarea('tarde', 'Controlar el sector asignado de vencimientos', 'individual', 'media', '{Tomás}');
select pg_temp.fn_cargar_tarea('tarde', 'Revisar suficiencia de producción y elevar necesidad de refuerzo', 'individual', 'media', '{Tomás}');
select pg_temp.fn_cargar_tarea('tarde', 'Procesar recepciones de mercadería y asegurar guardado / reposición', 'individual', 'media', '{Rebeca}');
select pg_temp.fn_cargar_tarea('tarde', 'Controlar el orden del depósito al cierre del turno', 'individual', 'media', '{Tomás}');
select pg_temp.fn_cargar_tarea('tarde', 'Registrar incidencias y pendientes con responsable', 'individual', 'media', '{Rebeca}');
select pg_temp.fn_cargar_tarea('tarde', 'Completar el pase de turno a la noche', 'individual', 'alta', '{Rebeca}');

-- ─── Noche (23:00–07:00): trabaja uno solo, todas grupales ───────────
select pg_temp.fn_cargar_tarea('noche', 'Validar pase recibido del turno tarde', 'grupal', 'alta', '{Fabricio,"Juan Ignacio"}');
select pg_temp.fn_cargar_tarea('noche', 'Atender clientes y registrar todas las ventas según procedimiento de caja', 'grupal', 'alta', '{Fabricio,"Juan Ignacio"}');
select pg_temp.fn_cargar_tarea('noche', 'Mantener orden y limpieza de caja, salón y sectores de uso del personal', 'grupal', 'media', '{Fabricio,"Juan Ignacio"}');
select pg_temp.fn_cargar_tarea('noche', 'Control visual del local y registro de incidencias de seguridad / operación', 'grupal', 'media', '{Fabricio,"Juan Ignacio"}');
select pg_temp.fn_cargar_tarea('noche', 'Informar faltantes críticos como incidencia (sin hacer conteos de inventario)', 'grupal', 'media', '{Fabricio,"Juan Ignacio"}');
select pg_temp.fn_cargar_tarea('noche', 'Registrar pendientes relevantes para el turno mañana', 'grupal', 'media', '{Fabricio,"Juan Ignacio"}');
select pg_temp.fn_cargar_tarea('noche', 'Completar el pase de turno a la mañana', 'grupal', 'alta', '{Fabricio,"Juan Ignacio"}');

drop function if exists pg_temp.fn_cargar_tarea(text, text, text, text, text[], text);
drop function if exists pg_temp.fn_emp_por_nombre(text);

notify pgrst, 'reload schema';

-- Verificación (30 plantillas, con sus asignados):
--   select t.nombre as turno, r.titulo, r.modo, string_agg(e.nombre, ', ' order by e.nombre) as asignados
--   from public.tareas_recurrentes r join public.turnos_plantilla t on t.id = r.turno_id
--   left join public.tareas_recurrentes_asignados a on a.plantilla_id = r.id
--   left join public.empleados e on e.id = a.empleado_id
--   group by t.nombre, r.titulo, r.modo order by t.nombre, r.titulo;
