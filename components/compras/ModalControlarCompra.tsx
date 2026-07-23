'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, Package, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MontoARS } from '@/components/shared/MontoARS'
import { ConfirmacionAccion } from '@/components/shared/ConfirmacionAccion'
import { formatearFechaCorta } from '@/lib/utils/formato'
import {
  useControlarCompraDirecta,
  useAnularCompraDirecta,
} from '@/lib/hooks/useFacturasCompra'
import type { ComprobanteCargado } from '@/lib/queries/facturasCompra'

const TIPOS_COMPROBANTE = ['A', 'B', 'C', 'M', 'X']

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  compra: ComprobanteCargado | null
  proveedorNombre: string | null
  usuarioId: string
}

export function ModalControlarCompra({
  abierto,
  onCambioAbierto,
  compra,
  proveedorNombre,
  usuarioId,
}: Props) {
  const controlar = useControlarCompraDirecta()
  const anular = useAnularCompraDirecta()

  const [tipo, setTipo] = useState('A')
  const [punto, setPunto] = useState('')
  const [numero, setNumero] = useState('')
  const [cuit, setCuit] = useState('')
  const [confirmarAnular, setConfirmarAnular] = useState(false)

  useEffect(() => {
    if (abierto && compra) {
      setTipo(compra.tipo_comprobante ?? 'A')
      setPunto(compra.punto_venta ?? '')
      setNumero(compra.numero_comprobante ?? '')
      setCuit(compra.cuit_proveedor ?? '')
    }
  }, [abierto, compra])

  const procesando = controlar.isPending || anular.isPending

  function guardar(marcarControlada: boolean) {
    if (!compra) return
    controlar.mutate(
      {
        factura_id: compra.id,
        usuario_id: usuarioId,
        tipo: tipo || null,
        punto: punto.trim() || null,
        numero: numero.trim() || null,
        cuit: cuit.trim() || null,
        controlada: marcarControlada,
      },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <>
      <Dialog open={abierto} onOpenChange={(v) => !procesando && onCambioAbierto(v)}>
        <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
            <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
              <Package className="h-5 w-5 text-[#f9b44c]" />
              Controlar compra del POS
            </DialogTitle>
            <DialogDescription className="text-[#6f3a2a]">
              Revisá la factura que cargó el vendedor, corregí los datos del
              comprobante y marcala como controlada.
            </DialogDescription>
          </DialogHeader>

          {compra && (
            <div className="px-6 py-5 space-y-4">
              {/* Resumen (no editable: para cambiar montos o productos, anulá y recargá) */}
              <div className="rounded-xl border border-[#e4c9b0]/60 bg-[#fdfaf6] p-3 space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#6f3a2a]">Proveedor</span>
                  <span className="font-semibold text-[#391511]">
                    {proveedorNombre ?? '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#6f3a2a]">Fecha</span>
                  <span className="text-[#391511] tabular-nums">
                    {formatearFechaCorta(compra.fecha)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm pt-1 border-t border-[#e4c9b0]/40">
                  <span className="text-[#6f3a2a]">
                    Neto <MontoARS monto={compra.neto} /> · IVA{' '}
                    <MontoARS monto={compra.iva_total} />
                  </span>
                  <span className="font-extrabold text-[#391511] tabular-nums">
                    <MontoARS monto={compra.total} />
                  </span>
                </div>
              </div>

              {/* Datos del comprobante (editables) */}
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">Tipo</Label>
                  <Select value={tipo} onValueChange={(v) => setTipo(v ?? 'A')} disabled={procesando}>
                    <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c] h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIPOS_COMPROBANTE.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">Pto vta</Label>
                  <Input
                    value={punto}
                    onChange={(e) => setPunto(e.target.value)}
                    placeholder="0001"
                    disabled={procesando}
                    className="h-9 tabular-nums border-[#e4c9b0]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">Número</Label>
                  <Input
                    value={numero}
                    onChange={(e) => setNumero(e.target.value)}
                    placeholder="00001234"
                    disabled={procesando}
                    className="h-9 tabular-nums border-[#e4c9b0]"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">CUIT proveedor</Label>
                <Input
                  value={cuit}
                  onChange={(e) => setCuit(e.target.value)}
                  placeholder="30-11111111-1"
                  disabled={procesando}
                  className="h-9 tabular-nums border-[#e4c9b0]"
                />
              </div>

              {compra.controlada && (
                <div className="flex items-center gap-1.5 text-xs text-[#2f8f4e]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Ya marcada como controlada.
                </div>
              )}

              <button
                type="button"
                onClick={() => setConfirmarAnular(true)}
                disabled={procesando}
                className="flex items-center gap-1.5 text-xs text-[#c43e2c] hover:underline"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Los montos o productos están mal — anular la compra
              </button>
            </div>
          )}

          <DialogFooter className="px-6 py-4 border-t border-[#e4c9b0]/60 bg-[#fdfaf6] flex-row gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => guardar(false)}
              disabled={procesando}
              className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
            >
              Guardar
            </Button>
            <Button
              type="button"
              onClick={() => guardar(true)}
              disabled={procesando}
              className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
            >
              {procesando ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-1" /> Marcar como controlada
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmacionAccion
        abierto={confirmarAnular}
        onCambioAbierto={setConfirmarAnular}
        titulo="Anular esta compra directa"
        descripcion="Se repone el stock (si movía inventario), se revierte el pago y se borra la factura. Después podés volver a cargarla con los datos correctos."
        textoConfirmar="Sí, anular"
        destructiva
        procesando={anular.isPending}
        onConfirmar={() => {
          if (compra)
            anular.mutate(
              { facturaId: compra.id, usuarioId },
              {
                onSuccess: () => {
                  setConfirmarAnular(false)
                  onCambioAbierto(false)
                },
              }
            )
        }}
      />
    </>
  )
}
