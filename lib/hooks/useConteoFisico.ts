'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  abrirSesionConteo,
  agregarTareasConteo,
  cerrarSesionConteo,
  cerrarZona,
  getAvanceConteo,
  getCoberturaConteo,
  getConteosZona,
  getDiferenciasConteo,
  getItemsPorZona,
  getListaTarea,
  getSesionConteo,
  getSesionConteoActiva,
  getSesionesConteo,
  getZonaConteo,
  getZonasSesion,
  iniciarZona,
  pasarARevision,
  previsualizarTareas,
  quitarTareaConteo,
  reabrirSesionConteo,
  reasignarTareaConteo,
  registrarConteo,
  solicitarReconteo,
  type AbrirSesionPayload,
  type RegistrarConteoPayload,
  type SolicitarReconteoPayload,
  type TareaNueva,
} from '@/lib/queries/conteoFisico'

export const CONTEO_SESIONES_KEY = ['conteo-sesiones'] as const
export const CONTEO_SESION_ACTIVA_KEY = ['conteo-sesion-activa'] as const

// ─── Queries ─────────────────────────────────────────────────────────────────

export function useSesionesConteo(habilitado = true) {
  return useQuery({
    queryKey: CONTEO_SESIONES_KEY,
    queryFn: getSesionesConteo,
    enabled: habilitado,
    staleTime: 30 * 1000,
  })
}

export function useSesionConteoActiva() {
  return useQuery({
    queryKey: CONTEO_SESION_ACTIVA_KEY,
    queryFn: getSesionConteoActiva,
    staleTime: 60 * 1000,
  })
}

export function useSesionConteo(sesionId: number | null) {
  return useQuery({
    queryKey: ['conteo-sesion', sesionId],
    queryFn: () => {
      if (sesionId === null) return null
      return getSesionConteo(sesionId)
    },
    enabled: sesionId !== null,
    staleTime: 15 * 1000,
  })
}

export function useZonasSesion(sesionId: number | null) {
  return useQuery({
    queryKey: ['conteo-zonas', sesionId],
    queryFn: () => {
      if (sesionId === null) return []
      return getZonasSesion(sesionId)
    },
    enabled: sesionId !== null,
    staleTime: 15 * 1000,
  })
}

export function useZonaConteo(zonaId: number | null) {
  return useQuery({
    queryKey: ['conteo-zona', zonaId],
    queryFn: () => {
      if (zonaId === null) return null
      return getZonaConteo(zonaId)
    },
    enabled: zonaId !== null,
    staleTime: 10 * 1000,
  })
}

export function useConteosZona(zonaId: number | null) {
  return useQuery({
    queryKey: ['conteo-detalle-zona', zonaId],
    queryFn: () => {
      if (zonaId === null) return []
      return getConteosZona(zonaId)
    },
    enabled: zonaId !== null,
    staleTime: 5 * 1000,
  })
}

export function useItemsPorZona(sesionId: number | null) {
  return useQuery({
    queryKey: ['conteo-items-sesion', sesionId],
    queryFn: (): Promise<Record<number, number>> => {
      if (sesionId === null) return Promise.resolve({})
      return getItemsPorZona(sesionId)
    },
    enabled: sesionId !== null,
    staleTime: 15 * 1000,
  })
}

export function useDiferenciasConteo(sesionId: number | null, habilitado = true) {
  return useQuery({
    queryKey: ['conteo-diferencias', sesionId],
    queryFn: () => {
      if (sesionId === null) return []
      return getDiferenciasConteo(sesionId)
    },
    enabled: habilitado && sesionId !== null,
    staleTime: 15 * 1000,
  })
}

/**
 * Avance por tarea (contados / lista). `data === null` = migración 227
 * pendiente: la pantalla cae al conteo simple de `useItemsPorZona`.
 */
export function useAvanceConteo(sesionId: number | null) {
  return useQuery({
    queryKey: ['conteo-avance', sesionId],
    queryFn: () => {
      if (sesionId === null) return null
      return getAvanceConteo(sesionId)
    },
    enabled: sesionId !== null,
    staleTime: 15 * 1000,
  })
}

/** Productos contados a medias. Solo gestores (la función exige el permiso). */
export function useCoberturaConteo(sesionId: number | null, habilitado = true) {
  return useQuery({
    queryKey: ['conteo-cobertura', sesionId],
    queryFn: () => {
      if (sesionId === null) return null
      return getCoberturaConteo(sesionId)
    },
    enabled: habilitado && sesionId !== null,
    staleTime: 15 * 1000,
  })
}

/** Lista guiada de una tarea. Vacía = zona libre. */
export function useListaTarea(zonaId: number | null) {
  return useQuery({
    queryKey: ['conteo-lista-tarea', zonaId],
    queryFn: () => {
      if (zonaId === null) return []
      return getListaTarea(zonaId)
    },
    enabled: zonaId !== null,
    staleTime: 60 * 1000,
  })
}

/**
 * Vista previa del armado: cuántos productos le tocan a cada tarea.
 * `data === null` = migraciones 222+ pendientes. Conserva el resultado
 * anterior mientras recalcula, para que los números no parpadeen al tipear.
 */
export function useVistaPreviaTareas(zonas: TareaNueva[], habilitado = true) {
  return useQuery({
    queryKey: ['conteo-vista-previa', zonas],
    queryFn: () => previsualizarTareas(zonas),
    enabled: habilitado,
    staleTime: 20 * 1000,
    placeholderData: (previo) => previo,
    retry: false,
  })
}

// ─── Mutations ───────────────────────────────────────────────────────────────

function invalidarSesiones(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: CONTEO_SESIONES_KEY })
  qc.invalidateQueries({ queryKey: CONTEO_SESION_ACTIVA_KEY })
  qc.invalidateQueries({ queryKey: ['conteo-sesion'] })
  qc.invalidateQueries({ queryKey: ['conteo-zonas'] })
  qc.invalidateQueries({ queryKey: ['conteo-zona'] })
  qc.invalidateQueries({ queryKey: ['conteo-avance'] })
  qc.invalidateQueries({ queryKey: ['conteo-cobertura'] })
  qc.invalidateQueries({ queryKey: ['conteo-vista-previa'] })
}

export function useAgregarTareasConteo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { sesion_id: number; zonas: TareaNueva[] }) =>
      agregarTareasConteo(payload),
    onSuccess: (tareas) => {
      invalidarSesiones(qc)
      qc.invalidateQueries({ queryKey: ['conteo-lista-tarea'] })
      const creadas = tareas.reduce((suma, t) => suma + Math.max(t.partes, 1), 0)
      toast.success(
        creadas === 1 ? 'Tarea agregada al conteo' : `${creadas} tareas agregadas al conteo`
      )
    },
    onError: (error: Error) => {
      toast.error(`No se pudieron agregar las tareas: ${error.message}`)
    },
  })
}

export function useReasignarTareaConteo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { zona_id: number; responsable: string | null }) =>
      reasignarTareaConteo(payload),
    onSuccess: (zona) => {
      invalidarSesiones(qc)
      toast.success(`"${zona.nombre}" reasignada`)
    },
    onError: (error: Error) => {
      toast.error(`No se pudo reasignar: ${error.message}`)
    },
  })
}

export function useQuitarTareaConteo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (zonaId: number) => quitarTareaConteo(zonaId),
    onSuccess: () => {
      invalidarSesiones(qc)
      qc.invalidateQueries({ queryKey: ['conteo-items-sesion'] })
      toast.success('Tarea quitada del conteo')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo quitar la tarea: ${error.message}`)
    },
  })
}

export function useReabrirSesionConteo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sesionId: number) => reabrirSesionConteo(sesionId),
    onSuccess: () => {
      invalidarSesiones(qc)
      qc.invalidateQueries({ queryKey: ['conteo-diferencias'] })
      toast.success('Sesión abierta de nuevo — se puede seguir contando')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo volver a abrir la sesión: ${error.message}`)
    },
  })
}

export function useAbrirSesionConteo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: AbrirSesionPayload) => abrirSesionConteo(payload),
    onSuccess: (sesion) => {
      invalidarSesiones(qc)
      toast.success(`Sesión "${sesion.nombre}" abierta — snapshot del stock tomado`)
    },
    onError: (error: Error) => {
      toast.error(`No se pudo abrir la sesión: ${error.message}`)
    },
  })
}

export function useIniciarZona() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (zonaId: number) => iniciarZona(zonaId),
    onSuccess: (zona) => {
      invalidarSesiones(qc)
      qc.invalidateQueries({ queryKey: ['conteo-zona', zona.id] })
      toast.success(`Zona "${zona.nombre}" en curso — a contar`)
    },
    onError: (error: Error) => {
      toast.error(`No se pudo iniciar la zona: ${error.message}`)
    },
  })
}

export function useCerrarZona() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (zonaId: number) => cerrarZona(zonaId),
    onSuccess: (zona) => {
      invalidarSesiones(qc)
      qc.invalidateQueries({ queryKey: ['conteo-zona', zona.id] })
      qc.invalidateQueries({ queryKey: ['conteo-items-sesion'] })
      toast.success(`Zona "${zona.nombre}" cerrada`)
    },
    onError: (error: Error) => {
      toast.error(`No se pudo cerrar la zona: ${error.message}`)
    },
  })
}

export function useRegistrarConteo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: RegistrarConteoPayload) => registrarConteo(payload),
    onSuccess: (_detalle, variables) => {
      qc.invalidateQueries({ queryKey: ['conteo-detalle-zona', variables.zona_id] })
      qc.invalidateQueries({ queryKey: ['conteo-items-sesion'] })
      qc.invalidateQueries({ queryKey: ['conteo-avance'] })
      qc.invalidateQueries({ queryKey: ['conteo-cobertura'] })
      qc.invalidateQueries({ queryKey: ['conteo-diferencias'] })
      toast.success(
        variables.nombre_producto
          ? `${variables.nombre_producto}: ${variables.cantidad} guardado`
          : 'Conteo guardado'
      )
    },
    onError: (error: Error) => {
      toast.error(`No se pudo guardar el conteo: ${error.message}`)
    },
  })
}

export function usePasarARevision() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sesionId: number) => pasarARevision(sesionId),
    onSuccess: () => {
      invalidarSesiones(qc)
      qc.invalidateQueries({ queryKey: ['conteo-diferencias'] })
      toast.success('Sesión en revisión — mirá las diferencias')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo pasar a revisión: ${error.message}`)
    },
  })
}

export function useSolicitarReconteo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: SolicitarReconteoPayload) => solicitarReconteo(payload),
    onSuccess: (marcadas) => {
      qc.invalidateQueries({ queryKey: ['conteo-diferencias'] })
      qc.invalidateQueries({ queryKey: ['conteo-detalle-zona'] })
      qc.invalidateQueries({ queryKey: ['conteo-zonas'] })
      qc.invalidateQueries({ queryKey: ['conteo-zona'] })
      toast.success(`Reconteo solicitado (${marcadas} renglón/es reabiertos)`)
    },
    onError: (error: Error) => {
      toast.error(`No se pudo solicitar el reconteo: ${error.message}`)
    },
  })
}

export function useCerrarSesionConteo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { sesion_id: number; confirmo_sync: boolean }) =>
      cerrarSesionConteo(payload),
    onSuccess: () => {
      invalidarSesiones(qc)
      qc.invalidateQueries({ queryKey: ['conteo-diferencias'] })
      // El cierre ajusta stock y lotes: refrescar todo lo que dependa de eso.
      qc.invalidateQueries({ queryKey: ['inventario'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['productos-con-stock'] })
      qc.invalidateQueries({ queryKey: ['alertas-stock'] })
      qc.invalidateQueries({ queryKey: ['movimientos-stock'] })
      qc.invalidateQueries({ queryKey: ['lotes-activos'] })
      qc.invalidateQueries({ queryKey: ['resumen-vencimientos'] })
      // El toast con el resumen lo arma la pantalla (tiene los montos).
    },
    onError: (error: Error) => {
      toast.error(`No se pudo cerrar la sesión: ${error.message}`)
    },
  })
}
