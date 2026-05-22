'use client'

import { useQuery } from '@tanstack/react-query'
import {
  getDeadStock,
  getMermasPorCategoria,
  getReporteVentas,
  getRotacionInventario,
  getTopProductos,
} from '@/lib/queries/reportes'

export function useReporteVentas(desde: string, hasta: string) {
  return useQuery({
    queryKey: ['reporte-ventas', desde, hasta],
    queryFn: () => getReporteVentas(desde, hasta),
    staleTime: 60 * 1000,
  })
}

export function useTopProductosReporte(desde: string, hasta: string) {
  return useQuery({
    queryKey: ['reporte-top-productos', desde, hasta],
    queryFn: () => getTopProductos(desde, hasta, 20),
    staleTime: 60 * 1000,
  })
}

export function useRotacionInventario(desde: string, hasta: string) {
  return useQuery({
    queryKey: ['reporte-rotacion', desde, hasta],
    queryFn: () => getRotacionInventario(desde, hasta),
    staleTime: 60 * 1000,
  })
}

export function useDeadStock(diasUmbral = 30) {
  return useQuery({
    queryKey: ['reporte-dead-stock', diasUmbral],
    queryFn: () => getDeadStock(diasUmbral),
    staleTime: 60 * 1000,
  })
}

export function useMermasPorCategoria(desde: string, hasta: string) {
  return useQuery({
    queryKey: ['reporte-mermas-categoria', desde, hasta],
    queryFn: () => getMermasPorCategoria(desde, hasta),
    staleTime: 60 * 1000,
  })
}
