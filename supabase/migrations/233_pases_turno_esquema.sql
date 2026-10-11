-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 233 · Pase de turno digital (esquema)                    ║
-- ║                                                                     ║
-- ║  Manual Maestro §6.6 / Reglamento §9: el turno saliente deja 4      ║
-- ║  bloques obligatorios (reposición, orden y limpieza, novedades e    ║
-- ║  incidencias, pendientes con responsable) y el entrante marca cada  ║
-- ║  uno conforme / no conforme explicando la no conformidad. El pase   ║
-- ║  NO incluye el arqueo de caja (circuito aparte).                    ║
-- ║                                                                     ║
-- ║  Un pase por (fecha, turno saliente). Para el turno noche, `fecha`  ║
-- ║  es la del INICIO del turno (misma convención que horarios).        ║
-- ║  `pendientes` es un array jsonb de                                  ║
-- ║    { texto, responsable_empleado_id, hecho }                        ║
-- ║  validado en la RPC (mig 234). Escritura SOLO por RPC.              ║
-- ║  Lectura: 'rrhh' o cualquier usuario con legajo vinculado (el       ║
-- ║  entrante tiene que encontrar el pase que debe recibir).            ║
-- ║  Ejecutar UNA sola vez. Primero PRUEBA, después PRODUCCIÓN.         ║
-- ╚════════════════════════════════════════════════════════════════════╝

create table if not exists public.pases_turno (
  id serial primary key,
  fecha date not null,
  turno_saliente_id integer not null references public.turnos_plantilla(id),
  turno_entrante_id integer references public.turnos_plantilla(id),
  saliente_empleado_id integer not null references public.empleados(id),
  entrante_empleado_id integer references public.empleados(id),
  estado text not null default 'borrador'
    check (estado in ('borrador', 'entregado', 'recibido')),
  -- Bloques del saliente
  reposicion text,
  orden_limpieza text,
  novedades text,
  pendientes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(pendientes) = 'array'),
  -- Conformidad del entrante (null hasta que recibe)
  conforme_reposicion boolean,
  conforme_orden boolean,
  conforme_novedades boolean,
  conforme_pendientes boolean,
  observaciones_entrante text,
  entregado_at timestamptz,
  recibido_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pases_turno_unico unique (fecha, turno_saliente_id)
);

create index if not exists pases_turno_fecha_idx
  on public.pases_turno (fecha desc);
create index if not exists pases_turno_pendientes_idx
  on public.pases_turno (estado) where estado <> 'recibido';

comment on table public.pases_turno is
  'Pase de turno digital (Manual §6.6). Un registro por fecha y turno saliente; el entrante marca conforme/no conforme.';

-- ─── RLS ─────────────────────────────────────────────────────────────
alter table public.pases_turno enable row level security;
drop policy if exists "pases_turno_select" on public.pases_turno;
drop policy if exists "pases_turno_admin"  on public.pases_turno;

create policy "pases_turno_select" on public.pases_turno
  for select to authenticated
  using (
    (select public.fn_tiene_permiso('rrhh'))
    or (select public.fn_mi_empleado_id()) is not null
  );

-- Correcciones administrativas (borrar un pase mal cargado). Alta y
-- recepción van por RPC.
create policy "pases_turno_admin" on public.pases_turno
  for delete to authenticated
  using ((select public.fn_tiene_permiso('rrhh')));

notify pgrst, 'reload schema';
