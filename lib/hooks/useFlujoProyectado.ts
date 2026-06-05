'use client'

import { useQuery } from '@tanstack/react-query'
import {
  getFlujoProyectado,
  type OpcionesFlujo,
} from '@/lib/queries/flujoProyectado'

export function useFlujoProyectado(opciones: OpcionesFlujo) {
  const { horizonteSemanas = 8, sueldosMensuales = 0, diaPagoSueldos = 5 } =
    opciones
  return useQuery({
    queryKey: [
      'flujo-proyectado',
      horizonteSemanas,
      sueldosMensuales,
      diaPagoSueldos,
    ],
    queryFn: () =>
      getFlujoProyectado({ horizonteSemanas, sueldosMensuales, diaPagoSueldos }),
    staleTime: 60 * 1000,
  })
}
