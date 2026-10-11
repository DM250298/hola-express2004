-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 229 · Organigrama y cadena de mando en empleados         ║
-- ║                                                                     ║
-- ║  El Manual Maestro Operativo (oct-2026, §3) define la cadena de     ║
-- ║  mando: Dirección → Responsable Operativa General → Encargado de    ║
-- ║  turno / Pivote → Cajeros y Fiambrería; Compras es transversal.     ║
-- ║  Hasta ahora `empleados.puesto` era texto libre y no había forma de ║
-- ║  saber quién reporta a quién.                                       ║
-- ║                                                                     ║
-- ║  · rol_operativo: nivel en la cadena (text + check, sin enum para   ║
-- ║    no obligar casts en plpgsql). Default 'otro'.                    ║
-- ║  · reporta_a: jefe directo (FK a empleados, null = raíz). Un        ║
-- ║    empleado no puede reportarse a sí mismo.                         ║
-- ║                                                                     ║
-- ║  Sin cambios de RLS: update de empleados ya exige 'rrhh' (mig 159). ║
-- ║  Sin backfill: se carga desde Personal › Equipo › Organigrama.      ║
-- ║  Ejecutar UNA sola vez en el SQL Editor. Primero PRUEBA, después    ║
-- ║  PRODUCCIÓN.                                                        ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.empleados
  add column if not exists rol_operativo text not null default 'otro',
  add column if not exists reporta_a integer
    references public.empleados(id) on delete set null;

alter table public.empleados
  drop constraint if exists empleados_rol_operativo_check;
alter table public.empleados
  add constraint empleados_rol_operativo_check check (
    rol_operativo in (
      'direccion', 'responsable_general', 'encargado', 'pivote',
      'cajero', 'fiambreria', 'compras', 'otro'
    )
  );

alter table public.empleados
  drop constraint if exists empleados_reporta_a_no_self;
alter table public.empleados
  add constraint empleados_reporta_a_no_self
  check (reporta_a is null or reporta_a <> id);

create index if not exists empleados_reporta_a_idx
  on public.empleados (reporta_a);

comment on column public.empleados.rol_operativo is
  'Nivel en la cadena de mando (Manual §3): direccion, responsable_general, encargado, pivote, cajero, fiambreria, compras, otro.';
comment on column public.empleados.reporta_a is
  'Jefe directo (empleados.id). Null = raíz del organigrama (Dirección).';

notify pgrst, 'reload schema';
