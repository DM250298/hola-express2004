-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 070 · Cierra la PII de la tienda online                   ║
-- ║                                                                      ║
-- ║  pedidos_tienda e items_pedido_tienda tenían SELECT `anon using(true)`║
-- ║  → cualquiera con la anon key (pública, viaja en el browser) podía    ║
-- ║  leer nombre, teléfono, email, dirección y pedido de TODOS los        ║
-- ║  clientes online.                                                     ║
-- ║                                                                      ║
-- ║  Estas tablas SOLO las usan los route handlers `/api/tienda/*`, que   ║
-- ║  ahora corren con SERVICE ROLE (bypassa RLS). Por eso se quitan TODAS ║
-- ║  las policies y se deja RLS habilitado SIN policy: nadie accede por   ║
-- ║  la API (ni anon ni authenticated), solo el service role del server.  ║
-- ║                                                                      ║
-- ║  ⚠️  CORRER DESPUÉS de que Vercel haya deployado el cambio de código   ║
-- ║  (route handlers a service-role). Si se corre antes, el catálogo y el ║
-- ║  checkout de la tienda dejan de funcionar hasta que termine el deploy.║
-- ║                                                                      ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.      ║
-- ╚════════════════════════════════════════════════════════════════════╝

do $$
declare v_pol text; v_tab text;
begin
  foreach v_tab in array array['pedidos_tienda', 'items_pedido_tienda'] loop
    for v_pol in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = v_tab
    loop
      execute format('drop policy %I on public.%I', v_pol, v_tab);
    end loop;
    execute format('alter table public.%I enable row level security', v_tab);
  end loop;
end $$;

notify pgrst, 'reload schema';
