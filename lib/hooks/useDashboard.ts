'use client'

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getAlertasResumen,
  getKPIsDia,
  getTopProductosDia,
  getTurnosDelDia,
  getVentasPorHora,
} from '@/lib/queries/dashboard'
import { createClient } from '@/lib/supabase/client'

export const KPIS_DIA_KEY = ['dashboard-kpis-dia'] as const
export const ALERTAS_DASH_KEY = ['dashboard-alertas'] as const
export const VENTAS_HORA_KEY = ['dashboard-ventas-hora'] as const
export const TOP_DIA_KEY = ['dashboard-top-dia'] as const
export const TURNOS_DIA_KEY = ['dashboard-turnos-dia'] as const

export function useKPIsDia() {
  return useQuery({
    queryKey: KPIS_DIA_KEY,
    queryFn: getKPIsDia,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  })
}

export function useAlertasDashboard() {
  return useQuery({
    queryKey: ALERTAS_DASH_KEY,
    queryFn: getAlertasResumen,
    staleTime: 60 * 1000,
  })
}

export function useVentasPorHora() {
  return useQuery({
    queryKey: VENTAS_HORA_KEY,
    queryFn: getVentasPorHora,
    staleTime: 60 * 1000,
  })
}

export function useTopProductosDia() {
  return useQuery({
    queryKey: TOP_DIA_KEY,
    queryFn: () => getTopProductosDia(5),
    staleTime: 60 * 1000,
  })
}

export function useTurnosDelDia() {
  return useQuery({
    queryKey: TURNOS_DIA_KEY,
    queryFn: getTurnosDelDia,
    staleTime: 60 * 1000,
  })
}

/**
 * Suscribe el dashboard a cambios en tiempo real de `ventas` y `caja_turnos`.
 * Cuando llega un evento, invalida las queries relacionadas y TanStack las
 * refresca automáticamente.
 *
 * Requisito: en el panel de Supabase, habilitar Realtime para las tablas
 * `ventas` y `caja_turnos` (Database → Replication → Habilitar).
 */
export function useRealtimeDashboard() {
  const qc = useQueryClient()

  useEffect(() => {
    const supabase = createClient()

    const canal = supabase
      .channel('dashboard-cambios')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ventas' },
        () => {
          qc.invalidateQueries({ queryKey: KPIS_DIA_KEY })
          qc.invalidateQueries({ queryKey: VENTAS_HORA_KEY })
          qc.invalidateQueries({ queryKey: TOP_DIA_KEY })
          qc.invalidateQueries({ queryKey: TURNOS_DIA_KEY })
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'caja_turnos' },
        () => {
          qc.invalidateQueries({ queryKey: KPIS_DIA_KEY })
          qc.invalidateQueries({ queryKey: TURNOS_DIA_KEY })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(canal)
    }
  }, [qc])
}
