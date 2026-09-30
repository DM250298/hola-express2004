'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ChevronRight,
  ClipboardList,
  ListChecks,
  Loader2,
  Lock,
  MapPin,
  Plus,
  RotateCcw,
  ScanLine,
  Trash2,
  UserRoundPen,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { EstadoError } from '@/components/shared/EstadoError'
import { ConfirmacionAccion } from '@/components/shared/ConfirmacionAccion'
import { formatearFechaHora, formatearNumero } from '@/lib/utils/formato'
import { tienePermiso } from '@/lib/permisos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { useUsuariosActivos } from '@/lib/hooks/useConteos'
import {
  useAvanceConteo,
  useCoberturaConteo,
  useItemsPorZona,
  usePasarARevision,
  useQuitarTareaConteo,
  useReabrirSesionConteo,
  useSesionConteoActiva,
  useSesionesConteo,
  useZonasSesion,
} from '@/lib/hooks/useConteoFisico'
import {
  AYUDA_TIPO_TAREA,
  ETIQUETA_TIPO_TAREA,
  tipoDeZona,
} from '@/lib/conteo/tareas'
import type {
  ConteoAvanceRow,
  ConteoZonaRow,
  EstadoConteoZona,
  TipoConteoZona,
} from '@/types/database'
import { WizardNuevaSesion } from './WizardNuevaSesion'
import { DialogoAgregarTareas } from './DialogoAgregarTareas'
import { DialogoReasignarTarea } from './DialogoReasignarTarea'
import { AvisoCobertura } from './AvisoCobertura'

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

const ICONO_TIPO: Record<TipoConteoZona | 'libre', LucideIcon> = {
  area: MapPin,
  lista: ListChecks,
  libre: ScanLine,
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
  avance,
  items,
  nombreResponsable,
  onReasignar,
  onQuitar,
}: {
  zona: ConteoZonaRow
  /** Avance de la mig 227; undefined = todavía sin dato o migración pendiente. */
  avance: ConteoAvanceRow | undefined
  /** Renglones cargados (respaldo cuando no hay avance). */
  items: number
  nombreResponsable: string | null
  /** Solo gestores; undefined = sin acciones. */
  onReasignar?: () => void
  onQuitar?: () => void
}) {
  const tipo = tipoDeZona(zona)
  const Icono = ICONO_TIPO[tipo]
  const enLista = avance?.en_lista ?? 0
  const contados = avance?.contados ?? items
  const deLaLista = avance?.contados_lista ?? 0
  const sueltos = contados - deLaLista
  const porcentaje =
    enLista > 0 ? Math.min(100, Math.round((deLaLista / enLista) * 100)) : 0

  return (
    <div className="flex items-stretch gap-1 rounded-2xl border border-[#e4c9b0]/70 bg-white shadow-sm transition hover:border-[#f9b44c]">
      <Link
        href={`/inventario/conteo/zona/${zona.id}`}
        className="flex min-w-0 flex-1 items-center gap-3 p-3"
      >
        <div
          title={AYUDA_TIPO_TAREA[tipo]}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f9b44c]/15"
        >
          <Icono className="h-5 w-5 text-[#a3641c]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-[#391511]">{zona.nombre}</p>
          <p className="flex flex-wrap items-center gap-x-1 text-xs text-[#6f3a2a]">
            <UserRound className="h-3 w-3" />
            {nombreResponsable ?? 'Sin responsable — la toma quien la inicia'}
            <span>· {ETIQUETA_TIPO_TAREA[tipo]}</span>
          </p>
          {enLista > 0 ? (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#e4c9b0]/50">
                <div
                  className={`h-full rounded-full ${porcentaje === 100 ? 'bg-[#2f7d4f]' : 'bg-[#f9b44c]'}`}
                  style={{ width: `${porcentaje}%` }}
                />
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-[#6f3a2a]">
                {formatearNumero(deLaLista)} / {formatearNumero(enLista)}
                {sueltos > 0 && ` · +${formatearNumero(sueltos)} fuera de lista`}
              </span>
            </div>
          ) : (
            contados > 0 && (
              <p className="text-[11px] text-[#6f3a2a]">
                {formatearNumero(contados)} producto/s cargados
              </p>
            )
          )}
        </div>
        <BadgeZona estado={zona.estado} />
        <ChevronRight className="h-4 w-4 shrink-0 text-[#6f3a2a]" />
      </Link>
      {(onReasignar || onQuitar) && (
        <div className="flex shrink-0 flex-col justify-center border-l border-[#e4c9b0]/50 px-1">
          {onReasignar && (
            <button
              type="button"
              onClick={onReasignar}
              className="rounded-lg p-1.5 text-[#6f3a2a] transition hover:bg-[#fdfaf6]"
              aria-label={`Reasignar ${zona.nombre}`}
              title="Cambiar quién cuenta"
            >
              <UserRoundPen className="h-4 w-4" />
            </button>
          )}
          {onQuitar && (
            <button
              type="button"
              onClick={onQuitar}
              className="rounded-lg p-1.5 text-[#c43e2c] transition hover:bg-[#c43e2c]/10"
              aria-label={`Quitar ${zona.nombre}`}
              title="Quitar la tarea"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Hub del conteo físico. Con permiso `conteo_cierre` se ve la gestión
 * completa (sesión, tareas, avance, revisión, historial); sin él, el empleado
 * ve solo sus tareas de la sesión en curso — nunca el stock teórico.
 */
export function PantallaConteoFisico() {
  const [wizardAbierto, setWizardAbierto] = useState(false)
  const [agregarAbierto, setAgregarAbierto] = useState(false)
  const [reasignando, setReasignando] = useState<ConteoZonaRow | null>(null)
  const [quitando, setQuitando] = useState<ConteoZonaRow | null>(null)
  const [confirmarRevision, setConfirmarRevision] = useState(false)

  const { data: usuario } = useUsuario()
  const esGestor = tienePermiso(usuario?.permisos, 'conteo_cierre')

  const {
    data: sesionActiva,
    isLoading: cargandoActiva,
    isError: errorActiva,
    refetch: refetchActiva,
  } = useSesionConteoActiva()
  const sesionId = sesionActiva?.id ?? null
  const { data: zonas, isLoading: cargandoZonas } = useZonasSesion(sesionId)
  const { data: itemsPorZona } = useItemsPorZona(sesionId)
  const { data: avance } = useAvanceConteo(sesionId)
  const { data: cobertura } = useCoberturaConteo(sesionId, esGestor)
  const { data: sesiones } = useSesionesConteo(esGestor)
  const { data: usuarios } = useUsuariosActivos()
  const pasar = usePasarARevision()
  const reabrir = useReabrirSesionConteo()
  const quitar = useQuitarTareaConteo()

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
  const aMedias = cobertura ?? []
  // avance === null = migraciones 222+ pendientes: sin gestión de tareas.
  const conTareas = avance !== null && avance !== undefined

  function pasarARevision() {
    if (!sesionActiva) return
    pasar.mutate(sesionActiva.id, {
      onSuccess: () => setConfirmarRevision(false),
    })
  }

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
            Mandá a contar por área del local, proveedor, clase ABC o lo que
            necesites, con el local abierto: conteo ciego y compensación
            automática por ventas.
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
              ? 'Abrí una sesión nueva para arrancar: se define el nombre, qué se cuenta y quién cuenta cada parte.'
              : 'Cuando un encargado abra una sesión y te asigne una tarea, la vas a ver acá.'}
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
            <div className="flex flex-wrap items-center gap-2">
              {esGestor && conTareas && sesionActiva.estado === 'abierta' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAgregarAbierto(true)}
                  className="border-[#e4c9b0] text-[#391511]"
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Agregar tareas
                </Button>
              )}
              {esGestor && sesionActiva.estado === 'abierta' && (
                <Button
                  size="sm"
                  onClick={() =>
                    aMedias.length > 0 ? setConfirmarRevision(true) : pasarARevision()
                  }
                  disabled={pasar.isPending || zonasAbiertas.length > 0}
                  title={
                    zonasAbiertas.length > 0
                      ? `Faltan cerrar ${zonasAbiertas.length} tarea/s`
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
              {esGestor && conTareas && sesionActiva.estado === 'en_revision' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => reabrir.mutate(sesionActiva.id)}
                  disabled={reabrir.isPending}
                  className="border-[#e4c9b0] text-[#391511]"
                >
                  {reabrir.isPending ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-1 h-3.5 w-3.5" />
                  )}
                  Volver a abrir
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
          </div>

          {sesionActiva.notas && (
            <p className="rounded-xl bg-[#fdfaf6] px-3 py-2 text-sm text-[#6f3a2a]">
              {sesionActiva.notas}
            </p>
          )}

          {esGestor && zonasAbiertas.length > 0 && (
            <p className="text-xs text-[#6f3a2a]">
              {zonasAbiertas.length} tarea/s sin cerrar. Para revisar y ajustar,
              primero se cierran todas.
            </p>
          )}

          {esGestor && (
            <AvisoCobertura
              filas={aMedias}
              accion={
                sesionActiva.estado === 'abierta' ? (
                  <Button
                    size="sm"
                    onClick={() => setAgregarAbierto(true)}
                    className="bg-[#391511] text-white hover:bg-[#502019]"
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Mandar a contar lo que falta
                  </Button>
                ) : undefined
              }
            />
          )}

          <div className="space-y-2">
            {cargandoZonas && <SkeletonTabla filas={3} columnas={3} />}
            {(esGestor ? zonasVisibles : misZonas).map((zona) => {
              const gestionable =
                esGestor && conTareas && sesionActiva.estado !== 'cerrada'
              const cargados = avance?.[zona.id]?.contados ?? itemsPorZona?.[zona.id] ?? 0
              return (
                <FilaZona
                  key={zona.id}
                  zona={zona}
                  avance={avance?.[zona.id]}
                  items={itemsPorZona?.[zona.id] ?? 0}
                  nombreResponsable={
                    zona.responsable_user_id
                      ? (nombrePorUsuario[zona.responsable_user_id] ?? 'Asignada')
                      : null
                  }
                  onReasignar={
                    gestionable && zona.estado !== 'cerrada'
                      ? () => setReasignando(zona)
                      : undefined
                  }
                  onQuitar={
                    gestionable &&
                    sesionActiva.estado === 'abierta' &&
                    cargados === 0 &&
                    zonasVisibles.length > 1
                      ? () => setQuitando(zona)
                      : undefined
                  }
                />
              )
            })}
            {!cargandoZonas && !esGestor && misZonas.length === 0 && (
              <p className="rounded-xl border border-dashed border-[#e4c9b0] bg-white/60 p-4 text-center text-sm text-[#6f3a2a]">
                No tenés tareas asignadas en esta sesión.
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

      {sesionActiva && (
        <DialogoAgregarTareas
          sesionId={sesionActiva.id}
          sesionNombre={sesionActiva.nombre}
          abierto={agregarAbierto}
          onCambioAbierto={setAgregarAbierto}
        />
      )}

      <DialogoReasignarTarea
        zona={reasignando}
        onCerrar={() => setReasignando(null)}
      />

      <ConfirmacionAccion
        abierto={quitando !== null}
        onCambioAbierto={(v) => !v && setQuitando(null)}
        titulo={`¿Quitar “${quitando?.nombre ?? ''}”?`}
        descripcion="Nadie cargó nada en esta tarea. Sus productos quedan libres para otra tarea de esta sesión."
        textoConfirmar="Quitar tarea"
        destructiva
        procesando={quitar.isPending}
        onConfirmar={() => {
          if (!quitando) return
          quitar.mutate(quitando.id, { onSuccess: () => setQuitando(null) })
        }}
      />

      <ConfirmacionAccion
        abierto={confirmarRevision}
        onCambioAbierto={setConfirmarRevision}
        titulo="Hay productos contados a medias"
        descripcion="Una vez en revisión, el personal ya no puede cargar. Si los pasás así, esos productos van a figurar con faltante."
        textoConfirmar="Pasar a revisión igual"
        procesando={pasar.isPending}
        onConfirmar={pasarARevision}
      >
        <p>
          Conviene mandar a contar primero los lugares que faltan (botón
          “Mandar a contar lo que falta”). Si igual seguís, desde la revisión
          podés volver a abrir la sesión.
        </p>
      </ConfirmacionAccion>
    </div>
  )
}
