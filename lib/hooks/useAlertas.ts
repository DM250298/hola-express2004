'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  actualizarReglaAlerta,
  crearTareaAlertas,
  evaluarAlertas,
  getAlertas,
  getReglasAlerta,
  getResumenAlertas,
  posponerAlertas,
  reabrirAlertas,
  type DatosTareaAlertas,
  type ParametrosRegla,
  type SeveridadAlerta,
} from '@/lib/queries/alertas'

export const ALERTAS_KEY = ['alertas'] as const

/** Las pantallas re-evalúan al abrir si la última corrida tiene más de esto. */
const MINUTOS_REVISION_AUTO = 30

/** Revisión automática y silenciosa: si falla, se muestra lo último que hay. */
async function revisarSiHaceFalta() {
  return evaluarAlertas({ origen: 'auto', siAntiguedadMin: MINUTOS_REVISION_AUTO }).catch(
    () => null
  )
}

/** Lista para /alertas: vivas + resueltas de los últimos N días. */
export function useAlertas(diasResueltas = 30) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: [...ALERTAS_KEY, 'lista', diasResueltas],
    queryFn: async () => {
      const r = await revisarSiHaceFalta()
      if (r?.evaluada) {
        queryClient.invalidateQueries({ queryKey: [...ALERTAS_KEY, 'resumen'] })
      }
      return getAlertas(diasResueltas)
    },
    staleTime: 60 * 1000,
  })
}

/** Conteos y grupos (tablero del dueño). `evaluar` = revisar antes de leer. */
export function useResumenAlertas(opciones: { habilitado?: boolean; evaluar?: boolean } = {}) {
  const { habilitado = true, evaluar = true } = opciones
  return useQuery({
    queryKey: [...ALERTAS_KEY, 'resumen', evaluar],
    queryFn: async () => {
      if (evaluar) await revisarSiHaceFalta()
      return getResumenAlertas()
    },
    enabled: habilitado,
    staleTime: 2 * 60 * 1000,
    retry: false,
  })
}

export function useReglasAlerta() {
  return useQuery({
    queryKey: [...ALERTAS_KEY, 'reglas'],
    queryFn: getReglasAlerta,
    staleTime: 5 * 60 * 1000,
  })
}

export function useEvaluarAlertasAhora() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => evaluarAlertas({ origen: 'manual' }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ALERTAS_KEY })
      if (r === null) {
        toast.error('Faltan correr las migraciones de alertas (183 a 189).')
      } else if (!r.evaluada && r.motivo === 'en_curso') {
        toast.info('Ya se están revisando las alertas; en unos segundos se actualiza.')
      } else if (!r.evaluada) {
        toast.error(`No se pudieron revisar las alertas: ${r.error ?? 'error desconocido'}`)
      } else {
        toast.success(
          `Revisadas: ${r.nuevas ?? 0} nuevas, ${r.resueltas ?? 0} resueltas, ${r.vivas ?? 0} activas.`
        )
      }
    },
    onError: (error: Error) => {
      toast.error(`No se pudieron revisar las alertas: ${error.message}`)
    },
  })
}

export function useCrearTareaAlertas() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (datos: DatosTareaAlertas) => crearTareaAlertas(datos),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ALERTAS_KEY })
      toast.success('Tarea creada: ya está en el "Mi día" del responsable.')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo crear la tarea: ${error.message}`)
    },
  })
}

export function usePosponerAlertas() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, dias, motivo }: { ids: number[]; dias: number; motivo: string }) =>
      posponerAlertas(ids, dias, motivo),
    onSuccess: (cantidad, { dias }) => {
      queryClient.invalidateQueries({ queryKey: ALERTAS_KEY })
      toast.success(
        `${cantidad} ${cantidad === 1 ? 'alerta pospuesta' : 'alertas pospuestas'} por ${dias} días.`
      )
    },
    onError: (error: Error) => {
      toast.error(`No se pudo posponer: ${error.message}`)
    },
  })
}

export function useReabrirAlertas() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) => reabrirAlertas(ids),
    onSuccess: (cantidad) => {
      queryClient.invalidateQueries({ queryKey: ALERTAS_KEY })
      toast.success(`${cantidad} ${cantidad === 1 ? 'alerta volvió' : 'alertas volvieron'} a "Para resolver".`)
    },
    onError: (error: Error) => {
      toast.error(`No se pudo reabrir: ${error.message}`)
    },
  })
}

export function useActualizarReglaAlerta() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      codigo,
      cambios,
    }: {
      codigo: string
      cambios: { activa: boolean; severidad: SeveridadAlerta; parametros: ParametrosRegla }
    }) => actualizarReglaAlerta(codigo, cambios),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ALERTAS_KEY })
      toast.success('Regla guardada. Los cambios de umbral se aplican en la próxima revisión.')
    },
    onError: (error: Error) => {
      toast.error(`No se pudo guardar la regla: ${error.message}`)
    },
  })
}
