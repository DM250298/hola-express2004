-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 143 · Autoservicio del empleado: mi cuenta corriente     ║
-- ║                                                                     ║
-- ║  PROBLEMA: el empleado no puede ver su propia cuenta corriente ni   ║
-- ║  sus adelantos/descuentos. Las tablas están gateadas por RLS        ║
-- ║  (cuenta_corriente_empleado → 'rrhh', novedades_empleado →          ║
-- ║  'rrhh_sueldos') y ABRIR esas policies sería riesgoso:              ║
-- ║   · la policy de cta. cte. es `for all` — una auto-lectura mal      ║
-- ║     partida dejaría al empleado BORRANDO su propia deuda            ║
-- ║   · novedades incluye bono/otro (haberes del recibo) — filtrarlos   ║
-- ║     dentro de una policy es frágil y se pierde en el próximo gate   ║
-- ║                                                                     ║
-- ║  SOLUCIÓN: RPCs `security definer` de superficie mínima, resueltas  ║
-- ║  por auth.uid() (el empleado solo puede verse a sí mismo):          ║
-- ║   · fn_mi_empleado_id()    → legajo del usuario logueado            ║
-- ║   · fn_mi_saldo_cta_cte()  → saldo actual                           ║
-- ║   · fn_mi_cta_cte(limite)  → movimientos (consumos, pagos, dtos.)   ║
-- ║   · fn_mis_novedades(per)  → SOLO tipos 'adelanto' y 'descuento'.   ║
-- ║     NUNCA bono/otro, ni el básico, ni el neto: el empleado ve lo    ║
-- ║     que le van a descontar, no su recibo.                           ║
-- ║  Sin usuario vinculado (empleados.usuario_id null) devuelven        ║
-- ║  vacío/0 → la UI muestra el mensaje de "sin legajo" existente.      ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. Legajo del usuario logueado ──────────────────────────────────
create or replace function public.fn_mi_empleado_id()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select id from public.empleados
  where usuario_id = auth.uid()
  limit 1;
$$;

-- ─── 2. Mi saldo de cuenta corriente ─────────────────────────────────
create or replace function public.fn_mi_saldo_cta_cte()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(monto), 0)
  from public.cuenta_corriente_empleado
  where empleado_id = public.fn_mi_empleado_id();
$$;

-- ─── 3. Mis movimientos de cuenta corriente ──────────────────────────
create or replace function public.fn_mi_cta_cte(p_limite integer default 100)
returns table (
  id integer,
  fecha date,
  tipo text,
  concepto text,
  monto numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.fecha, c.tipo, c.concepto, c.monto
  from public.cuenta_corriente_empleado c
  where c.empleado_id = public.fn_mi_empleado_id()
  order by c.fecha desc, c.id desc
  limit greatest(1, coalesce(p_limite, 100));
$$;

-- ─── 4. Mis adelantos y descuentos (nunca haberes) ───────────────────
create or replace function public.fn_mis_novedades(p_periodo text default null)
returns table (
  id integer,
  fecha date,
  periodo text,
  tipo text,
  concepto text,
  monto numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.fecha, n.periodo, n.tipo, n.concepto, n.monto
  from public.novedades_empleado n
  where n.empleado_id = public.fn_mi_empleado_id()
    and n.tipo in ('adelanto', 'descuento')
    and (p_periodo is null or n.periodo = p_periodo)
  order by n.fecha desc, n.id desc;
$$;

-- ─── 5. Grants ───────────────────────────────────────────────────────
revoke execute on function public.fn_mi_empleado_id()      from anon;
revoke execute on function public.fn_mi_saldo_cta_cte()    from anon;
revoke execute on function public.fn_mi_cta_cte(integer)   from anon;
revoke execute on function public.fn_mis_novedades(text)   from anon;
grant  execute on function public.fn_mi_empleado_id()      to authenticated;
grant  execute on function public.fn_mi_saldo_cta_cte()    to authenticated;
grant  execute on function public.fn_mi_cta_cte(integer)   to authenticated;
grant  execute on function public.fn_mis_novedades(text)   to authenticated;

notify pgrst, 'reload schema';
