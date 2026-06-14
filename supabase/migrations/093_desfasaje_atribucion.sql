-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 093 · Atribución del desfasaje a quien cierra la orden    ║
-- ║                                                                     ║
-- ║  El desfasaje (consumo real vs receta) se carga al CERRAR la orden, ║
-- ║  así que se atribuye a quien la cerró. Se agrega usuario_cierre a   ║
-- ║  ordenes_produccion; la app lo setea tras el RPC de cierre (NO se   ║
-- ║  toca fn_cerrar_orden_produccion, que es la función crítica de      ║
-- ║  stock/costeo). La vista de desfasajes expone responsable_id =      ║
-- ║  coalesce(usuario_cierre, usuario_id) → las órdenes ya cerradas     ║
-- ║  caen al usuario que las inició. El nombre se resuelve en cliente.  ║
-- ║                                                                     ║
-- ║  Prerequisitos: mig 084 (vista_desfasajes_produccion). Idempotente. ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1. Quién cerró la orden (atribución del desfasaje)
-- ─────────────────────────────────────────────────────────────────────
alter table public.ordenes_produccion
  add column if not exists usuario_cierre uuid references public.usuarios(id);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Vista de desfasajes con responsable_id (coalesce cierre → inicio)
-- ─────────────────────────────────────────────────────────────────────
drop view if exists public.vista_desfasajes_produccion;
create view public.vista_desfasajes_produccion
with (security_invoker = on) as
select
  iop.id,
  iop.orden_id,
  op.producto_id            as elaborado_id,
  pe.nombre                 as elaborado_nombre,
  iop.insumo_id,
  pi.nombre                 as insumo_nombre,
  pi.unidad                 as insumo_unidad,
  iop.cantidad_consumida    as teorico,
  iop.cantidad_real         as real_usado,
  (iop.cantidad_real - iop.cantidad_consumida)                       as diferencia,
  iop.costo_unitario,
  ((iop.cantidad_real - iop.cantidad_consumida) * iop.costo_unitario) as diferencia_costo,
  iop.motivo_desfasaje,
  op.usuario_id,
  op.usuario_cierre,
  coalesce(op.usuario_cierre, op.usuario_id) as responsable_id,
  op.fecha_cierre
from public.items_orden_prod iop
join public.ordenes_produccion op on op.id = iop.orden_id
join public.productos pe on pe.id = op.producto_id
join public.productos pi on pi.id = iop.insumo_id
where op.estado = 'cerrada'
  and iop.cantidad_real is not null
  and iop.cantidad_real <> iop.cantidad_consumida;

grant select on public.vista_desfasajes_produccion to authenticated;

notify pgrst, 'reload schema';
