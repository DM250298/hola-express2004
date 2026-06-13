'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  getDashboardRrhh,
  getEvaluacionEmpleado,
  getEvaluacionesPeriodo,
  guardarEvaluacion,
  type GuardarEvaluacionArgs,
} from '@/lib/queries/desempeno'

export const DESEMPENO_KEY = ['desempeno'] as const
export const DASHBOARD_RRHH_KEY = ['dashboard-rrhh'] as const

// ─── Evaluaciones de desempeño ────────────────────────────────────────────────

export function useEvaluacionesPeriodo(periodo: string) {
  return useQuery({
    queryKey: [...DESEMPENO_KEY, 'periodo', periodo],
    queryFn: () => getEvaluacionesPeriodo(periodo),
    enabled: !!periodo,
    staleTime: 30 * 1000,
  })
}

export function useEvaluacionEmpleado(
  periodo: string,
  empleadoId: number | undefined
) {
  return useQuery({
    queryKey: [...DESEMPENO_KEY, 'empleado', empleadoId, periodo],
    queryFn: () => getEvaluacionEmpleado(periodo, empleadoId as number),
    enabled: !!periodo && !!empleadoId,
    staleTime: 30 * 1000,
  })
}

export function useGuardarEvaluacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: GuardarEvaluacionArgs) => guardarEvaluacion(args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DESEMPENO_KEY })
      toast.success('Evaluación guardada')
    },
    onError: (e: Error) => toast.error(`No se pudo guardar: ${e.message}`),
  })
}

// ─── Tablero RRHH (polling en vivo) ───────────────────────────────────────────

export function useDashboardRrhh() {
  return useQuery({
    queryKey: DASHBOARD_RRHH_KEY,
    queryFn: getDashboardRrhh,
    // Operativo en tiempo real: se refresca solo cada 60s (quién trabaja ahora,
    // ausentes, etc.). Igual que el tablero de finanzas, sin Realtime.
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  })
}
