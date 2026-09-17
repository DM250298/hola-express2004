-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 183 · Alertas y acción (Fase F, 1/7): tablas y reglas    ║
-- ║                                                                     ║
-- ║  HEX SUGIERE, NO ORDENA. Una alerta = una condición detectada sobre ║
-- ║  un producto o un lote. Nunca se "cierra a mano": se resuelve sola  ║
-- ║  cuando la condición desaparece. La persona decide qué hacer:       ║
-- ║   · crear una tarea (módulo proyectos, con responsable), o          ║
-- ║   · posponerla N días (si sigue, vuelve a aparecer).                ║
-- ║  Trazabilidad en la misma fila: detectada → decisión (quién, qué)   ║
-- ║  → tarea (responsable, hecha) → resuelta.                           ║
-- ║                                                                     ║
-- ║  · reglas_alerta: tipos CODIFICADOS (no hay DSL) con severidad,     ║
-- ║    activa y parámetros editables desde la UI.                       ║
-- ║  · alertas: 1 fila por condición; índice único parcial sobre las    ║
-- ║    no resueltas → imposible duplicar.                               ║
-- ║  · alertas_evaluaciones: log de cada corrida del evaluador.         ║
-- ║                                                                     ║
-- ║  Las 3 tablas se leen/escriben SOLO por RPC (detalle trae costos):  ║
-- ║  RLS activo; reglas_alerta se puede leer con permiso 'alertas'.     ║
-- ║                                                                     ║
-- ║  Permiso nuevo 'alertas' → admin y encargado.                       ║
-- ║  Después: types/database.ts (ReglaAlerta*, Alerta*, Tables).        ║
-- ║  Ejecutar UNA sola vez, COMPLETO. Última línea: el SELECT final.    ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. Reglas ───────────────────────────────────────────────────────
create table if not exists public.reglas_alerta (
  codigo text primary key,
  nombre text not null,
  descripcion text not null,
  severidad text not null
    check (severidad in ('critico', 'atencion', 'oportunidad', 'informativo')),
  activa boolean not null default true,
  parametros jsonb not null default '{}'::jsonb,
  orden integer not null default 0,
  updated_by uuid references public.usuarios(id),
  updated_at timestamptz not null default now()
);

-- ─── 2. Alertas ──────────────────────────────────────────────────────
create table if not exists public.alertas (
  id bigserial primary key,
  regla_codigo text not null references public.reglas_alerta(codigo),
  severidad text not null
    check (severidad in ('critico', 'atencion', 'oportunidad', 'informativo')),
  dedupe_key text not null,
  entidad_tipo text not null check (entidad_tipo in ('producto', 'lote')),
  entidad_id integer not null,
  producto_id integer references public.productos(id) on delete cascade,
  grupo text,
  titulo text not null,
  detalle jsonb not null default '{}'::jsonb,
  -- Orden de prioridad dentro del grupo (en pesos cuando se puede).
  impacto numeric,
  estado text not null default 'abierta'
    check (estado in ('abierta', 'en_curso', 'pospuesta', 'resuelta')),
  detectada_at timestamptz not null default now(),
  ultima_deteccion_at timestamptz not null default now(),
  -- Decisión humana
  decision text check (decision in ('tarea', 'posponer')),
  decidida_por uuid references public.usuarios(id),
  decidida_at timestamptz,
  nota_decision text,
  pospuesta_hasta date,
  tarea_id integer references public.tareas(id) on delete set null,
  -- Resultado
  resuelta_at timestamptz,
  resolucion text check (resolucion in ('condicion_superada', 'regla_desactivada')),
  constraint alertas_resuelta_chk check (
    (estado = 'resuelta') = (resuelta_at is not null)
  )
);

create unique index if not exists alertas_viva_uidx
  on public.alertas (dedupe_key) where estado <> 'resuelta';
create index if not exists alertas_estado_idx
  on public.alertas (estado, severidad);
create index if not exists alertas_tarea_idx
  on public.alertas (tarea_id) where tarea_id is not null;
create index if not exists alertas_resuelta_idx
  on public.alertas (resuelta_at) where estado = 'resuelta';

-- ─── 3. Log de evaluaciones ──────────────────────────────────────────
create table if not exists public.alertas_evaluaciones (
  id bigserial primary key,
  inicio_at timestamptz not null default now(),
  fin_at timestamptz,
  origen text not null,               -- cron | auto | manual
  usuario_id uuid references public.usuarios(id),
  nuevas integer,
  resueltas integer,
  reaparecidas integer,
  vivas integer,
  error text
);

create index if not exists alertas_evaluaciones_fin_idx
  on public.alertas_evaluaciones (fin_at desc);

-- ─── 4. RLS: todo por RPC; reglas legibles con 'alertas' ─────────────
alter table public.reglas_alerta enable row level security;
alter table public.alertas enable row level security;
alter table public.alertas_evaluaciones enable row level security;

drop policy if exists "reglas_lectura" on public.reglas_alerta;
create policy "reglas_lectura" on public.reglas_alerta
  for select to authenticated
  using ((select public.fn_tiene_permiso('alertas')));

-- ─── 5. Seed de reglas (conservador: pocas y de alta señal) ──────────
insert into public.reglas_alerta
  (codigo, nombre, descripcion, severidad, activa, parametros, orden)
values
  ('quiebre_clave', 'Productos clave sin stock',
   'Productos que más venden (clase A) o marcados como críticos que hoy no tienen stock.',
   'critico', true, '{"clases": ["A"], "incluir_criticos": true}', 10),
  ('por_quebrar', 'Se quedan sin stock pronto',
   'Al ritmo de venta de los últimos 30 días, el stock alcanza para menos de los días indicados.',
   'atencion', true, '{"dias_cobertura": 3, "clases": ["A"]}', 20),
  ('vencimiento_proximo', 'Lotes por vencer',
   'Lotes con unidades que vencen dentro de los días indicados (o ya vencidos).',
   'atencion', true, '{"dias": 7}', 30),
  ('margen_bajo', 'Precio por debajo del margen mínimo',
   'Productos con ventas en 30 días cuyo precio actual deja un margen menor al mínimo sobre el costo actual.',
   'atencion', true, '{"margen_minimo_pct": 0}', 40),
  ('inmovilizado', 'Mercadería sin vender',
   'Productos con stock que no se venden hace más de los días indicados y cuyo stock a costo supera el valor mínimo.',
   'oportunidad', true, '{"dias_sin_venta": 45, "valor_minimo": 20000}', 50),
  ('sobrestock', 'Stock de más',
   'Productos que se venden pero cuyo stock cubre más de los días indicados.',
   'oportunidad', false, '{"dias_cobertura": 90, "valor_minimo": 50000}', 60),
  ('sin_costo', 'Productos sin costo cargado',
   'Productos que se vendieron en 30 días y no tienen costo: su margen no se puede calcular.',
   'informativo', true, '{}', 70),
  ('sin_categoria', 'Productos sin categoría',
   'Productos que se vendieron en 30 días y no tienen categoría: quedan fuera del análisis por categoría.',
   'informativo', true, '{}', 80),
  ('sin_ubicacion', 'Productos que más venden sin ubicar',
   'Productos de las clases indicadas que no tienen ubicación principal en el mapa del local.',
   'informativo', false, '{"clases": ["A"]}', 90)
on conflict (codigo) do nothing;

-- ─── 6. Permiso 'alertas' para admin y encargado ─────────────────────
update public.roles
set permisos = array_append(permisos, 'alertas'),
    updated_at = now()
where codigo in ('admin', 'encargado')
  and not ('alertas' = any(permisos));

notify pgrst, 'reload schema';

-- Verificación (debe dar true, true, true, 9):
select
  to_regclass('public.reglas_alerta') is not null as reglas,
  to_regclass('public.alertas') is not null as alertas,
  to_regclass('public.alertas_evaluaciones') is not null as evaluaciones,
  (select count(*) from public.reglas_alerta) as cantidad_reglas;
