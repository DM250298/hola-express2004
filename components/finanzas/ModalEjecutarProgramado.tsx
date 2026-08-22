'use client'

import { useEffect, useState } from 'react'
import { CalendarClock, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MontoARS } from '@/components/shared/MontoARS'
import { formatearFechaCorta } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import {
  FORMA_PAGO_LABEL,
  esFormaPago,
  labelComprobante,
  requiereComprobante,
  type PagoProgramadoConDatos,
} from '@/lib/queries/finanzas'

interface Props {
  programado: PagoProgramadoConDatos | null
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  ejecutando: boolean
  /** Confirma la ejecución; `comprobante` ya viene validado según la forma. */
  onEjecutar: (programado: PagoProgramadoConDatos, comprobante: string | null) => void
}

/**
 * Confirmación de "Ejecutar" un pago programado (mig 155). Reemplaza al
 * window.confirm: acá es donde la transferencia se hace de verdad, así que
 * es el momento de cargar el N° (obligatorio con transferencia / cheque /
 * débito). Si el programado ya traía número, se precarga y se puede corregir.
 */
export function ModalEjecutarProgramado({
  programado,
  abierto,
  onCambioAbierto,
  ejecutando,
  onEjecutar,
}: Props) {
  const [comprobante, setComprobante] = useState('')

  useEffect(() => {
    if (abierto) setComprobante(programado?.comprobante ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, programado?.id])

  if (!programado) return null

  const forma = programado.forma_pago
  const requiere = requiereComprobante(forma)
  const falta = requiere && comprobante.trim() === ''

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !ejecutando && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-5 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
          <DialogTitle className="text-[#391511] flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-[#f9b44c]" />
            Ejecutar pago programado
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {programado.proveedor_nombre ?? 'Proveedor'} ·{' '}
            <span className="font-bold tabular-nums text-[#391511]">
              <MontoARS monto={programado.monto} />
            </span>{' '}
            desde {programado.cuenta_origen_nombre ?? 'la cuenta'}
            {esFormaPago(forma) ? ` · ${FORMA_PAGO_LABEL[forma]}` : ''}
            {' · programado para el '}
            {formatearFechaCorta(programado.fecha_programada)}
          </DialogDescription>
        </DialogHeader>

        <form
          className="px-5 py-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (falta || ejecutando) return
            onEjecutar(programado, comprobante.trim() || null)
          }}
        >
          <p className="text-xs text-[#6f3a2a]">
            La plata se descuenta <strong>ahora</strong> de la cuenta (con
            fecha de hoy), no en la fecha programada.
          </p>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              {labelComprobante(forma)}{' '}
              {requiere ? (
                <span className="text-[#c43e2c]">*</span>
              ) : (
                <span className="normal-case text-[#c8a58a] font-normal">
                  (opcional)
                </span>
              )}
            </Label>
            <Input
              autoFocus
              value={comprobante}
              onChange={(e) => setComprobante(e.target.value)}
              placeholder={
                requiere
                  ? `${labelComprobante(forma)} (obligatorio)`
                  : 'N° de la operación o recibo'
              }
              disabled={ejecutando}
              className={cn(
                'focus-visible:ring-[#f9b44c]',
                falta ? 'border-[#f9b44c]' : 'border-[#e4c9b0]'
              )}
            />
            {falta && (
              <p className="text-[11px] text-[#b3821b]">
                Poné el {labelComprobante(forma)}: es el número que queda en
                Egresos y en la conciliación.
              </p>
            )}
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => onCambioAbierto(false)}
              disabled={ejecutando}
              className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={falta || ejecutando}
              className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
            >
              {ejecutando ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Ejecutando…
                </>
              ) : (
                <>
                  Pagar <MontoARS monto={programado.monto} />
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
