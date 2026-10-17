-- Prueba de Tareas v2 (Etapa 5): nadie edita ni borra el registro de cambios,
-- los pedidos, los avisos ni los resúmenes semanales.
--
-- Intenta cada cosa como un administrador, una encargada y un empleado reales
-- (los primeros que encuentra), como service_role y como el dueño de la base.
-- Cada intento corre en una subtransacción que se deshace siempre: aunque algo
-- pasara, no queda ningún cambio. Correr en cada base (requiere la 293–295).
--
-- Resultado esperado: todo "bloqueado". "sin filas para probar" quiere decir que
-- la tabla está vacía (por ejemplo, todavía no hubo avisos ni resúmenes): no es
-- un problema, se puede repetir más adelante.

create temp table if not exists _prueba_registro (quien text, intento text, resultado text);
truncate _prueba_registro;
grant insert on _prueba_registro to authenticated, service_role;

do $$
declare
  v_quien record;
  v_sql text;
  v_filas integer;
  v_intentos text[] := array[
    'update public.tareas_eventos set motivo = motivo where id = (select max(id) from public.tareas_eventos)',
    'delete from public.tareas_eventos where id = (select max(id) from public.tareas_eventos)',
    'insert into public.tareas_eventos (entidad, tipo) values (''sistema'', ''creada'')',
    'truncate public.tareas_eventos',
    'update public.tareas_pedidos set motivo = motivo where id = (select max(id) from public.tareas_pedidos)',
    'delete from public.tareas_pedidos where id = (select max(id) from public.tareas_pedidos)',
    'update public.tareas_avisos set titulo = titulo where id = (select max(id) from public.tareas_avisos)',
    'delete from public.tareas_avisos where id = (select max(id) from public.tareas_avisos)',
    'truncate public.tareas_avisos',
    'update public.tareas_resumenes set datos = datos where semana_desde = (select max(semana_desde) from public.tareas_resumenes)',
    'delete from public.tareas_resumenes where semana_desde = (select max(semana_desde) from public.tareas_resumenes)'];
begin
  for v_quien in
    select * from (
      (select 'administrador' as quien, u.id, 'authenticated' as rol from public.usuarios u
        where u.activo and u.rol = 'admin' order by u.nombre limit 1)
      union all
      (select 'encargada', u.id, 'authenticated' from public.usuarios u join public.roles r on r.codigo = u.rol
        where u.activo and u.rol <> 'admin' and 'tareas_gestion' = any(r.permisos) order by u.nombre limit 1)
      union all
      (select 'empleado', u.id, 'authenticated' from public.usuarios u join public.roles r on r.codigo = u.rol
        where u.activo and 'mi_panel' = any(r.permisos) and not 'tareas_gestion' = any(r.permisos)
        order by u.nombre limit 1)
      union all select 'service_role', null, 'service_role'
      union all select 'dueño de la base', null, null) x
  loop
    foreach v_sql in array v_intentos loop
      -- Las funciones de la base escriben el registro como dueño: insertar es su trabajo.
      continue when v_quien.rol is null and v_sql like 'insert%';
      v_filas := null;
      begin
        perform set_config('request.jwt.claims',
          case when v_quien.id is null then '' else json_build_object('sub', v_quien.id, 'role', v_quien.rol)::text end, true);
        if v_quien.rol is not null then
          execute format('set role %I', v_quien.rol);
        end if;
        execute v_sql;
        get diagnostics v_filas = row_count;
        raise exception using errcode = 'P0099', message = 'pasó';
      exception
        when sqlstate 'P0099' then
          reset role;
          insert into _prueba_registro values (v_quien.quien, v_sql,
            case when v_filas = 0 and v_sql not like 'insert%' and v_sql not like 'truncate%'
                 then 'sin filas para probar' else 'ABIERTO ⚠️' end);
        when others then
          reset role;
          insert into _prueba_registro values (v_quien.quien, v_sql, 'bloqueado');
      end;
    end loop;
  end loop;
  perform set_config('request.jwt.claims', '', true);
end $$;

select quien, resultado, count(*) as intentos,
       string_agg(case when resultado <> 'bloqueado' then intento end, ' | ') as abiertos
from _prueba_registro
group by quien, resultado
order by quien, resultado;
