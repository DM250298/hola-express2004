-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 247 · fn_generar_cronograma v3 (bloques alternados)      ║
-- ║                                                                     ║
-- ║  Base: v2 (mig 240) íntegra + tipo 'bloques_alternados' (mig 246):  ║
-- ║  N personas se turnan en bloques de `bloque_dias` días corridos     ║
-- ║  desde el ancla (1º el primer bloque, 2º el siguiente, en rueda);   ║
-- ║  el resto tiene franco. Es el turno noche real desde oct-2026:      ║
-- ║  semanas de jueves a miércoles, 7 días corridos cada uno.           ║
-- ║  Misma firma que v1/v2 → create or replace, sin sobrecargas.        ║
-- ║  REQUIERE: migs 240 y 246. Ejecutar UNA sola vez. PRUEBA → PROD.    ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_generar_cronograma(
  p_patron_id integer,
  p_desde date,
  p_hasta date,
  p_sobrescribir boolean default false,
  p_aplicar boolean default false
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_pat public.patrones_cronograma;
  v_miembros integer[];      -- empleado_id ordenados por orden
  v_turnos integer[];        -- turno de cada miembro (mismo índice)
  v_n integer;
  v_fecha date;
  v_k integer;               -- semanas desde el ancla (puede ser negativo)
  v_i integer;               -- 0 = lunes … 6 = domingo (isodow − 1)
  v_p integer;               -- posición dentro de la semana (0..6 desde el ancla)
  v_s integer;               -- slot de franco (1-based) o null = nadie descansa
  v_idx integer;
  v_franco integer;
  v_j integer;
  v_emp integer;
  v_turno integer;
  v_estado public.estado_horario;
  v_notas text;
  v_nombre text;
  v_puesto text;
  v_existente public.horarios_asignados;
  v_accion text;
  v_filas jsonb := '[]'::jsonb;
  v_creados integer := 0;
  v_reempl integer := 0;
  v_omit integer := 0;
  v_semana_a boolean;
  v_grupo1 boolean;
  v_bloque integer;   -- bloques_alternados: índice del bloque desde el ancla
begin
  if not public.fn_tiene_permiso('rrhh') then
    raise exception 'Sin permiso para generar el cronograma.';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Rango de fechas inválido.';
  end if;
  if p_hasta - p_desde > 91 then
    raise exception 'Generá como máximo 13 semanas por vez.';
  end if;

  select * into v_pat from public.patrones_cronograma where id = p_patron_id;
  if not found then raise exception 'El patrón no existe.'; end if;
  if not v_pat.activo then raise exception 'El patrón está inactivo.'; end if;

  select array_agg(m.empleado_id order by m.orden),
         array_agg(coalesce(m.turno_id, v_pat.turno_id) order by m.orden)
  into v_miembros, v_turnos
  from public.patron_cronograma_miembros m
  join public.empleados e on e.id = m.empleado_id and e.activo
  where m.patron_id = p_patron_id;
  v_n := coalesce(array_length(v_miembros, 1), 0);

  if v_pat.tipo = 'franco_rotativo' then
    if v_n < 2 then raise exception 'El patrón necesita al menos 2 miembros activos.'; end if;
    if array_length(v_pat.orden_dias, 1) <> v_n then
      raise exception 'El patrón tiene % días con franco por semana pero % miembros: tienen que coincidir (un franco por persona por semana).',
        array_length(v_pat.orden_dias, 1), v_n;
    end if;
    for v_j in 1..v_n loop
      if v_turnos[v_j] is null and v_miembros[v_j] is distinct from v_pat.pivote_empleado_id then
        raise exception 'Falta el turno habitual de un miembro (y el patrón no tiene turno por defecto).';
      end if;
    end loop;
  elsif v_pat.tipo = 'noche_ab' then
    if v_n <> 2 then raise exception 'El patrón noche A/B necesita exactamente 2 miembros activos.'; end if;
    if v_pat.turno_id is null then raise exception 'El patrón noche A/B necesita turno.'; end if;
    if extract(isodow from v_pat.fecha_ancla) <> 1 then
      raise exception 'En noche A/B el ancla tiene que ser el lunes de la semana A.';
    end if;
  elsif v_pat.tipo = 'bloques_alternados' then
    if v_n < 2 then raise exception 'El patrón de bloques alternados necesita al menos 2 miembros activos.'; end if;
    if v_pat.turno_id is null then raise exception 'El patrón de bloques alternados necesita turno.'; end if;
    if coalesce(v_pat.bloque_dias, 0) < 1 then raise exception 'El patrón necesita la cantidad de días por bloque.'; end if;
  else
    raise exception 'Tipo de patrón desconocido: %', v_pat.tipo;
  end if;

  v_fecha := p_desde;
  while v_fecha <= p_hasta loop
    v_k := floor((v_fecha - v_pat.fecha_ancla)::numeric / 7)::integer;
    v_i := extract(isodow from v_fecha)::integer - 1;
    v_p := mod(mod(v_fecha - v_pat.fecha_ancla, 7) + 7, 7);
    v_s := array_position(v_pat.orden_dias, v_p);
    if v_s is not null then
      v_idx := mod(mod((v_s - 1) - v_k, v_n) + v_n, v_n) + 1;   -- 1-based
      v_franco := v_miembros[v_idx];
    else
      v_franco := null;   -- día sin franco: todos trabajan
    end if;

    for v_j in 1..v_n loop
      v_emp := v_miembros[v_j];
      v_notas := null;

      if v_pat.tipo = 'franco_rotativo' then
        if v_franco is not null and v_emp = v_franco then
          v_estado := 'franco'; v_turno := null;
        elsif v_franco is not null and v_emp = v_pat.pivote_empleado_id then
          -- El pivote cubre el turno del que descansa.
          v_turno := v_turnos[v_idx];
          v_estado := 'planificado';
          select e.nombre || coalesce(' ' || e.apellido, ''), e.puesto
          into v_nombre, v_puesto from public.empleados e where e.id = v_franco;
          v_notas := 'Cubre a ' || v_nombre || coalesce(' (' || v_puesto || ')', '');
        else
          -- Día normal (o día sin franco para todos). El pivote sin turno
          -- propio ni por defecto no tiene a quién cubrir: no se genera fila.
          v_estado := 'planificado'; v_turno := v_turnos[v_j];
          if v_turno is null then continue; end if;
        end if;
      elsif v_pat.tipo = 'noche_ab' then
        v_semana_a := mod(mod(v_k, 2) + 2, 2) = 0;
        v_grupo1 := v_i in (0, 1, 2, 6);           -- Lun Mar Mié Dom
        -- 1º miembro trabaja grupo1 en semana A y grupo2 en semana B.
        if (v_j = 1) = (v_semana_a = v_grupo1) then
          v_estado := 'planificado'; v_turno := v_pat.turno_id;
        else
          v_estado := 'franco'; v_turno := null;
        end if;
      else
        -- bloques_alternados: el 1º trabaja los primeros `bloque_dias` días
        -- desde el ancla, el 2º los siguientes, y así en rueda; los demás
        -- tienen franco.
        v_bloque := floor((v_fecha - v_pat.fecha_ancla)::numeric / v_pat.bloque_dias)::integer;
        if v_j = mod(mod(v_bloque, v_n) + v_n, v_n) + 1 then
          v_estado := 'planificado'; v_turno := v_pat.turno_id;
        else
          v_estado := 'franco'; v_turno := null;
        end if;
      end if;

      select * into v_existente from public.horarios_asignados
      where empleado_id = v_emp and fecha = v_fecha;
      if not found then
        v_accion := 'crear';
      elsif p_sobrescribir and v_existente.patron_id = p_patron_id then
        v_accion := 'reemplazar';
      else
        v_accion := 'omitir';
      end if;

      if p_aplicar and v_accion = 'crear' then
        insert into public.horarios_asignados
          (empleado_id, turno_id, fecha, estado, notas, usuario_id, patron_id)
        values (v_emp, v_turno, v_fecha, v_estado, v_notas, v_uid, p_patron_id);
      elsif p_aplicar and v_accion = 'reemplazar' then
        update public.horarios_asignados
        set turno_id = v_turno, estado = v_estado, notas = v_notas, usuario_id = v_uid
        where id = v_existente.id;
      end if;

      if v_accion = 'crear' then v_creados := v_creados + 1;
      elsif v_accion = 'reemplazar' then v_reempl := v_reempl + 1;
      else v_omit := v_omit + 1; end if;

      v_filas := v_filas || jsonb_build_object(
        'empleado_id', v_emp, 'fecha', v_fecha, 'turno_id', v_turno,
        'estado', v_estado::text, 'notas', v_notas, 'accion', v_accion
      );
    end loop;
    v_fecha := v_fecha + 1;
  end loop;

  if p_aplicar then
    perform public.fn_auditar(
      v_uid, 'generar_cronograma', 'patron_cronograma', p_patron_id,
      jsonb_build_object('desde', p_desde, 'hasta', p_hasta,
        'creados', v_creados, 'reemplazados', v_reempl, 'omitidos', v_omit)
    );
  end if;

  return jsonb_build_object(
    'creados', v_creados, 'reemplazados', v_reempl, 'omitidos', v_omit,
    'filas', v_filas
  );
end;
$$;

revoke execute on function public.fn_generar_cronograma(integer, date, date, boolean, boolean) from public, anon;
grant execute on function public.fn_generar_cronograma(integer, date, date, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';

-- Chequeo T1 (debe dar 0 filas):
-- select proname, count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
-- where n.nspname='public' and proname like 'fn_%' group by proname having count(*)>1;
