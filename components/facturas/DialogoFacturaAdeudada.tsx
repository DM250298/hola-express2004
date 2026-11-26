'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatearFechaCortaISO } from '@/lib/utils/formato'
import { useMarcarFacturaAdeudada } from '@/lib/hooks/useFacturasCompra'
import type { FilaPortal } from '@/lib/facturas/portal'
import { textoDiasAdeudada } from './ChipEstadoFactura'

interface Props {
  /** Fila sin factura sobre la que se marca; null = cerrado. */
  fila: FilaPortal | null
  onCerrar: () => void
}

/**
 * Marca (o desmarca) una recepción sin factura como "el proveedor la debe":
 * separa lo que está en papel sin cargar de lo que el proveedor no entregó.
 */
export function DialogoFacturaAdeudada({ fila, onCerrar }: Props) {
  const marcar = useMarcarFacturaAdeudada()
  const [nota, setNota] = useState('')
  const clave = fila?.clave ?? null
  const notaInicial = fila?.adeudada_nota ?? ''

  // Al abrir sobre otra fila, arranca con la nota que ya tenía.
  useEffect(() => {
    if (clave) setNota(notaInicial)
  }, [clave, notaInicial])

  const cuentaId = fila?.cuenta?.id ?? null
  const yaMarcada = !!fila?.adeudada_desde

  function guardar(adeudada: boolean) {
    if (cuentaId == null) return
    marcar.mutate(
      { cuentaId, adeudada, nota: adeudada ? nota : null },
      { onSuccess: onCerrar }
    )
  }

  return (
    <Dialog open={fila !== null} onOpenChange={(v) => !v && !marcar.isPending && onCerrar()}>
      <DialogContent className="sm:max-w-md" showCloseButton={!marcar.isPending}>
        <DialogHeader>
          <DialogTitle className="text-[#391511]">
            {yaMarcada ? 'El proveedor debe la factura' : '¿El proveedor debe la factura?'}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {fila?.proveedor_nombre}
            {fila?.pedido_id != null ? ` · orden #${fila.pedido_id}` : ''}
            {fila ? ` · recibida ${formatearFechaCortaISO(fila.fecha_comprobante)}` : ''}
            {yaMarcada && fila?.adeudada_desde
              ? ` · marcada el ${formatearFechaCortaISO(fila.adeudada_desde)}${textoDiasAdeudada(fila)}`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <label htmlFor="nota-adeudada" className="text-xs font-semibold text-[#391511]">
            Nota (opcional)
          </label>
          <Input
            id="nota-adeudada"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Ej.: la trae el viajante el lunes"
            maxLength={200}
            className="border-[#e4c9b0] bg-white"
          />
          <p className="text-[11px] text-[#6f3a2a]">
            Queda en la bandeja &quot;Las debe el proveedor&quot; hasta que cargues la factura.
          </p>
        </div>

        <DialogFooter>
          {yaMarcada && (
            <Button
              variant="ghost"
              onClick={() => guardar(false)}
              disabled={marcar.isPending}
              className="mr-auto text-[#6f3a2a] hover:bg-[#f9d2a2]/40"
            >
              Ya no la debe
            </Button>
          )}
          <Button
            variant="outline"
            onClick={onCerrar}
            disabled={marcar.isPending}
            className="border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={() => guardar(true)}
            disabled={marcar.isPending}
            className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold"
          >
            {marcar.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {yaMarcada ? 'Guardar nota' : 'Sí, la debe'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
