'use client'

import { useCallback, useMemo } from 'react'
import { useConfigFiscal } from '@/lib/hooks/useFiscal'
import { useMediosPago } from '@/lib/hooks/useMediosPago'
import { armarConfigPricing, regimenDesdeConfig } from '@/lib/pricing/config'
import { calcularPrecio, ErrorPricing } from '@/lib/pricing/motor'
import type {
  ConfigPricing,
  DesglosePrecio,
  RegimenFiscal,
} from '@/lib/pricing/tipos'

export interface PricingListo {
  /** Config armada desde config_fiscal + medios_pago. null mientras carga. */
  config: ConfigPricing | null
  regimen: RegimenFiscal | null
  cargando: boolean
  /**
   * Calcula el precio con margen asegurado para un costo dado. Devuelve el
   * desglose completo, o null si la config todavía no cargó. Si el divisor es
   * inválido, `error` trae el mensaje y el desglose es null.
   * `ivaVentaPorcentaje`: IVA de venta del producto (ej: 10.5); si se omite,
   * usa el IVA general de la config fiscal.
   */
  calcular: (
    costo: number,
    margenPorcentaje: number,
    ivaVentaPorcentaje?: number
  ) => { desglose: DesglosePrecio | null; error: string | null }
}

/**
 * Hook central del motor de precios para la UI. Combina la config fiscal y los
 * medios de pago en una ConfigPricing y expone un `calcular` memoizado. La
 * comisión de MP usada es siempre el peor caso (max de las tasas configuradas),
 * así que cambiar una tasa en la config recalcula los precios solos.
 */
export function usePricing(): PricingListo {
  const { data: fiscal, isLoading: cargandoFiscal } = useConfigFiscal()
  const { data: medios, isLoading: cargandoMedios } = useMediosPago()

  const config = useMemo<ConfigPricing | null>(() => {
    if (!fiscal || !medios) return null
    return armarConfigPricing(fiscal, medios)
  }, [fiscal, medios])

  const regimen = useMemo<RegimenFiscal | null>(
    () => (fiscal ? regimenDesdeConfig(fiscal.condicion_iva) : null),
    [fiscal]
  )

  const calcular = useCallback(
    (costo: number, margenPorcentaje: number, ivaVentaPorcentaje?: number) => {
      if (!config || !regimen) return { desglose: null, error: null }
      try {
        const desglose = calcularPrecio(
          {
            regimen,
            costo,
            margen: margenPorcentaje / 100,
            ivaVenta:
              ivaVentaPorcentaje != null ? ivaVentaPorcentaje / 100 : undefined,
          },
          config
        )
        return { desglose, error: null }
      } catch (e) {
        const error =
          e instanceof ErrorPricing
            ? e.message
            : 'No se pudo calcular el precio.'
        return { desglose: null, error }
      }
    },
    [config, regimen]
  )

  return {
    config,
    regimen,
    cargando: cargandoFiscal || cargandoMedios,
    calcular,
  }
}
