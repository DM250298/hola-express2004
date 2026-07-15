-- ─────────────────────────────────────────────────────────────────────
-- 111: Performance RLS — fn_tiene_permiso como InitPlan.
--
-- Las policies llaman public.fn_tiene_permiso('permiso') directo en
-- USING/WITH CHECK. Postgres no puede inlinear plpgsql, así que la
-- evalúa POR FILA (y adentro hace 2 selects: usuarios + roles). Con
-- ~85 policies y tablas calientes como costos_producto (embebida en
-- cada listado de productos: POS, inventario, compras, etiquetas...)
-- eso multiplica miles de ejecuciones por query.
--
-- Envuelta en un scalar subquery — (select fn_tiene_permiso('x')) —
-- el planner la convierte en InitPlan: UNA sola evaluación por query.
-- Es la recomendación oficial de Supabase para policies con funciones.
--
-- Este DO recorre pg_policies EN RUNTIME (el repo no es fuente completa
-- del estado real de policies) y reescribe cada USING/WITH CHECK que
-- llame fn_tiene_permiso sin envolver. Detalles:
--   · wrap POR LLAMADA (no del qual entero): en policies compuestas
--     (ej. egresos_select) la otra rama referencia columnas de la fila
--     y envolver todo rompería la correlación.
--   · idempotente: saltea quals que ya tienen (select fn_tiene_permiso.
--   · qual/with_check NULL según el comando (SELECT/DELETE sin check,
--     INSERT sin using): solo se emite la cláusula que corresponde.
--   · incluye schema storage (policies de buckets de 068/073/085/089);
--     si el rol del SQL Editor no es owner de storage.objects, se
--     reporta y se sigue (correr esas a mano con el dashboard si pasa).
-- ─────────────────────────────────────────────────────────────────────

do $$
declare
  r record;
  v_qual text;
  v_check text;
  v_sql text;
  v_alteradas int := 0;
  v_saltadas int := 0;
  -- pg_get_expr puede decompiler con o sin prefijo "public." según search_path
  v_patron constant text := '(public\.)?fn_tiene_permiso\(([^)]*)\)';
  v_reemplazo constant text := '(select public.fn_tiene_permiso(\2))';
  v_ya_envuelto constant text := '\(\s*select\s+(public\.)?fn_tiene_permiso';
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname in ('public', 'storage')
      and (
        coalesce(qual, '') ~ 'fn_tiene_permiso'
        or coalesce(with_check, '') ~ 'fn_tiene_permiso'
      )
  loop
    v_qual := case
      when r.qual is not null and r.qual !~* v_ya_envuelto
        then regexp_replace(r.qual, v_patron, v_reemplazo, 'g')
      else r.qual
    end;
    v_check := case
      when r.with_check is not null and r.with_check !~* v_ya_envuelto
        then regexp_replace(r.with_check, v_patron, v_reemplazo, 'g')
      else r.with_check
    end;

    if v_qual is not distinct from r.qual
       and v_check is not distinct from r.with_check then
      continue; -- nada que cambiar (ya envuelta)
    end if;

    v_sql := format(
      'alter policy %I on %I.%I',
      r.policyname, r.schemaname, r.tablename
    );
    if v_qual is not null then
      v_sql := v_sql || format(' using (%s)', v_qual);
    end if;
    if v_check is not null then
      v_sql := v_sql || format(' with check (%s)', v_check);
    end if;

    begin
      execute v_sql;
      v_alteradas := v_alteradas + 1;
      raise notice 'initplan ✓ %.% — %', r.schemaname, r.tablename, r.policyname;
    exception when insufficient_privilege then
      v_saltadas := v_saltadas + 1;
      raise notice 'initplan ✗ SIN PERMISO %.% — % (correr a mano)',
        r.schemaname, r.tablename, r.policyname;
    end;
  end loop;

  raise notice 'RLS initplan: % policies reescritas, % saltadas por permisos',
    v_alteradas, v_saltadas;
end $$;

-- Verificación (opcional, correr aparte):
--   select schemaname, tablename, policyname
--   from pg_policies
--   where coalesce(qual,'') ~ 'fn_tiene_permiso'
--     and coalesce(qual,'') !~* '\(\s*select\s+(public\.)?fn_tiene_permiso';
--   → debe devolver 0 filas en public (storage puede requerir mano).
-- Y un EXPLAIN sobre una tabla gateada debe mostrar "InitPlan 1":
--   explain select * from costos_producto limit 5;

notify pgrst, 'reload schema';
