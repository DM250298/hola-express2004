-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  264 · Tareas v2: registro de cambios y pedidos de quitar           ║
-- ║  (Etapa 1 · bloque B)                                                ║
-- ║                                                                     ║
-- ║   · tareas_eventos: cada cambio de una tarea o de la rutina (quién, ║
-- ║     cuándo, en nombre de quién, antes y después). Nadie lo edita ni ║
-- ║     lo borra, tampoco el administrador ni el dueño de la base desde ║
-- ║     la app. Lo lee el administrador; la encargada y el empleado ven ║
-- ║     el historial de cada tarea por una función (más adelante).      ║
-- ║   · tareas_pedidos: "pedir que se quite" de la encargada. Se         ║
-- ║     resuelve una sola vez (pendiente → aprobado / rechazado) y solo ║
-- ║     desde la función del administrador. Nunca se borra.              ║
-- ║                                                                     ║
-- ║  Las tablas nacen vacías y nada las escribe todavía: no cambia nada ║
-- ║  visible. Requiere la 261 y la 263. Se puede correr de nuevo.        ║
-- ║  Última línea del archivo: "notify pgrst, 'reload schema';"          ║
-- ╚════════════════════════════════════════════════════════════════════╝

set local lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.fn_trg_registro_inmutable()') is null
     or to_regtype('public.tarea_evento_tipo') is null then
    raise exception '264: faltan la 261 o la 263.';
  end if;
end $$;

-- ─── 1. Registro de cambios ─────────────────────────────────────────────
create table if not exists public.tareas_eventos (
  id                  bigint generated always as identity primary key,
  created_at          timestamptz not null default clock_timestamp(),
  transaccion         bigint not null default txid_current(),
  entidad             text not null check (entidad in ('agenda', 'rutina', 'pedido', 'turno', 'sistema')),
  tipo                public.tarea_evento_tipo not null,
  -- Sin FK a propósito: el evento sobrevive aunque la tarea cambie o no exista.
  tarea_turno_id      uuid,
  tarea_recurrente_id uuid,
  pedido_id           bigint,
  turno_id            integer,
  -- Foto del momento, para mostrar y para decidir quién lo ve.
  fecha               date,
  titulo              text,
  privada             boolean not null default false,
  duenos              integer[] not null default '{}',
  -- Quién (null = sistema, se muestra "HEX") y en nombre de quién.
  actor_usuario_id    uuid,
  actor_empleado_id   integer,
  actor_nombre        text,
  en_nombre_de        integer[] not null default '{}',
  antes               jsonb,
  despues             jsonb,
  motivo              text,
  origen              text,
  check (entidad = 'sistema' or tarea_turno_id is not null or tarea_recurrente_id is not null
         or pedido_id is not null or turno_id is not null)
);

create index if not exists tareas_eventos_tarea_idx on public.tareas_eventos (tarea_turno_id, created_at);
create index if not exists tareas_eventos_rutina_idx on public.tareas_eventos (tarea_recurrente_id, created_at);
create index if not exists tareas_eventos_fecha_idx on public.tareas_eventos (created_at desc);
create index if not exists tareas_eventos_dia_idx on public.tareas_eventos (fecha);

alter table public.tareas_eventos enable row level security;
drop policy if exists tareas_eventos_select on public.tareas_eventos;
create policy tareas_eventos_select on public.tareas_eventos
  for select to authenticated using ((select public.fn_tiene_permiso('tareas_admin')));

revoke insert, update, delete, truncate, references, trigger
  on public.tareas_eventos from public, anon, authenticated, service_role;

drop trigger if exists trg_tareas_eventos_inmutable on public.tareas_eventos;
create trigger trg_tareas_eventos_inmutable
  before update or delete on public.tareas_eventos
  for each row execute function public.fn_trg_registro_inmutable();
drop trigger if exists trg_tareas_eventos_sin_truncate on public.tareas_eventos;
create trigger trg_tareas_eventos_sin_truncate
  before truncate on public.tareas_eventos
  for each statement execute function public.fn_trg_registro_inmutable();
alter table public.tareas_eventos enable always trigger trg_tareas_eventos_inmutable;
alter table public.tareas_eventos enable always trigger trg_tareas_eventos_sin_truncate;

-- ─── 2. Pedidos de quitar de la rutina ──────────────────────────────────
create table if not exists public.tareas_pedidos (
  id                  bigint generated always as identity primary key,
  created_at          timestamptz not null default now(),
  tarea_recurrente_id uuid not null references public.tareas_recurrentes(id),
  tipo                text not null default 'quitar' check (tipo in ('quitar')),
  motivo              text,
  pedido_por          uuid references public.usuarios(id),
  pedido_por_empleado integer references public.empleados(id) on delete set null,
  estado              public.tarea_pedido_estado not null default 'pendiente',
  resuelto_por        uuid references public.usuarios(id),
  resuelto_at         timestamptz,
  nota_resolucion     text
);

create unique index if not exists tareas_pedidos_pendiente_uq
  on public.tareas_pedidos (tarea_recurrente_id, tipo) where estado = 'pendiente';

alter table public.tareas_pedidos enable row level security;
drop policy if exists tareas_pedidos_select on public.tareas_pedidos;
create policy tareas_pedidos_select on public.tareas_pedidos
  for select to authenticated using (
    (select public.fn_tiene_permiso('tareas_admin'))
    or ((select public.fn_tiene_permiso('tareas_gestion')) and pedido_por = (select auth.uid())));

revoke insert, update, delete, truncate, references, trigger
  on public.tareas_pedidos from public, anon, authenticated, service_role;

-- Un pedido no se borra nunca y solo cambia una vez: de pendiente a
-- aprobado o rechazado, y solo dentro de fn_pedido_resolver (que marca
-- la sesión con hex.pedido_resolver).
create or replace function public.fn_trg_tareas_pedidos_guarda()
returns trigger language plpgsql as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'Los pedidos no se borran.';
  end if;
  if coalesce(current_setting('hex.pedido_resolver', true), '') <> 'on'
     or old.estado <> 'pendiente'
     or new.estado not in ('aprobado', 'rechazado')
     or (new.id, new.created_at, new.tarea_recurrente_id, new.tipo, new.motivo,
         new.pedido_por, new.pedido_por_empleado)
        is distinct from
        (old.id, old.created_at, old.tarea_recurrente_id, old.tipo, old.motivo,
         old.pedido_por, old.pedido_por_empleado) then
    raise exception 'Un pedido solo se resuelve una vez, desde la aprobación del administrador.';
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_trg_tareas_pedidos_guarda() from public, anon, authenticated;

drop trigger if exists trg_tareas_pedidos_guarda on public.tareas_pedidos;
create trigger trg_tareas_pedidos_guarda
  before update or delete on public.tareas_pedidos
  for each row execute function public.fn_trg_tareas_pedidos_guarda();
drop trigger if exists trg_tareas_pedidos_sin_truncate on public.tareas_pedidos;
create trigger trg_tareas_pedidos_sin_truncate
  before truncate on public.tareas_pedidos
  for each statement execute function public.fn_trg_registro_inmutable();
alter table public.tareas_pedidos enable always trigger trg_tareas_pedidos_guarda;
alter table public.tareas_pedidos enable always trigger trg_tareas_pedidos_sin_truncate;

-- ─── 3. Verificación ────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.tareas_eventos') is null or to_regclass('public.tareas_pedidos') is null then
    raise exception '264: faltan las tablas.';
  end if;
  if (select count(*) from pg_trigger where tgname in ('trg_tareas_eventos_inmutable',
        'trg_tareas_eventos_sin_truncate', 'trg_tareas_pedidos_guarda',
        'trg_tareas_pedidos_sin_truncate') and tgenabled = 'A') <> 4 then
    raise exception '264: faltan triggers o no quedaron en ENABLE ALWAYS.';
  end if;
  if has_table_privilege('authenticated', 'public.tareas_eventos', 'INSERT')
     or has_table_privilege('authenticated', 'public.tareas_eventos', 'DELETE')
     or has_table_privilege('authenticated', 'public.tareas_pedidos', 'UPDATE') then
    raise exception '264: quedaron permisos de escritura abiertos.';
  end if;
end $$;

notify pgrst, 'reload schema';
