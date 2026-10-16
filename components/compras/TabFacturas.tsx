'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CheckCircle2, Inbox, Package } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { ModalCompraFactura } from '@/components/compras/ModalCompraFactura'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { useCuentasSinFactura } from '@/lib/hooks/useFinanzas'
import { cn } from '@/lib/utils'

/**
 * Pantalla responsable de cargar facturas de proveedores: Finanzas › Facturas
 * de proveedores (D3, oct-2026). Allá están las pendientes, las "Compras del
 * POS a controlar" y las cargadas por período.
 */
const HREF_FACTURAS_FINANZAS = '/finanzas?tab=comprobantes'

/** Cuentas a pagar todavía sin factura cargada (provisorias de recepción). */
function usarPendientesFactura() {
  const { data: cuentas, isLoading, isError } = useCuentasSinFactura()
  return { pendientes: cuentas ?? [], isLoading, isError }
}

/**
 * Badge con el conteo de recepciones sin factura, para el trigger del tab.
 * Solo se monta cuando el tab existe (usuarios con permiso `finanzas`), así
 * la query no corre para cajeros.
 */
export function BadgePendientesFactura() {
  const { pendientes } = usarPendientesFactura()
  if (pendientes.length === 0) return null
  return (
    <span className="ml-1 text-[10px] font-bold bg-[#c43e2c]/20 text-[#c43e2c] rounded-full px-1.5 py-0.5 tabular-nums">
      {pendientes.length}
    </span>
  )
}

/**
 * Compras › Facturas: la compra directa (sin orden) y un resumen de las
 * facturas que faltan cargar, con enlace a Finanzas. La carga de facturas se
 * hace solo en Finanzas (misma consulta `useCuentasSinFactura`: los dos
 * contadores coinciden siempre).
 */
export function TabFacturas() {
  const { pendientes, isLoading, isError } = usarPendientesFactura()
  const { data: usuario } = useUsuario()
  const [modalCompra, setModalCompra] = useState(false)

  const cantidad = pendientes.length

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-[#6f3a2a] text-sm max-w-xl">
          Para una compra que se paga en el acto y no tiene orden, usá{' '}
          <strong>Compra directa</strong>. Las facturas de lo que llegó con
          orden se cargan en <strong>Finanzas › Facturas de proveedores</strong>:
          ahí se ajusta el monto a pagar y se actualizan costos y precios.
        </p>
        <Button
          onClick={() => setModalCompra(true)}
          className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5 shrink-0"
        >
          <Package className="h-4 w-4" />
          Compra directa (sin orden)
        </Button>
      </div>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm p-5 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          {isError ? (
            <p className="text-[#c43e2c] text-sm">
              No se pudieron contar las facturas pendientes.
            </p>
          ) : (
            <>
              <div
                className={cn(
                  'inline-flex p-2.5 rounded-full',
                  cantidad > 0 ? 'bg-[#c43e2c]/10' : 'bg-[#2f8f4e]/10'
                )}
              >
                {cantidad > 0 ? (
                  <Inbox className="h-5 w-5 text-[#c43e2c]" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-[#2f8f4e]" />
                )}
              </div>
              <div>
                <p className="text-[#391511] font-semibold">
                  {isLoading
                    ? 'Contando facturas pendientes…'
                    : cantidad === 0
                      ? 'Todas las recepciones tienen su factura'
                      : cantidad === 1
                        ? '1 recepción espera su factura'
                        : `${cantidad} recepciones esperan su factura`}
                </p>
                <p className="text-[#6f3a2a] text-xs mt-0.5">
                  Se cargan en Finanzas › Facturas de proveedores.
                </p>
              </div>
            </>
          )}
        </div>
        <Link
          href={HREF_FACTURAS_FINANZAS}
          className={cn(
            buttonVariants({ variant: 'outline' }),
            'border-[#e4c9b0] text-[#391511] hover:bg-[#f9d2a2]/40 gap-1.5'
          )}
        >
          Ir a Facturas de proveedores
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {usuario && (
        <ModalCompraFactura
          abierto={modalCompra}
          onCambioAbierto={setModalCompra}
          contexto="finanzas"
          usuarioId={usuario.id}
        />
      )}
    </div>
  )
}
