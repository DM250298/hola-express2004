'use client'

import { useState } from 'react'
import { CalendarClock, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MontoARS } from '@/components/shared/MontoARS'
import { ModalEjecutarProgramado } from '@/components/finanzas/ModalEjecutarProgramado'
import { formatearFechaCortaISO } from '@/lib/utils/formato'
import { hoyIso } from '@/lib/utils/periodos'
import {
  useCancelarPagoProgramado,
  useEjecutarPagoProgramado,
  usePagosProgramados,
} from '@/lib/hooks/useFinanzas'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { cn } from '@/lib/utils'
import {
  FORMA_PAGO_LABEL,
  esFormaPago,
  labelComprobante,
  type PagoProgramadoConDatos,
} from '@/lib/queries/finanzas'

/**
 * Pagos agendados al cargar una factura (mig 146): no descuentan plata hasta
 * que se ejecutan. Antes vivía dentro de Finanzas › Cuentas a pagar; el
 * portal de facturas lo muestra arriba de la lista cuando hay alguno.
 */
export function SeccionPagosProgramados() {
  const { data: programados } = usePagosProgramados()
  const { data: usuario } = useUsuario()
  const ejecutarProg = useEjecutarPagoProgramado()
  const cancelarProg = useCancelarPagoProgramado()
  const [programadoEjecutar, setProgramadoEjecutar] =
    useState<PagoProgramadoConDatos | null>(null)
  const hoy = hoyIso()

  const lista = programados ?? []
  if (lista.length === 0) return null

  return (
    <div className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <CalendarClock className="h-4 w-4 text-[#9e6b15]" />
        <h3 className="text-sm font-semibold text-[#391511]">Pagos programados</h3>
        <span className="text-[10px] font-bold text-[#9e6b15] bg-[#f9b44c]/20 rounded-full px-2 py-0.5">
          {lista.length}
        </span>
        <span className="text-[11px] text-[#c8a58a]">
          No descuentan plata hasta que los ejecutes.
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {lista.map((p) => {
          const vencido = p.fecha_programada <= hoy
          return (
            <div
              key={p.id}
              className={cn(
                'rounded-xl border bg-[#fdfaf6] p-3 space-y-2',
                vencido ? 'border-[#c43e2c]/50' : 'border-[#e4c9b0]/60'
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-[#391511] text-sm truncate">
                    {p.proveedor_nombre ?? 'Proveedor'}
                  </div>
                  <div className="text-[11px] text-[#6f3a2a] truncate">
                    {p.cuenta_origen_nombre ?? 'cuenta'}
                    {esFormaPago(p.forma_pago) ? ` · ${FORMA_PAGO_LABEL[p.forma_pago]}` : ''}
                    {p.pedido_id ? ` · orden #${p.pedido_id}` : ''}
                  </div>
                  {p.comprobante && (
                    <div className="text-[10px] text-[#6f3a2a] truncate">
                      {labelComprobante(p.forma_pago)}: {p.comprobante}
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold text-[#391511] tabular-nums text-sm">
                    <MontoARS monto={p.monto} />
                  </div>
                  <div
                    className={cn(
                      'text-[10px] font-semibold',
                      vencido ? 'text-[#c43e2c]' : 'text-[#6f3a2a]'
                    )}
                  >
                    {vencido ? (p.fecha_programada === hoy ? 'para HOY · ' : 'atrasado · ') : ''}
                    {formatearFechaCortaISO(p.fecha_programada)}
                  </div>
                </div>
              </div>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  disabled={!usuario || ejecutarProg.isPending || cancelarProg.isPending}
                  onClick={() => setProgramadoEjecutar(p)}
                  className="flex-1 h-8 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold"
                >
                  {ejecutarProg.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    'Ejecutar'
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={ejecutarProg.isPending || cancelarProg.isPending}
                  onClick={() => {
                    const ok = window.confirm(
                      '¿Cancelar este pago programado? La deuda queda a cuenta corriente.'
                    )
                    if (ok) cancelarProg.mutate(p.id)
                  }}
                  className="h-8 border-[#e4c9b0] text-[#6f3a2a]"
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      <ModalEjecutarProgramado
        programado={programadoEjecutar}
        abierto={programadoEjecutar !== null}
        onCambioAbierto={(v) => !v && setProgramadoEjecutar(null)}
        ejecutando={ejecutarProg.isPending}
        onEjecutar={(p, comprobante) => {
          if (!usuario) return
          ejecutarProg.mutate(
            { programadoId: p.id, usuarioId: usuario.id, comprobante },
            { onSuccess: () => setProgramadoEjecutar(null) }
          )
        }}
      />
    </div>
  )
}
