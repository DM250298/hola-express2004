-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 098 · Conteo Físico de Stock por zonas (sesiones)        ║
-- ║                                                                     ║
-- ║  Módulo nuevo, convive con conteos/conteos_items (008). Permite     ║
-- ║  contar todo el local con el negocio abierto:                       ║
-- ║   · conteo_sesiones  → una sesión global con snapshot del teórico   ║
-- ║   · conteo_snapshot  → stock teórico al abrir (gateado por RLS:     ║
-- ║                        garantiza el conteo CIEGO a nivel de base)   ║
-- ║   · conteo_zonas     → góndolas/heladeras/depósito con responsable  ║
-- ║   · conteo_detalle   → lo contado por zona (upsert) + reconteos     ║
-- ║                                                                     ║
-- ║  Compensación por ventas: la diferencia se calcula contra el        ║
-- ║  teórico esperado = snapshot + Σ(deltas de movimientos_stock en la  ║
-- ║  ventana apertura→cierre). Eso cubre ventas, recepciones, mermas,   ║
-- ║  devoluciones y producción — todo lo que mueve stock_actual.        ║
-- ║                                                                     ║
-- ║  Ajuste final vía fn_cerrar_sesion_conteo: movimientos tipo         ║
-- ║  'ajuste_conteo' + lotes FEFO (faltante consume el más viejo,       ║
-- ║  sobrante repone al más nuevo — mismo criterio que venta/anular).   ║
-- ║  El stock NUNCA se edita directo.                                   ║
-- ║                                                                     ║
-- ║  Permiso nuevo: 'conteo_cierre' (admin implícito + encargado).      ║
-- ║                                                                     ║
-- ║  ⚠️ Prerequisito: migración 097 (enum 'ajuste_conteo') ya corrida.  ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1 · Tablas ──────────────────────────────────────────────────────

create table if not exists public.conteo_sesiones (
  id serial primary key,
  nombre text not null,
  estado text not null default 'abierta'
    check (estado in ('abierta', 'en_revision', 'cerrada')),
  abierta_por uuid not null references public.usuarios(id),
  cerrada_por uuid references public.usuarios(id),
  ts_apertura timestamptz not null default now(),
  ts_cierre timestamptz,
  umbral_pesos numeric(12,2) not null default 5000,
  -- El POS opera offline: no hay forma server-side de validar que todas las
  -- cajas sincronizaron (no existe tabla de heartbeat por terminal). El
  -- cierre exige la confirmación explícita del admin y acá queda registrada.
  sync_confirmado boolean not null default false,
  notas text,
  created_at timestamptz not null default now()
);

-- Solo puede haber UNA sesión sin cerrar a la vez (a prueba de carreras).
create unique index if not exists conteo_sesiones_una_abierta
  on public.conteo_sesiones ((true)) where estado <> 'cerrada';

create table if not exists public.conteo_snapshot (
  sesion_id integer not null references public.conteo_sesiones(id) on delete cascade,
  producto_id integer not null references public.productos(id),
  stock_teorico numeric(12,3) not null,
  ts_snapshot timestamptz not null default now(),
  primary key (sesion_id, producto_id)
);

create table if not exists public.conteo_zonas (
  id serial primary key,
  sesion_id integer not null references public.conteo_sesiones(id) on delete cascade,
  nombre text not null,
  responsable_user_id uuid references public.usuarios(id),
  -- Usuario designado para hacer los reconteos de esta zona (tiene que ser
  -- distinto del que contó originalmente; eso lo valida fn_registrar_conteo).
  reconteo_user_id uuid references public.usuarios(id),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'en_curso', 'cerrada')),
  ts_inicio timestamptz,
  ts_fin timestamptz,
  orden integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists conteo_zonas_sesion_idx on public.conteo_zonas(sesion_id);

create table if not exists public.conteo_detalle (
  id serial primary key,
  zona_id integer not null references public.conteo_zonas(id) on delete cascade,
  producto_id integer not null references public.productos(id),
  cantidad_contada numeric(12,3) not null check (cantidad_contada >= 0),
  contado_por uuid not null references public.usuarios(id),
  ts timestamptz not null default now(),
  es_reconteo boolean not null default false,
  -- Marcado por fn_solicitar_reconteo sobre la fila original; el reconteo
  -- queda "pendiente" hasta que exista la fila hermana con es_reconteo.
  reconteo_pedido boolean not null default false,
  observacion text,
  created_at timestamptz not null default now()
);

-- Una fila original y a lo sumo una de reconteo por (zona, producto).
create unique index if not exists conteo_detalle_original_unq
  on public.conteo_detalle(zona_id, producto_id) where not es_reconteo;
create unique index if not exists conteo_detalle_reconteo_unq
  on public.conteo_detalle(zona_id, producto_id) where es_reconteo;
create index if not exists conteo_detalle_zona_idx on public.conteo_detalle(zona_id);
create index if not exists conteo_detalle_producto_idx on public.conteo_detalle(producto_id);

-- ─── 2 · Permiso nuevo: conteo_cierre (solo admin/encargado) ─────────
-- El admin pasa por el bypass hardcodeado de fn_tiene_permiso.

update public.roles
   set permisos = permisos || '{conteo_cierre}',
       updated_at = now()
 where codigo = 'encargado'
   and not (permisos @> '{conteo_cierre}');

-- ─── 3 · RLS ─────────────────────────────────────────────────────────
-- Sin policies de escritura: TODA escritura pasa por las fn_* de abajo
-- (security definer). Lectura:
--  · conteo_sesiones → gestores todo; el resto del staff (permiso
--    'inventario') solo ve sesiones no cerradas (para el banner y para
--    saber en qué sesión están sus zonas).
--  · conteo_zonas / conteo_detalle → gestores, el responsable de la zona
--    o el designado para reconteo. Nunca exponen el teórico.
--  · conteo_snapshot → SOLO 'conteo_cierre'. Esto es lo que garantiza el
--    conteo ciego a nivel de base, no solo de UI.

alter table public.conteo_sesiones enable row level security;
alter table public.conteo_snapshot enable row level security;
alter table public.conteo_zonas enable row level security;
alter table public.conteo_detalle enable row level security;

do $$ begin
  create policy "conteo_sesiones_select" on public.conteo_sesiones
    for select to authenticated
    using (
      public.fn_tiene_permiso('conteo_cierre')
      or (public.fn_tiene_permiso('inventario') and estado <> 'cerrada')
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "conteo_snapshot_select" on public.conteo_snapshot
    for select to authenticated
    using (public.fn_tiene_permiso('conteo_cierre'));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "conteo_zonas_select" on public.conteo_zonas
    for select to authenticated
    using (
      public.fn_tiene_permiso('conteo_cierre')
      or responsable_user_id = auth.uid()
      or reconteo_user_id = auth.uid()
      -- Zona sin responsable asignado: visible para el staff con 'inventario'
      -- mientras la sesión siga viva, para que cualquiera pueda reclamarla.
      or (
        responsable_user_id is null
        and public.fn_tiene_permiso('inventario')
        and exists (
          select 1 from public.conteo_sesiones s
          where s.id = conteo_zonas.sesion_id and s.estado <> 'cerrada'
        )
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "conteo_detalle_select" on public.conteo_detalle
    for select to authenticated
    using (
      public.fn_tiene_permiso('conteo_cierre')
      or exists (
        select 1 from public.conteo_zonas z
        where z.id = conteo_detalle.zona_id
          and (z.responsable_user_id = auth.uid() or z.reconteo_user_id = auth.uid())
      )
    );
exception when duplicate_object then null; end $$;

-- ─── 4 · fn_abrir_sesion_conteo ──────────────────────────────────────
-- Crea la sesión + snapshot de TODOS los productos activos que controlan
-- stock + las zonas del wizard. Falla si ya hay una sesión sin cerrar.
-- p_zonas: [{ "nombre": "Góndola 1", "responsable_user_id": "<uuid>|null", "orden": 0 }, ...]

drop function if exists public.fn_abrir_sesion_conteo(text, numeric, jsonb, text);
create or replace function public.fn_abrir_sesion_conteo(
  p_nombre text,
  p_umbral numeric default 5000,
  p_zonas jsonb default '[]'::jsonb,
  p_notas text default null
) returns public.conteo_sesiones
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sesion public.conteo_sesiones;
  v_zona jsonb;
  v_resp uuid;
  v_orden integer := 0;
  v_productos integer;
  v_ts timestamptz;
begin
  if v_uid is null then
    raise exception 'No se pudo identificar al usuario.';
  end if;
  if not public.fn_tiene_permiso('conteo_cierre') then
    raise exception 'No tenés permiso para abrir sesiones de conteo.';
  end if;
  if p_nombre is null or btrim(p_nombre) = '' then
    raise exception 'Poné un nombre a la sesión (ej. "Inventario Julio 2026").';
  end if;
  if p_zonas is null or jsonb_array_length(p_zonas) = 0 then
    raise exception 'Definí al menos una zona para contar.';
  end if;
  if exists (select 1 from public.conteo_sesiones where estado <> 'cerrada') then
    raise exception 'Ya hay una sesión de conteo en curso. Cerrala antes de abrir otra.';
  end if;

  -- El índice único parcial es la garantía real contra aperturas concurrentes;
  -- acá se traduce el duplicate_key a un mensaje entendible.
  begin
    insert into public.conteo_sesiones (nombre, estado, abierta_por, umbral_pesos, notas)
    values (btrim(p_nombre), 'abierta', v_uid, coalesce(p_umbral, 5000), p_notas)
    returning * into v_sesion;
  exception when unique_violation then
    raise exception 'Ya hay una sesión de conteo en curso. Cerrala antes de abrir otra.';
  end;

  -- Snapshot del teórico: todos los productos activos con control de stock.
  -- ts_apertura se fija con clock_timestamp() inmediatamente antes del INSERT
  -- para que el inicio de la ventana de compensación coincida con el snapshot
  -- MVCC de este statement (now() sería el inicio de la transacción y ventas
  -- commiteadas en el medio se compensarían doble). Limitación residual
  -- documentada: una venta EN VUELO (sin commitear) en este instante exacto
  -- queda fuera del snapshot y de la ventana → puede aparecer como faltante
  -- fantasma. Abrir la sesión en un momento tranquilo de caja.
  v_ts := clock_timestamp();
  insert into public.conteo_snapshot (sesion_id, producto_id, stock_teorico, ts_snapshot)
  select v_sesion.id, p.id, coalesce(p.stock_actual, 0), v_ts
    from public.productos p
   where p.activo and coalesce(p.controlar_stock, true);
  get diagnostics v_productos = row_count;

  update public.conteo_sesiones set ts_apertura = v_ts where id = v_sesion.id;
  v_sesion.ts_apertura := v_ts;

  for v_zona in select * from jsonb_array_elements(p_zonas) loop
    if v_zona->>'nombre' is null or btrim(v_zona->>'nombre') = '' then
      raise exception 'Todas las zonas necesitan un nombre.';
    end if;
    v_resp := nullif(v_zona->>'responsable_user_id', '')::uuid;
    if v_resp is not null
       and not exists (select 1 from public.usuarios where id = v_resp and activo) then
      raise exception 'El responsable de la zona "%" no es un usuario activo.', v_zona->>'nombre';
    end if;
    insert into public.conteo_zonas (sesion_id, nombre, responsable_user_id, orden)
    values (v_sesion.id, btrim(v_zona->>'nombre'), v_resp,
            coalesce(nullif(v_zona->>'orden', '')::integer, v_orden));
    v_orden := v_orden + 1;
  end loop;

  -- Auditoría best-effort: si fn_auditar no está en esta base (o cambió de
  -- firma), no debe tumbar la apertura del conteo.
  begin
    perform public.fn_auditar(v_uid, 'abrir_conteo_sesion', 'conteo_sesion', v_sesion.id,
      jsonb_build_object('nombre', v_sesion.nombre, 'zonas', jsonb_array_length(p_zonas),
                         'productos_snapshot', v_productos));
  exception when others then null; end;
  return v_sesion;
end;
$$;

-- ─── 5 · fn_iniciar_zona / fn_cerrar_zona ────────────────────────────

drop function if exists public.fn_iniciar_zona(integer);
create or replace function public.fn_iniciar_zona(p_zona_id integer)
returns public.conteo_zonas
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_zona public.conteo_zonas;
  v_sesion_estado text;
  v_gestor boolean;
begin
  if v_uid is null then
    raise exception 'No se pudo identificar al usuario.';
  end if;
  select * into v_zona from public.conteo_zonas where id = p_zona_id;
  if v_zona.id is null then
    raise exception 'La zona no existe.';
  end if;
  -- Orden de locks consistente en todo el módulo: SESIÓN primero, zona
  -- después (igual que fn_solicitar_reconteo y el cierre) — evita deadlocks.
  -- FOR SHARE: serializa contra el FOR UPDATE de fn_pasar_a_revision y
  -- fn_cerrar_sesion_conteo (no se puede iniciar una zona en el medio de un cierre).
  select estado into v_sesion_estado
    from public.conteo_sesiones where id = v_zona.sesion_id for share;
  if v_sesion_estado not in ('abierta', 'en_revision') then
    raise exception 'La sesión de conteo ya está cerrada.';
  end if;
  select * into v_zona from public.conteo_zonas where id = p_zona_id for update;

  v_gestor := public.fn_tiene_permiso('conteo_cierre');
  if v_zona.estado = 'pendiente' then
    -- Zona con responsable: solo él (o un gestor). Zona sin responsable: la
    -- reclama cualquier usuario del staff con permiso de inventario.
    if not v_gestor then
      if v_zona.responsable_user_id is not null and v_zona.responsable_user_id <> v_uid then
        raise exception 'Solo el responsable asignado puede iniciar esta zona.';
      end if;
      if v_zona.responsable_user_id is null and not public.fn_tiene_permiso('inventario') then
        raise exception 'No tenés permiso para contar inventario.';
      end if;
    end if;
  elsif v_zona.estado = 'cerrada' then
    -- Reabrir una zona cerrada (para corregir) es solo de gestores.
    if not v_gestor then
      raise exception 'La zona ya está cerrada. Pedile a un encargado que la reabra.';
    end if;
  else
    raise exception 'La zona ya está en curso.';
  end if;

  update public.conteo_zonas
     set estado = 'en_curso',
         ts_inicio = coalesce(ts_inicio, now()),
         ts_fin = null,
         -- Zona sin responsable: la reclama quien la inicia.
         responsable_user_id = coalesce(responsable_user_id, v_uid)
   where id = p_zona_id
   returning * into v_zona;
  return v_zona;
end;
$$;

drop function if exists public.fn_cerrar_zona(integer);
create or replace function public.fn_cerrar_zona(p_zona_id integer)
returns public.conteo_zonas
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_zona public.conteo_zonas;
begin
  if v_uid is null then
    raise exception 'No se pudo identificar al usuario.';
  end if;
  select * into v_zona from public.conteo_zonas where id = p_zona_id;
  if v_zona.id is null then
    raise exception 'La zona no existe.';
  end if;
  -- Sesión primero, zona después (orden de locks del módulo); FOR SHARE
  -- serializa contra pasar_a_revision/cierre (ver fn_iniciar_zona).
  perform 1 from public.conteo_sesiones where id = v_zona.sesion_id for share;
  select * into v_zona from public.conteo_zonas where id = p_zona_id for update;
  if v_zona.estado <> 'en_curso' then
    raise exception 'Solo se puede cerrar una zona en curso.';
  end if;
  if not public.fn_tiene_permiso('conteo_cierre')
     and v_zona.responsable_user_id is distinct from v_uid then
    raise exception 'Solo el responsable asignado puede cerrar esta zona.';
  end if;

  update public.conteo_zonas
     set estado = 'cerrada', ts_fin = now()
   where id = p_zona_id
   returning * into v_zona;
  return v_zona;
end;
$$;

-- ─── 6 · fn_registrar_conteo ─────────────────────────────────────────
-- Upsert por (zona, producto). El empleado carga el TOTAL contado en esa
-- zona (la UI acumula si escanea de a uno). Nunca devuelve ni compara
-- contra el teórico: el conteo es ciego.
-- Reconteo (p_es_reconteo=true): exige pedido previo de reconteo y que lo
-- haga una persona DISTINTA a la del conteo original de esa zona.

drop function if exists public.fn_registrar_conteo(integer, integer, numeric, text, boolean);
create or replace function public.fn_registrar_conteo(
  p_zona_id integer,
  p_producto_id integer,
  p_cantidad numeric,
  p_observacion text default null,
  p_es_reconteo boolean default false
) returns public.conteo_detalle
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_zona public.conteo_zonas;
  v_sesion public.conteo_sesiones;
  v_original public.conteo_detalle;
  v_detalle public.conteo_detalle;
  v_cant numeric;
  v_gestor boolean;
begin
  if v_uid is null then
    raise exception 'No se pudo identificar al usuario.';
  end if;
  if p_cantidad is null or p_cantidad < 0 then
    raise exception 'La cantidad contada no puede ser negativa.';
  end if;
  v_cant := round(p_cantidad, 3);

  select * into v_zona from public.conteo_zonas where id = p_zona_id;
  if v_zona.id is null then
    raise exception 'La zona no existe.';
  end if;
  -- FOR SHARE: un conteo no puede colarse en el medio de un cierre de sesión
  -- (el cierre toma FOR UPDATE de la sesión y recalcula las diferencias).
  select * into v_sesion from public.conteo_sesiones where id = v_zona.sesion_id for share;

  -- El producto tiene que estar en el snapshot de la sesión: si no está,
  -- no participa del cálculo de diferencias ni del ajuste.
  if not exists (
    select 1 from public.conteo_snapshot s
    where s.sesion_id = v_sesion.id and s.producto_id = p_producto_id
  ) then
    raise exception 'Ese producto no forma parte de esta sesión (se creó después de abrirla o no controla stock). Anotalo aparte.';
  end if;

  v_gestor := public.fn_tiene_permiso('conteo_cierre');

  if not p_es_reconteo then
    if v_sesion.estado = 'abierta' then
      null; -- ok
    elsif v_sesion.estado = 'en_revision' and v_gestor then
      null; -- gestores pueden corregir/completar durante la revisión
    else
      raise exception 'La sesión no admite más conteos en este estado.';
    end if;
    if v_zona.estado <> 'en_curso' then
      raise exception 'La zona no está en curso. Iniciala antes de contar.';
    end if;
    if not v_gestor and v_zona.responsable_user_id is distinct from v_uid then
      raise exception 'Solo el responsable asignado puede contar en esta zona.';
    end if;

    insert into public.conteo_detalle
      (zona_id, producto_id, cantidad_contada, contado_por, ts, es_reconteo, observacion)
    values (p_zona_id, p_producto_id, v_cant, v_uid, now(), false, nullif(btrim(coalesce(p_observacion, '')), ''))
    on conflict (zona_id, producto_id) where not es_reconteo
    do update set cantidad_contada = excluded.cantidad_contada,
                  contado_por = excluded.contado_por,
                  ts = excluded.ts,
                  observacion = excluded.observacion
    returning * into v_detalle;
  else
    if v_sesion.estado not in ('abierta', 'en_revision') then
      raise exception 'La sesión ya está cerrada.';
    end if;
    select * into v_original from public.conteo_detalle
     where zona_id = p_zona_id and producto_id = p_producto_id and not es_reconteo;
    if v_original.id is null or not v_original.reconteo_pedido then
      raise exception 'Ese producto no tiene reconteo solicitado en esta zona.';
    end if;
    if v_original.contado_por = v_uid then
      raise exception 'El reconteo lo tiene que hacer una persona distinta a la que contó originalmente.';
    end if;
    if not v_gestor
       and v_zona.reconteo_user_id is distinct from v_uid
       and v_zona.responsable_user_id is distinct from v_uid then
      raise exception 'No estás asignado para recontar en esta zona.';
    end if;

    insert into public.conteo_detalle
      (zona_id, producto_id, cantidad_contada, contado_por, ts, es_reconteo, observacion)
    values (p_zona_id, p_producto_id, v_cant, v_uid, now(), true, nullif(btrim(coalesce(p_observacion, '')), ''))
    on conflict (zona_id, producto_id) where es_reconteo
    do update set cantidad_contada = excluded.cantidad_contada,
                  contado_por = excluded.contado_por,
                  ts = excluded.ts,
                  observacion = excluded.observacion
    returning * into v_detalle;
  end if;

  return v_detalle;
end;
$$;

-- ─── 7 · fn_pasar_a_revision ─────────────────────────────────────────

drop function if exists public.fn_pasar_a_revision(integer);
create or replace function public.fn_pasar_a_revision(p_sesion_id integer)
returns public.conteo_sesiones
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sesion public.conteo_sesiones;
  v_abiertas integer;
begin
  if v_uid is null then
    raise exception 'No se pudo identificar al usuario.';
  end if;
  if not public.fn_tiene_permiso('conteo_cierre') then
    raise exception 'No tenés permiso para gestionar sesiones de conteo.';
  end if;
  select * into v_sesion from public.conteo_sesiones where id = p_sesion_id for update;
  if v_sesion.id is null then
    raise exception 'La sesión de conteo no existe.';
  end if;
  if v_sesion.estado <> 'abierta' then
    raise exception 'Solo una sesión abierta puede pasar a revisión.';
  end if;
  select count(*) into v_abiertas
    from public.conteo_zonas where sesion_id = p_sesion_id and estado <> 'cerrada';
  if v_abiertas > 0 then
    raise exception 'Hay % zona(s) sin cerrar. Cerralas antes de pasar a revisión.', v_abiertas;
  end if;

  update public.conteo_sesiones
     set estado = 'en_revision'
   where id = p_sesion_id
   returning * into v_sesion;
  return v_sesion;
end;
$$;

-- ─── 8 · fn_conteo_diferencias ───────────────────────────────────────
-- Reporte por producto: teórico snapshot, compensación de la ventana
-- (ventas, ingresos, otros movimientos), teórico esperado, total contado
-- (suma de zonas; el reconteo REEMPLAZA al original de su zona), diferencia
-- en unidades y en $ costo, y flag de relevante según umbrales:
--   |dif| > 5% del teórico esperado  Ó  |dif| × costo > umbral_pesos.
-- total_contado NULL = producto que no se contó en ninguna zona (NO se
-- ajusta al cerrar; se lista para que el admin decida).
-- Función (no vista) para poder gatearse por permiso: el teórico jamás
-- llega a un empleado.

drop function if exists public.fn_conteo_diferencias(integer);
create or replace function public.fn_conteo_diferencias(p_sesion_id integer)
returns table (
  producto_id integer,
  nombre text,
  codigo_barras text,
  stock_teorico numeric,
  ventas_rango numeric,
  ingresos_rango numeric,
  otros_rango numeric,
  teorico_esperado numeric,
  total_contado numeric,
  diferencia numeric,
  costo_unitario numeric,
  diferencia_pesos numeric,
  relevante boolean,
  reconteo_pendiente boolean,
  observaciones text[]
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_ses public.conteo_sesiones;
  v_hasta timestamptz;
begin
  if not public.fn_tiene_permiso('conteo_cierre') then
    raise exception 'No tenés permiso para ver las diferencias del conteo.';
  end if;
  select * into v_ses from public.conteo_sesiones cs where cs.id = p_sesion_id;
  if v_ses.id is null then
    raise exception 'La sesión de conteo no existe.';
  end if;
  -- clock_timestamp() (no now()): ts_apertura es clock-based, así que el fin
  -- de ventana también, para que la ventana nunca quede invertida dentro de
  -- una misma transacción (p.ej. el script de tests con rollback).
  v_hasta := coalesce(v_ses.ts_cierre, clock_timestamp());

  return query
  with movs as (
    select m.producto_id as prod_id,
           sum(m.stock_nuevo - m.stock_anterior) as delta_total,
           coalesce(sum(m.stock_anterior - m.stock_nuevo)
             filter (where m.tipo = 'venta'), 0) as ventas,
           coalesce(sum(m.stock_nuevo - m.stock_anterior)
             filter (where m.tipo in ('entrada', 'ingreso_produccion')), 0) as ingresos
      from public.movimientos_stock m
     where m.created_at >= v_ses.ts_apertura
       and m.created_at <= v_hasta
       and not (m.tipo = 'ajuste_conteo' and m.referencia_id = p_sesion_id)
       and exists (select 1 from public.conteo_snapshot s2
                   where s2.sesion_id = p_sesion_id and s2.producto_id = m.producto_id)
     group by m.producto_id
  ),
  contado as (
    select d.producto_id as prod_id,
           sum(coalesce(r.cantidad_contada, d.cantidad_contada)) as total,
           bool_or(d.reconteo_pedido and r.id is null) as pendiente,
           array_remove(array_agg(distinct coalesce(r.observacion, d.observacion)), null) as obs
      from public.conteo_detalle d
      join public.conteo_zonas z on z.id = d.zona_id and z.sesion_id = p_sesion_id
      left join public.conteo_detalle r
             on r.zona_id = d.zona_id and r.producto_id = d.producto_id and r.es_reconteo
     where not d.es_reconteo
     group by d.producto_id
  )
  select
    s.producto_id,
    p.nombre,
    p.codigo_barras,
    s.stock_teorico,
    coalesce(m.ventas, 0),
    coalesce(m.ingresos, 0),
    coalesce(m.delta_total, 0) + coalesce(m.ventas, 0) - coalesce(m.ingresos, 0),
    s.stock_teorico + coalesce(m.delta_total, 0),
    c.total,
    case when c.total is null then null
         else c.total - (s.stock_teorico + coalesce(m.delta_total, 0)) end,
    -- fn_costo devuelve NULL si el producto no tiene fila en costos_producto
    -- (alta al vuelo "pendiente de precio"): coalesce para no envenenar los
    -- totales ni el flag relevante. El costo se expone acá porque
    -- 'conteo_cierre' es de admin/encargado, que ya tienen 'costos'; si se
    -- crea un rol custom con conteo_cierre, dale también 'costos'.
    coalesce(public.fn_costo(s.producto_id), 0),
    case when c.total is null then null
         else round((c.total - (s.stock_teorico + coalesce(m.delta_total, 0)))
                    * coalesce(public.fn_costo(s.producto_id), 0), 2) end,
    case when c.total is null then false
         else (
           abs(c.total - (s.stock_teorico + coalesce(m.delta_total, 0)))
             > 0.05 * abs(s.stock_teorico + coalesce(m.delta_total, 0))
           or abs((c.total - (s.stock_teorico + coalesce(m.delta_total, 0)))
                  * coalesce(public.fn_costo(s.producto_id), 0)) > v_ses.umbral_pesos
         ) end,
    coalesce(c.pendiente, false),
    coalesce(c.obs, '{}')
  from public.conteo_snapshot s
  join public.productos p on p.id = s.producto_id
  left join movs m on m.prod_id = s.producto_id
  left join contado c on c.prod_id = s.producto_id
  where s.sesion_id = p_sesion_id;
end;
$$;

-- ─── 9 · fn_solicitar_reconteo ───────────────────────────────────────
-- Marca reconteo_pedido en las filas originales de esos productos (en
-- TODAS las zonas donde se contaron) y borra reconteos previos si se
-- vuelve a pedir. Opcionalmente designa quién recuenta (p_reconteo_user_id
-- en las zonas afectadas); la regla dura —distinta persona que el conteo
-- original— la valida fn_registrar_conteo al registrar.

drop function if exists public.fn_solicitar_reconteo(integer, integer[], uuid);
create or replace function public.fn_solicitar_reconteo(
  p_sesion_id integer,
  p_producto_ids integer[],
  p_reconteo_user_id uuid default null
) returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sesion public.conteo_sesiones;
  v_sin_contar text;
  v_marcadas integer;
begin
  if v_uid is null then
    raise exception 'No se pudo identificar al usuario.';
  end if;
  if not public.fn_tiene_permiso('conteo_cierre') then
    raise exception 'No tenés permiso para solicitar reconteos.';
  end if;
  if p_producto_ids is null or array_length(p_producto_ids, 1) is null then
    raise exception 'Elegí al menos un producto para recontar.';
  end if;
  select * into v_sesion from public.conteo_sesiones where id = p_sesion_id for update;
  if v_sesion.id is null then
    raise exception 'La sesión de conteo no existe.';
  end if;
  if v_sesion.estado <> 'en_revision' then
    raise exception 'Los reconteos se piden con la sesión en revisión.';
  end if;
  if p_reconteo_user_id is not null
     and not exists (select 1 from public.usuarios where id = p_reconteo_user_id and activo) then
    raise exception 'El usuario designado para recontar no está activo.';
  end if;

  -- Productos que no se contaron en ninguna zona no se pueden recontar.
  select string_agg(p.nombre, ', ') into v_sin_contar
    from unnest(p_producto_ids) pid
    join public.productos p on p.id = pid
   where not exists (
     select 1 from public.conteo_detalle d
     join public.conteo_zonas z on z.id = d.zona_id
     where z.sesion_id = p_sesion_id and d.producto_id = pid and not d.es_reconteo
   );
  if v_sin_contar is not null then
    raise exception 'Estos productos no se contaron en ninguna zona (no hay qué recontar): %. Reabrí la zona y contalos primero.', v_sin_contar;
  end if;

  -- Borrar reconteos previos de esos productos (nuevo pedido = recontar de cero).
  delete from public.conteo_detalle d
   using public.conteo_zonas z
   where z.id = d.zona_id and z.sesion_id = p_sesion_id
     and d.es_reconteo and d.producto_id = any(p_producto_ids);

  update public.conteo_detalle d
     set reconteo_pedido = true
    from public.conteo_zonas z
   where z.id = d.zona_id and z.sesion_id = p_sesion_id
     and not d.es_reconteo and d.producto_id = any(p_producto_ids);
  get diagnostics v_marcadas = row_count;

  if p_reconteo_user_id is not null then
    update public.conteo_zonas z
       set reconteo_user_id = p_reconteo_user_id
     where z.sesion_id = p_sesion_id
       and exists (
         select 1 from public.conteo_detalle d
         where d.zona_id = z.id and not d.es_reconteo
           and d.producto_id = any(p_producto_ids)
       );
  end if;

  begin
    perform public.fn_auditar(v_uid, 'solicitar_reconteo', 'conteo_sesion', p_sesion_id,
      jsonb_build_object('productos', p_producto_ids, 'filas_marcadas', v_marcadas,
                         'reconteo_user_id', p_reconteo_user_id));
  exception when others then null; end;
  return v_marcadas;
end;
$$;

-- ─── 10 · fn_cerrar_sesion_conteo ────────────────────────────────────
-- Aplica los ajustes producto por producto en UNA transacción:
--  · movimiento tipo 'ajuste_conteo' con referencia a la sesión
--  · faltante → consume lotes FEFO (vencimiento ASC, mismo criterio que
--    fn_crear_venta), lote en 0 → 'agotado'; lo que exceda los lotes queda
--    como stock fuera de lotes (convención existente)
--  · sobrante → repone al lote más reciente (vencimiento DESC, mismo
--    criterio que fn_anular_venta); sin lotes → solo stock_actual
-- Solo ajusta productos CONTADOS con diferencia ≠ 0. Nunca UPDATE directo
-- del stock desde el cliente.
-- p_confirmo_sync: el POS opera offline; no hay validación server-side
-- posible de la cola de IndexedDB de cada caja (limitación documentada).
-- El cierre exige la confirmación explícita del operador y la registra.

drop function if exists public.fn_cerrar_sesion_conteo(integer, boolean);
create or replace function public.fn_cerrar_sesion_conteo(
  p_sesion_id integer,
  p_confirmo_sync boolean default false
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sesion public.conteo_sesiones;
  -- clock_timestamp() para que ts_cierre sea siempre > ts_apertura (que
  -- también es clock-based), incluso si apertura y cierre caen en la misma
  -- transacción (script de tests).
  v_ahora timestamptz := clock_timestamp();
  v_abiertas integer;
  v_pendientes integer;
  v_dif record;
  v_stock_ant numeric;
  v_stock_nuevo numeric;
  v_lote record;
  v_lote_id integer;
  v_restante numeric;
  v_usar numeric;
  v_ajustados integer := 0;
  v_faltante_unidades numeric := 0;
  v_sobrante_unidades numeric := 0;
  v_faltante_pesos numeric := 0;
  v_sobrante_pesos numeric := 0;
  v_periodo_cerrado boolean := false;
begin
  if v_uid is null then
    raise exception 'No se pudo identificar al usuario.';
  end if;
  if not public.fn_tiene_permiso('conteo_cierre') then
    raise exception 'No tenés permiso para cerrar sesiones de conteo.';
  end if;
  select * into v_sesion from public.conteo_sesiones where id = p_sesion_id for update;
  if v_sesion.id is null then
    raise exception 'La sesión de conteo no existe.';
  end if;
  if v_sesion.estado = 'cerrada' then
    raise exception 'La sesión ya está cerrada.';
  end if;
  if v_sesion.estado <> 'en_revision' then
    raise exception 'Pasá la sesión a revisión antes de cerrarla.';
  end if;
  select count(*) into v_abiertas
    from public.conteo_zonas where sesion_id = p_sesion_id and estado <> 'cerrada';
  if v_abiertas > 0 then
    raise exception 'Hay % zona(s) sin cerrar. Cerralas antes de ajustar el stock.', v_abiertas;
  end if;
  select count(distinct d.producto_id) into v_pendientes
    from public.conteo_detalle d
    join public.conteo_zonas z on z.id = d.zona_id and z.sesion_id = p_sesion_id
   where not d.es_reconteo and d.reconteo_pedido
     and not exists (
       select 1 from public.conteo_detalle r
       where r.zona_id = d.zona_id and r.producto_id = d.producto_id and r.es_reconteo
     );
  if v_pendientes > 0 then
    raise exception 'Hay % producto(s) con reconteo pendiente. Registralos o volvé a revisar antes de cerrar.', v_pendientes;
  end if;
  if not coalesce(p_confirmo_sync, false) then
    raise exception 'Confirmá que todas las cajas están online y sincronizadas antes de cerrar: una venta offline sin sincronizar aparecería como faltante.';
  end if;
  -- Guarda fail-safe: si el módulo de cierre de período (mig. 053) no está en
  -- esta base, fn_periodo_cerrado no existe → no hay períodos cerrados que
  -- respetar, se deja pasar. Si está y dice cerrado, bloquea el ajuste.
  begin
    v_periodo_cerrado := public.fn_periodo_cerrado(current_date);
  exception when undefined_function then
    v_periodo_cerrado := false;
  end;
  if v_periodo_cerrado then
    raise exception 'El período contable actual está cerrado; no se puede ajustar stock.';
  end if;

  -- Fijar ts_cierre ANTES de calcular: fn_conteo_diferencias usa ts_cierre
  -- como fin de ventana, así el reporte que se consulte después del cierre
  -- reproduce exactamente los ajustes que se aplican acá.
  update public.conteo_sesiones set ts_cierre = v_ahora where id = p_sesion_id;

  for v_dif in
    select d.producto_id as prod_id, d.diferencia, d.costo_unitario
      from public.fn_conteo_diferencias(p_sesion_id) d
     where d.total_contado is not null and d.diferencia <> 0
  loop
    select stock_actual into v_stock_ant
      from public.productos where id = v_dif.prod_id for update;
    if v_stock_ant is null then
      continue;
    end if;
    v_stock_nuevo := v_stock_ant + v_dif.diferencia;

    update public.productos
       set stock_actual = v_stock_nuevo, updated_at = v_ahora
     where id = v_dif.prod_id;

    insert into public.movimientos_stock (
      producto_id, tipo, cantidad, stock_anterior, stock_nuevo,
      referencia_id, usuario_id, nota
    ) values (
      v_dif.prod_id, 'ajuste_conteo', abs(v_dif.diferencia),
      v_stock_ant, v_stock_nuevo, p_sesion_id, v_uid,
      'Conteo físico #' || p_sesion_id || ' · ' || v_sesion.nombre || ' · '
        || case when v_dif.diferencia < 0 then 'faltante ' else 'sobrante ' end
        || abs(v_dif.diferencia)
    );

    if v_dif.diferencia < 0 then
      -- Faltante: consumir lotes FEFO en cascada (igual que fn_crear_venta).
      v_restante := abs(v_dif.diferencia);
      for v_lote in
        select id, cantidad_actual from public.lotes
         where producto_id = v_dif.prod_id
           and estado = 'activo'::public.estado_lote and cantidad_actual > 0
         order by fecha_vencimiento asc for update
      loop
        exit when v_restante <= 0;
        v_usar := least(v_lote.cantidad_actual, v_restante);
        update public.lotes
           set cantidad_actual = v_lote.cantidad_actual - v_usar,
               estado = (case when v_lote.cantidad_actual - v_usar = 0
                              then 'agotado' else 'activo' end)::public.estado_lote
         where id = v_lote.id;
        v_restante := v_restante - v_usar;
      end loop;
      v_faltante_unidades := v_faltante_unidades + abs(v_dif.diferencia);
      v_faltante_pesos := v_faltante_pesos + abs(v_dif.diferencia) * v_dif.costo_unitario;
    else
      -- Sobrante: al lote más reciente (igual que fn_anular_venta). Sin
      -- lotes, el sobrante queda como stock fuera de lotes. FOR UPDATE para
      -- no pisar un cambio de estado concurrente (p.ej. baja por vencimiento).
      select id into v_lote_id from public.lotes
       where producto_id = v_dif.prod_id and estado in ('activo', 'agotado')
       order by fecha_vencimiento desc, id desc limit 1
       for update;
      if v_lote_id is not null then
        update public.lotes
           set cantidad_actual = cantidad_actual + v_dif.diferencia,
               estado = 'activo'
         where id = v_lote_id;
      end if;
      v_sobrante_unidades := v_sobrante_unidades + v_dif.diferencia;
      v_sobrante_pesos := v_sobrante_pesos + v_dif.diferencia * v_dif.costo_unitario;
    end if;

    v_ajustados := v_ajustados + 1;
  end loop;

  update public.conteo_sesiones
     set estado = 'cerrada',
         cerrada_por = v_uid,
         sync_confirmado = true
   where id = p_sesion_id;

  begin
    perform public.fn_auditar(v_uid, 'cerrar_conteo_sesion', 'conteo_sesion', p_sesion_id,
      jsonb_build_object(
        'productos_ajustados', v_ajustados,
        'faltante_unidades', v_faltante_unidades,
        'faltante_pesos', round(v_faltante_pesos, 2),
        'sobrante_unidades', v_sobrante_unidades,
        'sobrante_pesos', round(v_sobrante_pesos, 2),
        'sync_confirmado', true
      ));
  exception when others then null; end;

  return jsonb_build_object(
    'productos_ajustados', v_ajustados,
    'faltante_unidades', v_faltante_unidades,
    'faltante_pesos', round(v_faltante_pesos, 2),
    'sobrante_unidades', v_sobrante_unidades,
    'sobrante_pesos', round(v_sobrante_pesos, 2)
  );
end;
$$;

notify pgrst, 'reload schema';
