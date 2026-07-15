'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, ExternalLink, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { MontoARS } from '@/components/shared/MontoARS'
import { ModalEditarFactura } from '@/components/finanzas/ModalEditarFactura'
import { formatearFechaCorta } from '@/lib/utils/formato'
import { useCuentasSinFactura } from '@/lib/hooks/useFinanzas'
import type { CuentaAPagarConProveedor } from '@/lib/queries/finanzas'

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

export function TabFacturas() {
  const { pendientes, isLoading, isError } = usarPendientesFactura()
  const [cuentaFactura, setCuentaFactura] =
    useState<CuentaAPagarConProveedor | null>(null)

  return (
    <div className="space-y-5">
      <p className="text-[#6f3a2a] text-sm">
        Al recibir mercadería se crea una <strong>deuda provisoria</strong> con
        el monto estimado. Cargá acá la factura real del proveedor para cerrar
        el circuito: se ajusta el monto a pagar y se actualizan costos y precios.
      </p>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={5} columnas={4} />
          </div>
        ) : isError ? (
          <div className="p-10 text-center text-[#c43e2c] text-sm">
            No se pudieron cargar las cuentas a pagar.
          </div>
        ) : pendientes.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              <CheckCircle2 className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">
              Todas las recepciones tienen su factura
            </p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              Cuando recibas mercadería nueva, su factura pendiente va a aparecer
              acá.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                <TableHead className="text-[#391511] font-semibold">
                  Proveedor
                </TableHead>
                <TableHead className="text-[#391511] font-semibold">
                  Pedido
                </TableHead>
                <TableHead className="text-[#391511] font-semibold">
                  Factura N°
                </TableHead>
                <TableHead className="text-[#391511] font-semibold">
                  Vence
                </TableHead>
                <TableHead className="text-right text-[#391511] font-semibold">
                  Monto estimado
                </TableHead>
                <TableHead className="text-right w-40 text-[#391511] font-semibold">
                  Acción
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendientes.map((c) => (
                <TableRow
                  key={c.id}
                  className="border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6]"
                >
                  <TableCell className="font-medium text-[#391511]">
                    {c.proveedor_nombre ?? (
                      <span className="text-[#c8a58a] italic">—</span>
                    )}
                    {c.provisoria && (
                      <span className="ml-2 text-[9px] uppercase tracking-wider text-[#9e6b15] bg-[#f9b44c]/20 rounded-full px-1.5 py-0.5">
                        provisoria
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/pedidos/${c.pedido_id}`}
                      className="inline-flex items-center gap-1 text-[#c43e2c] hover:underline font-mono text-xs"
                    >
                      #{c.pedido_id}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </TableCell>
                  <TableCell className="text-[#6f3a2a] text-sm">
                    {c.numero_factura ? (
                      <span className="font-mono">{c.numero_factura}</span>
                    ) : (
                      <span className="text-[#c8a58a] italic">sin identificar</span>
                    )}
                  </TableCell>
                  <TableCell className="text-[#6f3a2a] text-sm tabular-nums">
                    {formatearFechaCorta(c.fecha_vencimiento)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-[#391511]">
                    <MontoARS monto={c.monto} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      onClick={() => setCuentaFactura(c)}
                      className="h-8 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Cargar factura
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <ModalEditarFactura
        abierto={cuentaFactura !== null}
        onCambioAbierto={(v) => !v && setCuentaFactura(null)}
        cuenta={cuentaFactura}
      />
    </div>
  )
}
