import type { EstadoPaseTurno, PaseTurnoRow, TurnoPlantillaRow } from '@/types/database'

/** Los 4 bloques obligatorios del pase (Manual §6.6). */
export const BLOQUES_PASE = [
  {
    clave: 'reposicion',
    etiqueta: 'Reposición',
    ayuda: 'Estado de góndolas y heladeras; faltantes y pendientes de reponer.',
    conforme: 'conforme_reposicion',
  },
  {
    clave: 'orden_limpieza',
    etiqueta: 'Orden y limpieza',
    ayuda: 'Estado del salón, caja, fiambrería, depósito y sectores operativos.',
    conforme: 'conforme_orden',
  },
  {
    clave: 'novedades',
    etiqueta: 'Novedades / incidencias',
    ayuda: 'Hechos relevantes del turno: proveedores, clientes, equipos, problemas.',
    conforme: 'conforme_novedades',
  },
] as const

export const ESTADO_PASE: Record<EstadoPaseTurno, { label: string; clase: string }> = {
  borrador: { label: 'Borrador', clase: 'bg-[#f3ece4] text-[#c8a58a]' },
  entregado: { label: 'Por recibir', clase: 'bg-[#f9b44c]/30 text-[#391511]' },
  recibido: { label: 'Recibido', clase: 'bg-[#2f7d4f]/15 text-[#2f7d4f]' },
}

/** Cantidad de bloques marcados "no conforme" (0 si no fue recibido). */
export function noConformes(p: PaseTurnoRow): number {
  return [p.conforme_reposicion, p.conforme_orden, p.conforme_novedades, p.conforme_pendientes]
    .filter((c) => c === false).length
}

/** Hora actual en Argentina como "HH:mm". */
export function horaActualAr(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
}

/**
 * Turno que está terminando ahora (para preseleccionar el saliente). Si la
 * hora cae dentro de un turno, es ese; el entrante es el siguiente en la
 * lista ordenada por hora de inicio.
 */
export function turnoActualPorHora(turnos: TurnoPlantillaRow[]): {
  saliente: TurnoPlantillaRow | null
  entrante: TurnoPlantillaRow | null
} {
  const activos = turnos.filter((t) => t.activo).sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio))
  if (activos.length === 0) return { saliente: null, entrante: null }
  const ahora = horaActualAr()
  const hhmm = (t: string) => t.slice(0, 5)
  let idx = activos.findIndex((t) => {
    const ini = hhmm(t.hora_inicio)
    const fin = hhmm(t.hora_fin)
    return t.cruza_medianoche ? ahora >= ini || ahora < fin : ahora >= ini && ahora < fin
  })
  if (idx < 0) idx = activos.length - 1
  return { saliente: activos[idx], entrante: activos[(idx + 1) % activos.length] }
}
