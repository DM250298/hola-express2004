-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 003: agregar pedido_origen_id a lotes                    ║
-- ║                                                                     ║
-- ║  Permite rastrear de qué pedido vino un lote — para reimprimir      ║
-- ║  etiquetas o auditar el origen. Es nullable porque hay lotes que    ║
-- ║  se crean por carga manual (ModalNuevoLote), no por recepción.      ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez en SQL Editor de Supabase.                   ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.lotes
  add column if not exists pedido_origen_id integer
    references public.pedidos(id) on delete set null;

create index if not exists lotes_pedido_origen_idx
  on public.lotes(pedido_origen_id);
