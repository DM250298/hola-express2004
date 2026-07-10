'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ChevronRight,
  ClipboardList,
  Loader2,
  Lock,
  MapPin,
  Plus,
  UserRound,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { EstadoError } from '@/components/shared/EstadoError'
import { formatearFechaHora } from '@/lib/utils/formato'
import { tienePermiso } from '@/lib/permisos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { useUsuariosActivos } from '@/lib/hooks/useConteos'
import {
  useItemsPorZona,
  usePasarARevision,
  useSesionConteoActiva,
  useSesionesConteo,
  useZonasSesion,
} from '@/lib/hooks/useConteoFisico'
import type { ConteoZonaRow, EstadoConteoZona } from '@/types/database'
import { WizardNuevaSesion } from './WizardNuevaSesion'

const ESTILO_ESTADO_ZONA: Record<EstadoConteoZona, string> = {
  pendiente: 'bg-[#e4c9b0]/40 text-[#6f3a2a]',
  en_curso: 'bg-[#f9b44c]/20 text-[#a3641c]',
  cerrada: 'bg-[#2f7d4f]/12 text-[#2f7d4f]',
}

const ETIQUETA_ESTADO_ZONA: Record<EstadoConteoZona, string> = {
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  cerrada: 'Cerrada',
}

function BadgeZona({ estado }: { estado: EstadoConteoZona }) {
  return (
    <span
      className={`rounded-lg px-2 py-0.5 text-xs font-semibold ${ESTILO_ESTADO_ZONA[estado]}`}
    >
      {ETIQUETA_ESTADO_ZONA[estado]}
    </span>
  )
}

function FilaZona({
  zona,
  items,
  nombreResponsable,
}: {
  zona: ConteoZonaRow
  items: number
  nombreResponsable: string | null
}) {
  return (
    <Link
      href={`/inventario/conteo/zona/${zona.id}`}
      className="flex items-center gap-3 rounded-2xl border border-[#e4c9b0]/70 bg-white p-3 shadow-sm transition hover:border-[#f9b44c]"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f9b44c]/15">
        <MapPin className="h-5 w-5 text-[#a3641c]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-[#391511]">{zona.nombre}</p>
        <p className="flex items-center gap-1 text-xs text-[#6f3a2a]">
          <UserRound className="h-3 w-3" />
          {nombreResponsable ?? 'Sin responsable — la toma quien la inicia'}
          {items > 0 && <span>· {items} producto/s cargados</span>}
        </p>
      </div>
      <BadgeZona estado={zona.estado} />
      <ChevronRight className="h-4 w-4 shrink-0 text-[#6f3a2a]" />
    </Link>
  )
}

/**
 * Hub del conteo físico. Con permiso `conteo_cierre` se ve la gestión
 * completa (sesión, avance, revisión, historial); sin él, el empleado ve
 * solo sus zonas asignadas de la sesión en curso — nunca el stock teórico.
 */
export function PantallaConteoFisico() {
  const [wizardAbierto, setWizardAbierto] = useState(false)

  const { data: usuario } = useUsuario()
  const esGestor = tienePermiso(usuario?.permisos, 'conteo_cierre')

  const {
    data: sesionActiva,
    isLoading: cargandoActiva,
    isError: errorActiva,
    refetch: refetchActiva,
  } = useSesionConteoActiva()
  const { data: zonas, isLoading: cargandoZonas } = useZonasSesion(
    sesionActiva?.id ?? null
  )
  const { data: itemsPorZona } = useItemsPorZona(sesionActiva?.id ?? null)
  const { data: sesiones } = useSesionesConteo(esGestor)
  const { data: usuarios } = useUsuariosActivos()
  const pasar = usePasarARevision()

  const nombrePorUsuario = useMemo(() => {
    const mapa: Record<string, string> = {}
    for (const u of usuarios ?? []) mapa[u.id] = u.nombre
    return mapa
  }, [usuarios])

  const zonasVisibles = zonas ?? []
  const zonasAbiertas = zonasVisibles.filter((z) => z.estado !== 'cerrada')
  const misZonas = zonasVisibles.filter(
    (z) =>
      z.responsable_user_id === usuario?.id ||
      z.reconteo_user_id === usuario?.id ||
      z.responsable_user_id === null
  )

  if (cargandoActiva) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <SkeletonTabla filas={4} columnas={3} />
      </div>
    )
  }

  if (errorActiva) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <EstadoError onReintentar={() => refetchActiva()} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-[#391511]">
            <ClipboardList className="h-5 w-5" />
            Conteo físico
          </h1>
          <p className="text-sm text-[#6f3a2a]">
            Inventario por zonas con el local abierto: conteo ciego y
            compensación automática por ventas.
          </p>
        </div>
        {esGestor && !sesionActiva && (
          <Button
            onClick={() => setWizardAbierto(true)}
            className="shrink-0 bg-[#f9b44c] font-semibold text-[#391511] hover:bg-[#e4a42a]"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Nueva sesión
          </Button>
        )}
      </div>

      {!sesionActiva && (
        <div className="rounded-2xl border border-dashed border-[#e4c9b0] bg-white/60 p-8 text-center">
          <p className="font-semibold text-[#391511]">No hay conteo en curso</p>
          <p className="mt-1 text-sm text-[#6f3a2a]">
            {esGestor
              ? 'Abrí una sesión nueva para arrancar: se define el nombre, las zonas y quién cuenta cada una.'
              : 'Cuando un encargado abra una sesión y te asigne una zona, la vas a ver acá.'}
          </p>
        </div>
      )}

      {sesionActiva && (
        <div className="space-y-3 rounded-2xl border border-[#e4c9b0]/70 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-bold text-[#391511]">{sesionActiva.nombre}</p>
              <p className="text-xs text-[#6f3a2a]">
                Abierta el {formatearFechaHora(sesionActiva.ts_apertura)}
                {sesionActiva.estado === 'en_revision' && ' · en revisión'}
              </p>
            </div>
            {esGestor && sesionActiva.estado === 'abierta' && (
              <Button
                size="sm"
                onClick={() => pasar.mutate(sesionActiva.id)}
                disabled={pasar.isPending || zonasAbiertas.length > 0}
                title={
                  zonasAbiertas.length > 0
                    ? `Faltan cerrar ${zonasAbiertas.length} zona/s`
                    : undefined
                }
                className="bg-[#391511] text-white hover:bg-[#502019]"
              >
                {pasar.isPending && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                Pasar a revisión
              </Button>
            )}
            {esGestor && sesionActiva.estado === 'en_revision' && (
              <Link
                href={`/inventario/conteo/${sesionActiva.id}/revision`}
                className="rounded-lg bg-[#391511] px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-[#502019]"
              >
                Revisar diferencias →
              </Link>
            )}
          </div>

          {sesionActiva.notas && (
            <p className="rounded-xl bg-[#fdfaf6] px-3 py-2 text-sm text-[#6f3a2a]">
              {sesionActiva.notas}
            </p>
          )}

          {esGestor && zonasAbiertas.length > 0 && (
            <p className="text-xs text-[#6f3a2a]">
              {zonasAbiertas.length} zona/s sin cerrar. Para revisar y ajustar,
              primero se cierran todas.
            </p>
          )}

          <div className="space-y-2">
            {cargandoZonas && <SkeletonTabla filas={3} columnas={3} />}
            {(esGestor ? zonasVisibles : misZonas).map((zona) => (
              <FilaZona
                key={zona.id}
                zona={zona}
                items={itemsPorZona?.[zona.id] ?? 0}
                nombreResponsable={
                  zona.responsable_user_id
                    ? (nombrePorUsuario[zona.responsable_user_id] ?? 'Asignada')
                    : null
                }
              />
            ))}
            {!cargandoZonas && !esGestor && misZonas.length === 0 && (
              <p className="rounded-xl border border-dashed border-[#e4c9b0] bg-white/60 p-4 text-center text-sm text-[#6f3a2a]">
                No tenés zonas asignadas en esta sesión.
              </p>
            )}
          </div>
        </div>
      )}

      {esGestor && (sesiones ?? []).filter((s) => s.estado === 'cerrada').length > 0 && (
        <div className="space-y-2">
          <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-[#6f3a2a]">
            <Lock className="h-3.5 w-3.5" />
            Sesiones cerradas
          </h2>
          <div className="space-y-2">
            {(sesiones ?? [])
              .filter((s) => s.estado === 'cerrada')
              .map((s) => (
                <Link
                  key={s.id}
                  href={`/inventario/conteo/${s.id}/revision`}
                  className="flex items-center justify-between rounded-2xl border border-[#e4c9b0]/50 bg-white/70 px-4 py-3 text-sm transition hover:border-[#f9b44c]"
                >
                  <span className="font-semibold text-[#391511]">{s.nombre}</span>
                  <span className="text-xs text-[#6f3a2a]">
                    {s.ts_cierre ? formatearFechaHora(s.ts_cierre) : '—'}
                  </span>
                </Link>
              ))}
          </div>
        </div>
      )}

      <WizardNuevaSesion
        abierto={wizardAbierto}
        onCambioAbierto={setWizardAbierto}
      />
    </div>
  )
}
