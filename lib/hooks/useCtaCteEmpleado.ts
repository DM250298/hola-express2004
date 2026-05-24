'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  crearMovimientoCtaCte,
  eliminarMovimientoCtaCte,
  getEmpleadosConSaldo,
  getMovimientosCtaCte,
} from '@/lib/queries/ctaCteEmpleado'
import type { CuentaCorrienteEmpleadoInsert } from '@/types/database'

export const CTA_CTE_KEY = ['cta-cte-empleado'] as const
export const EMPLEADOS_SALDO_KEY = ['empleados-saldo'] as const

export function useEmpleadosConSaldo() {
  return useQuery({
    queryKey: EMPLEADOS_SALDO_KEY,
    queryFn: getEmpleadosConSaldo,
    staleTime: 30 * 1000,
  })
}

export function useMovimientosCtaCte(
  empleadoId: number | null | undefined
) {
  return useQuery({
    queryKey: [...CTA_CTE_KEY, empleadoId],
    queryFn: () => getMovimientosCtaCte(empleadoId as number),
    enabled: !!empleadoId,
    staleTime: 15 * 1000,
  })
}

function useCtaCteMutation<TVars>(
  fn: (v: TVars) => Promise<unknown>,
  okMsg: string
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CTA_CTE_KEY })
      qc.invalidateQueries({ queryKey: EMPLEADOS_SALDO_KEY })
      if (okMsg) toast.success(okMsg)
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useCrearMovimientoCtaCte() {
  return useCtaCteMutation(
    (d: CuentaCorrienteEmpleadoInsert) => crearMovimientoCtaCte(d),
    'Movimiento registrado'
  )
}

export function useEliminarMovimientoCtaCte() {
  return useCtaCteMutation(
    (id: number) => eliminarMovimientoCtaCte(id),
    'Movimiento eliminado'
  )
}
