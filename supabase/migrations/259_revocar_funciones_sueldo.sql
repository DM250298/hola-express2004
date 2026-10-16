-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  259 · Sueldos: fn_sueldo y fn_set_sueldo dejan de ser públicas     ║
-- ║                                                                     ║
-- ║  La 085 quiso cerrarlas con "revoke ... from public", pero Supabase ║
-- ║  les da EXECUTE explícito a anon y authenticated, y ese revoke no   ║
-- ║  lo saca. El relevamiento de Tareas v2 (2026-10-16) lo confirmó en  ║
-- ║  prueba: anon = true, authenticated = true. Como son SECURITY       ║
-- ║  DEFINER y no chequean permisos, cualquiera con la clave pública    ║
-- ║  de la app (sin iniciar sesión) podía leer y cambiar sueldos por    ║
-- ║  /rest/v1/rpc, salteando la RLS de empleado_sueldo.                 ║
-- ║                                                                     ║
-- ║  No rompe nada: el front lee y escribe empleado_sueldo directo      ║
-- ║  (con RLS rrhh_sueldos) y el único llamador SQL es                  ║
-- ║  fn_generar_liquidacion, SECURITY DEFINER (corre como dueño).       ║
-- ║                                                                     ║
-- ║  Correr en las DOS bases. Se puede correr más de una vez.           ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"         ║
-- ╚════════════════════════════════════════════════════════════════════╝

revoke execute on function public.fn_sueldo(integer) from public, anon, authenticated;
revoke execute on function public.fn_set_sueldo(integer, numeric) from public, anon, authenticated;

-- Verificación: si alguna sigue abierta, el pegado entero se deshace.
do $$
begin
  if has_function_privilege('anon', 'public.fn_sueldo(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.fn_sueldo(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.fn_set_sueldo(integer,numeric)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.fn_set_sueldo(integer,numeric)', 'EXECUTE')
  then
    raise exception '259: fn_sueldo / fn_set_sueldo siguen ejecutables desde la app.';
  end if;
end $$;

-- Para mirar a mano después (tiene que dar false en las cuatro columnas):
-- select has_function_privilege('anon', 'public.fn_sueldo(integer)', 'EXECUTE') as anon_lee,
--        has_function_privilege('authenticated', 'public.fn_sueldo(integer)', 'EXECUTE') as app_lee,
--        has_function_privilege('anon', 'public.fn_set_sueldo(integer,numeric)', 'EXECUTE') as anon_escribe,
--        has_function_privilege('authenticated', 'public.fn_set_sueldo(integer,numeric)', 'EXECUTE') as app_escribe;

notify pgrst, 'reload schema';
