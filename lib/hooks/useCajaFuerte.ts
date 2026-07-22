'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  registrarSangria,
  getSangriasEnBuzon,
  getTotalSangriasTurno,
  getArqueos,
  validarArqueo,
  getRemesas,
  generarRemesa,
  getSaldoCajaFuerte,
  getMovimientosCajaFuerte,
  registrarMovimientoCajaFuerte,
  getDiferenciasCierrePorEmpleado,
  getArqueosPeriodo,
  type ValidarArqueoPayload,
  type GenerarRemesaPayload,
  type RegistrarMovimientoCajaFuertePayload,
} from '@/lib/queries/cajaFuerte'
import { getTotalRemesado } from '@/lib/queries/posicionCaja'
import { MOSTRAR_REMESAS } from '@/lib/config/tesoreria'

export const CAJA_FUERTE_KEY = ['caja-fuerte'] as const

export function useSangriasEnBuzon() {
  return useQuery({
    queryKey: [...CAJA_FUERTE_KEY, 'buzon'],
    queryFn: getSangriasEnBuzon,
    staleTime: 30 * 1000,
  })
}

export function useSaldoCajaFuerte() {
  return useQuery({
    queryKey: [...CAJA_FUERTE_KEY, 'saldo'],
    queryFn: getSaldoCajaFuerte,
    staleTime: 30 * 1000,
  })
}

/**
 * Total histórico remesado. Bajo la key de caja fuerte para que las mutaciones
 * del circuito (sangría/arqueo/remesa) lo invaliden solas.
 */
export function useTotalRemesado() {
  return useQuery({
    queryKey: [...CAJA_FUERTE_KEY, 'remesado-total'],
    queryFn: getTotalRemesado,
    staleTime: 30 * 1000,
  })
}

export function useArqueos() {
  return useQuery({
    queryKey: [...CAJA_FUERTE_KEY, 'arqueos'],
    queryFn: () => getArqueos(),
    staleTime: 30 * 1000,
  })
}

export function useRemesas() {
  return useQuery({
    queryKey: [...CAJA_FUERTE_KEY, 'remesas'],
    queryFn: () => getRemesas(),
    // El circuito de remesas está oculto por ahora: no dispares la query si no
    // se muestra (se reactiva junto con la UI vía MOSTRAR_REMESAS).
    enabled: MOSTRAR_REMESAS,
    staleTime: 30 * 1000,
  })
}

export function useMovimientosCajaFuerte() {
  return useQuery({
    queryKey: [...CAJA_FUERTE_KEY, 'movimientos'],
    queryFn: () => getMovimientosCajaFuerte(),
    staleTime: 30 * 1000,
  })
}

export function useDiferenciasCierrePorEmpleado(desde: string, hasta: string) {
  return useQuery({
    queryKey: [...CAJA_FUERTE_KEY, 'dif-cierre', desde, hasta],
    queryFn: () => getDiferenciasCierrePorEmpleado(desde, hasta),
    staleTime: 60 * 1000,
  })
}

export function useArqueosPeriodo(desde: string, hasta: string) {
  return useQuery({
    queryKey: [...CAJA_FUERTE_KEY, 'arqueos-periodo', desde, hasta],
    queryFn: () => getArqueosPeriodo(desde, hasta),
    staleTime: 60 * 1000,
  })
}

export function useTotalSangriasTurno(turnoId: number | undefined) {
  return useQuery({
    queryKey: [...CAJA_FUERTE_KEY, 'turno', turnoId],
    queryFn: () => getTotalSangriasTurno(turnoId as number),
    enabled: turnoId != null,
    staleTime: 15 * 1000,
  })
}

function invalidarTodo(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: CAJA_FUERTE_KEY })
}

/**
 * Desde el candado (mig 118) el arqueo, el movimiento manual y la remesa
 * mueven la cuenta "Caja Efectivo" de verdad → hay que refrescar también
 * Cuentas, Movimientos, el Tablero y el Flujo proyectado.
 */
function invalidarBoveda(qc: ReturnType<typeof useQueryClient>) {
  invalidarTodo(qc)
  qc.invalidateQueries({ queryKey: ['cuentas'] })
  qc.invalidateQueries({ queryKey: ['movimientos-cuenta'] })
  qc.invalidateQueries({ queryKey: ['tablero-directivo'] })
  qc.invalidateQueries({ queryKey: ['flujo-proyectado'] })
}

export function useRegistrarSangria() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      turno_id: number
      usuario_id: string
      monto: number
      nota: string | null
    }) => registrarSangria(payload),
    onSuccess: () => {
      invalidarTodo(qc)
      toast.success('Sangría registrada · sobre en el buzón')
    },
    onError: (e: Error) =>
      toast.error(`No se pudo registrar la sangría: ${e.message}`),
  })
}

export function useValidarArqueo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: ValidarArqueoPayload) => validarArqueo(payload),
    onSuccess: (data) => {
      invalidarBoveda(qc)
      const dif = Number(
        (data as { diferencia?: number } | null)?.diferencia ?? 0
      )
      if (dif === 0) {
        toast.success('Arqueo validado · sin diferencias')
      } else {
        toast.warning(
          `Arqueo cerrado con diferencia de ${dif}. Quedó registrada la nota de ajuste.`
        )
      }
    },
    onError: (e: Error) => toast.error(`No se pudo validar: ${e.message}`),
  })
}

export function useGenerarRemesa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: GenerarRemesaPayload) => generarRemesa(payload),
    onSuccess: () => {
      invalidarBoveda(qc)
      toast.success('Remesa generada · caja fuerte → banco')
    },
    onError: (e: Error) => toast.error(`No se pudo generar la remesa: ${e.message}`),
  })
}

export function useRegistrarMovimientoCajaFuerte() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: RegistrarMovimientoCajaFuertePayload) =>
      registrarMovimientoCajaFuerte(payload),
    onSuccess: (_data, vars) => {
      // El movimiento manual mueve la cuenta bóveda → refrescar todo.
      invalidarBoveda(qc)
      toast.success(
        vars.tipo === 'ingreso'
          ? 'Ingreso registrado en la caja fuerte'
          : 'Egreso registrado en la caja fuerte'
      )
    },
    onError: (e: Error) =>
      toast.error(`No se pudo registrar el movimiento: ${e.message}`),
  })
}
