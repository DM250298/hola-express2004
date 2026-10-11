-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 236 · Patrones de cronograma (esquema)                   ║
-- ║                                                                     ║
-- ║  Hasta ahora el cronograma se cargaba a mano celda por celda o con  ║
-- ║  "copiar semana". Los dos patrones reales del local son:            ║
-- ║   · franco_rotativo (mañana/tarde): lista ordenada de N personas,   ║
-- ║     un franco por día. La lista se corre una posición por semana    ║
-- ║     (franco(día i, semana k) = lista[(i − k) mod N]) → cada 7       ║
-- ║     semanas cae franco doble Dom+Lun. El PIVOTE (miembro de la      ║
-- ║     lista) cubre el turno/puesto del que descansa; el día de su     ║
-- ║     propio franco nadie cubre.                                      ║
-- ║   · noche_ab (noche): 2 personas en ciclo de 14 días. Semana A:     ║
-- ║     Lun-Mar-Mié-Dom → 1º, Jue-Vie-Sáb → 2º. Semana B al revés.      ║
-- ║  `fecha_ancla` es el LUNES de la semana 1 (k = 0, semana A).        ║
-- ║  Cada miembro de franco_rotativo tiene su turno habitual            ║
-- ║  (miembros.turno_id); en noche_ab el turno es el del patrón.        ║
-- ║  `horarios_asignados.patron_id` marca las filas generadas, para     ║
-- ║  poder regenerar sin pisar lo cargado a mano (mig 237).             ║
-- ║  Ejecutar UNA sola vez. Primero PRUEBA, después PRODUCCIÓN.         ║
-- ╚════════════════════════════════════════════════════════════════════╝

create table if not exists public.patrones_cronograma (
  id serial primary key,
  nombre text not null,
  tipo text not null check (tipo in ('franco_rotativo', 'noche_ab')),
  -- Turno del patrón (obligatorio en noche_ab; en franco_rotativo se usa
  -- como default para miembros sin turno propio).
  turno_id integer references public.turnos_plantilla(id),
  -- Lunes de la semana 1 del ciclo.
  fecha_ancla date not null,
  -- Miembro que cubre los francos (solo franco_rotativo).
  pivote_empleado_id integer references public.empleados(id) on delete set null,
  activo boolean not null default true,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patrones_ancla_lunes check (extract(isodow from fecha_ancla) = 1)
);

create table if not exists public.patron_cronograma_miembros (
  patron_id integer not null references public.patrones_cronograma(id) on delete cascade,
  empleado_id integer not null references public.empleados(id) on delete cascade,
  orden integer not null,
  -- Turno habitual del miembro (franco_rotativo). Null = turno del patrón.
  turno_id integer references public.turnos_plantilla(id),
  primary key (patron_id, empleado_id),
  unique (patron_id, orden)
);

alter table public.horarios_asignados
  add column if not exists patron_id integer
    references public.patrones_cronograma(id) on delete set null;
create index if not exists horarios_patron_idx
  on public.horarios_asignados (patron_id) where patron_id is not null;

comment on table public.patrones_cronograma is
  'Rotaciones de francos/turnos que genera fn_generar_cronograma (mig 237).';

-- ─── RLS ─────────────────────────────────────────────────────────────
alter table public.patrones_cronograma enable row level security;
drop policy if exists "patrones_select" on public.patrones_cronograma;
drop policy if exists "patrones_write"  on public.patrones_cronograma;
create policy "patrones_select" on public.patrones_cronograma
  for select to authenticated
  using (
    (select public.fn_tiene_permiso('rrhh'))
    or (select public.fn_tiene_permiso('tareas_gestion'))
  );
create policy "patrones_write" on public.patrones_cronograma
  for all to authenticated
  using ((select public.fn_tiene_permiso('rrhh')))
  with check ((select public.fn_tiene_permiso('rrhh')));

alter table public.patron_cronograma_miembros enable row level security;
drop policy if exists "patron_miembros_select" on public.patron_cronograma_miembros;
drop policy if exists "patron_miembros_write"  on public.patron_cronograma_miembros;
create policy "patron_miembros_select" on public.patron_cronograma_miembros
  for select to authenticated
  using (
    (select public.fn_tiene_permiso('rrhh'))
    or (select public.fn_tiene_permiso('tareas_gestion'))
  );
create policy "patron_miembros_write" on public.patron_cronograma_miembros
  for all to authenticated
  using ((select public.fn_tiene_permiso('rrhh')))
  with check ((select public.fn_tiene_permiso('rrhh')));

notify pgrst, 'reload schema';
