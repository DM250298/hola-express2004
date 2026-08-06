'use client'

import { useState } from 'react'
import {
  HandCoins,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Receipt,
  ShoppingBag,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import { ModalCobrarCtaCte } from '@/components/finanzas/ModalCobrarCtaCte'
import { useCliente, useHistorialCliente } from '@/lib/hooks/useClientes'
import { useMediosPago } from '@/lib/hooks/useMediosPago'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { tienePermiso } from '@/lib/permisos'
import { etiquetaMedioFallback } from '@/lib/utils/iconosMedioPago'
import { formatearFecha, formatearFechaHora } from '@/lib/utils/formato'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  clienteId: number | null
  onEditar: () => void
}

export function ModalDetalleCliente({
  abierto,
  onCambioAbierto,
  clienteId,
  onEditar,
}: Props) {
  const { data: cliente, isLoading } = useCliente(clienteId ?? undefined)
  const { data: historial, isLoading: cargandoHistorial } =
    useHistorialCliente(clienteId ?? undefined)
  const { data: medios } = useMediosPago()
  const { data: usuario } = useUsuario()
  const [cobroAbierto, setCobroAbierto] = useState(false)
  const puedeCobrar = tienePermiso(usuario?.permisos, 'cuenta_corriente')

  function etiquetaMedio(codigo: string): string {
    return (
      (medios ?? []).find((m) => m.codigo === codigo)?.nombre ??
      etiquetaMedioFallback(codigo)
    )
  }

  return (
    <Dialog open={abierto} onOpenChange={onCambioAbierto}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">
            {isLoading ? 'Cargando…' : (cliente?.nombre ?? 'Cliente')}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Ficha del cliente e historial de compras.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4 max-h-[65vh] overflow-y-auto">
          {isLoading || !cliente ? (
            <div className="space-y-3">
              <Skeleton className="h-20 rounded-2xl bg-[#f9d2a2]/30" />
              <Skeleton className="h-32 rounded-2xl bg-[#f9d2a2]/30" />
            </div>
          ) : (
            <>
              {/* Contacto */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                {cliente.telefono && (
                  <div className="flex items-center gap-2 text-[#6f3a2a]">
                    <Phone className="h-3.5 w-3.5 text-[#c8a58a]" />
                    {cliente.telefono}
                  </div>
                )}
                {cliente.email && (
                  <div className="flex items-center gap-2 text-[#6f3a2a]">
                    <Mail className="h-3.5 w-3.5 text-[#c8a58a]" />
                    {cliente.email}
                  </div>
                )}
                {cliente.documento && (
                  <div className="flex items-center gap-2 text-[#6f3a2a]">
                    <Receipt className="h-3.5 w-3.5 text-[#c8a58a]" />
                    {cliente.documento}
                  </div>
                )}
                {cliente.direccion && (
                  <div className="flex items-center gap-2 text-[#6f3a2a]">
                    <MapPin className="h-3.5 w-3.5 text-[#c8a58a]" />
                    {cliente.direccion}
                  </div>
                )}
              </div>

              {cliente.notas && (
                <p className="text-xs text-[#6f3a2a] bg-[#fdfaf6] border border-[#e4c9b0]/60 rounded-lg px-3 py-2">
                  {cliente.notas}
                </p>
              )}

              {/* Métricas */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-[#e4c9b0]/60 bg-white p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                    Compras
                  </div>
                  <div className="text-xl font-extrabold text-[#391511] tabular-nums">
                    {cliente.cantidad_compras}
                  </div>
                </div>
                <div className="rounded-xl border border-[#e4c9b0]/60 bg-white p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                    Total gastado
                  </div>
                  <div className="text-xl font-extrabold text-[#391511] tabular-nums">
                    <MontoARS monto={cliente.total_gastado} />
                  </div>
                </div>
                <div className="rounded-xl border border-[#e4c9b0]/60 bg-white p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                    Última visita
                  </div>
                  <div className="text-sm font-bold text-[#391511]">
                    {cliente.ultima_compra
                      ? formatearFecha(cliente.ultima_compra)
                      : '—'}
                  </div>
                </div>
              </div>

              {/* Cuenta corriente (fiado) */}
              {(cliente.saldo_cta_cte > 0.009 ||
                (cliente.limite_credito ?? 0) > 0) && (
                <div
                  className={
                    cliente.saldo_cta_cte > 0.009
                      ? 'rounded-xl border-2 border-[#f9b44c]/40 bg-[#f9b44c]/10 p-3 flex items-center justify-between gap-2'
                      : 'rounded-xl border border-[#e4c9b0]/60 bg-[#fdfaf6] p-3 flex items-center justify-between gap-2'
                  }
                >
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                      Cuenta corriente
                    </div>
                    <div className="text-lg font-extrabold text-[#391511] tabular-nums">
                      {cliente.saldo_cta_cte > 0.009 ? (
                        <>
                          Debe <MontoARS monto={cliente.saldo_cta_cte} />
                        </>
                      ) : (
                        'Al día'
                      )}
                    </div>
                    {(cliente.limite_credito ?? 0) > 0 && (
                      <div className="text-[11px] text-[#6f3a2a]">
                        Tope <MontoARS monto={cliente.limite_credito ?? 0} />
                      </div>
                    )}
                  </div>
                  {puedeCobrar && cliente.saldo_cta_cte > 0.009 && (
                    <Button
                      size="sm"
                      onClick={() => setCobroAbierto(true)}
                      className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5 shrink-0"
                    >
                      <HandCoins className="h-3.5 w-3.5" />
                      Cobrar
                    </Button>
                  )}
                </div>
              )}

              {/* Historial */}
              <div>
                <h3 className="text-[#391511] font-bold text-sm mb-2">
                  Historial de compras
                </h3>
                {cargandoHistorial ? (
                  <Skeleton className="h-24 rounded-xl bg-[#f9d2a2]/30" />
                ) : !historial || historial.length === 0 ? (
                  <div className="p-6 text-center border border-[#e4c9b0]/60 rounded-xl">
                    <ShoppingBag className="h-5 w-5 mx-auto mb-1 text-[#c8a58a]" />
                    <p className="text-[#6f3a2a] text-sm">
                      Todavía no compró nada.
                    </p>
                  </div>
                ) : (
                  <div className="border border-[#e4c9b0]/60 rounded-xl overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                          <TableHead className="text-[#391511] font-semibold">
                            Fecha
                          </TableHead>
                          <TableHead className="text-[#391511] font-semibold">
                            Pago
                          </TableHead>
                          <TableHead className="text-right text-[#391511] font-semibold">
                            Total
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {historial.map((v) => (
                          <TableRow
                            key={v.id}
                            className="border-b-[#e4c9b0]/40"
                          >
                            <TableCell className="text-[#6f3a2a] text-sm">
                              {formatearFechaHora(v.fecha)}
                            </TableCell>
                            <TableCell className="text-[#6f3a2a] text-sm">
                              {etiquetaMedio(v.medio_pago)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-bold text-[#391511]">
                              <MontoARS monto={v.total} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cerrar
          </Button>
          <Button
            onClick={onEditar}
            disabled={!cliente}
            className="flex-1 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold gap-1.5"
          >
            <Pencil className="h-3.5 w-3.5" />
            Editar
          </Button>
        </div>
      </DialogContent>

      <ModalCobrarCtaCte
        abierto={cobroAbierto}
        onCambioAbierto={setCobroAbierto}
        deudorTipo="cliente"
        deudorId={cliente?.id ?? null}
        deudorNombre={cliente?.nombre ?? ''}
        saldo={cliente?.saldo_cta_cte ?? 0}
        contexto="finanzas"
      />
    </Dialog>
  )
}
