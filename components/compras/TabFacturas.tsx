'use client'

import { PortalFacturas } from '@/components/facturas/PortalFacturas'
import { useCuentasSinFactura } from '@/lib/hooks/useFinanzas'

/**
 * Badge con el conteo de recepciones sin factura, para el trigger del tab.
 * Solo se monta cuando el tab existe (usuarios con permiso `finanzas`), así
 * la query no corre para cajeros.
 */
export function BadgePendientesFactura() {
  const { data: cuentas } = useCuentasSinFactura()
  const pendientes = cuentas?.length ?? 0
  if (pendientes === 0) return null
  return (
    <span className="ml-1 text-[10px] font-bold bg-[#c43e2c]/20 text-[#c43e2c] rounded-full px-1.5 py-0.5 tabular-nums">
      {pendientes}
    </span>
  )
}

/**
 * Compras › Facturas: el portal único de facturas de proveedores, embebido
 * en la pestaña. La misma pantalla vive en /compras/facturas (entrada del
 * menú) y recibe las redirecciones de Finanzas › Facturas de proveedores y
 * Finanzas › Cuentas a pagar.
 */
export function TabFacturas() {
  return <PortalFacturas embebido />
}
