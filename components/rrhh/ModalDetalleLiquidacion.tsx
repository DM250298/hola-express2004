'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, FileDown, Loader2, Wallet } from 'lucide-react'
import { toast } from 'sonner'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import {
  useConfirmarLiquidacion,
  useLiquidacionLoteDetalle,
  usePagarLiquidacion,
} from '@/lib/hooks/useRrhh'
import { useCuentas } from '@/lib/hooks/useCuentas'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { useConfigFiscal } from '@/lib/hooks/useFiscal'
import { getReciboCompleto } from '@/lib/queries/rrhh'
import { generarReciboSueldoPDF } from '@/lib/utils/reciboSueldo'
import { formatearFechaCorta } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  loteId: number | null
}

const BADGE_ESTADO: Record<string, string> = {
  borrador: 'bg-[#f9b44c]/20 text-[#6f3a2a]',
  confirmada: 'bg-[#6f3a2a]/15 text-[#6f3a2a]',
  pagada: 'bg-[#2f8f4e]/15 text-[#2f8f4e]',
}

export function ModalDetalleLiquidacion({
  abierto,
  onCambioAbierto,
  loteId,
}: Props) {
  const { data, isLoading } = useLiquidacionLoteDetalle(loteId ?? undefined)
  const { data: cuentas } = useCuentas(true)
  const { data: usuario } = useUsuario()
  const { data: fiscal } = useConfigFiscal()
  const confirmar = useConfirmarLiquidacion()
  const pagar = usePagarLiquidacion()

  const [cuentaId, setCuentaId] = useState('')
  const [descargando, setDescargando] = useState<number | null>(null)

  useEffect(() => {
    if (abierto && cuentas && cuentas.length > 0) {
      setCuentaId(String(cuentas[0].id))
    }
  }, [abierto, cuentas])

  const lote = data?.lote
  const recibos = data?.recibos ?? []
  const estado = lote?.estado ?? 'borrador'

  const itemsCuenta: Record<string, string> = Object.fromEntries(
    (cuentas ?? []).map((c) => [String(c.id), c.nombre])
  )

  function handleConfirmar() {
    if (!lote || !usuario) return
    confirmar.mutate({ loteId: lote.id, usuarioId: usuario.id })
  }

  function handlePagar() {
    if (!lote || !usuario || cuentaId === '') return
    pagar.mutate({
      loteId: lote.id,
      cuentaId: Number(cuentaId),
      usuarioId: usuario.id,
    })
  }

  async function descargarRecibo(reciboId: number) {
    if (!lote) return
    // Los montos del borrador son provisorios (se regeneran). No se emite un
    // recibo firmable hasta confirmar.
    if (estado === 'borrador') {
      toast.error('Confirmá la liquidación antes de descargar el recibo.')
      return
    }
    setDescargando(reciboId)
    try {
      const completo = await getReciboCompleto(reciboId)
      if (!completo) {
        toast.error('No se encontró el recibo.')
        return
      }
      generarReciboSueldoPDF({
        recibo: completo.recibo,
        renglones: completo.renglones,
        empleado: completo.empleado,
        periodo: completo.lote?.periodo ?? lote.periodo,
        fechaPago: completo.recibo.fecha_pago ?? lote.fecha_pago,
        comercio: {
          razonSocial: fiscal?.razon_social ?? 'Hola Express',
          cuit: fiscal?.cuit ?? null,
          condicionIva: fiscal?.condicion_iva ?? null,
        },
      })
    } catch (e) {
      toast.error(
        `No se pudo generar el recibo: ${
          e instanceof Error ? e.message : 'error'
        }`
      )
    } finally {
      setDescargando(null)
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={onCambioAbierto}>
      <DialogContent className="sm:max-w-3xl p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            Liquidación {lote?.periodo ?? ''}
            {lote && (
              <span
                className={cn(
                  'text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full',
                  BADGE_ESTADO[estado] ?? BADGE_ESTADO.borrador
                )}
              >
                {estado}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Recibos del período, calculados desde la asistencia.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {isLoading || !lote ? (
            <div className="space-y-3">
              <Skeleton className="h-16 rounded-2xl bg-[#f9d2a2]/30" />
              <Skeleton className="h-40 rounded-2xl bg-[#f9d2a2]/30" />
            </div>
          ) : (
            <>
              {/* Totales */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-[#e4c9b0]/60 bg-white p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                    Remunerativo
                  </div>
                  <div className="text-lg font-extrabold text-[#391511] tabular-nums">
                    <MontoARS monto={lote.total_remunerativo} />
                  </div>
                </div>
                <div className="rounded-xl border border-[#e4c9b0]/60 bg-white p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                    Descuentos
                  </div>
                  <div className="text-lg font-extrabold text-[#c43e2c] tabular-nums">
                    <MontoARS monto={lote.total_descuentos} />
                  </div>
                </div>
                <div className="rounded-xl border-2 border-[#f9b44c]/40 bg-[#f9b44c]/10 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                    Neto a pagar
                  </div>
                  <div className="text-lg font-extrabold text-[#391511] tabular-nums">
                    <MontoARS monto={lote.total_neto} />
                  </div>
                </div>
              </div>

              {/* Recibos */}
              {recibos.length === 0 ? (
                <div className="p-8 text-center text-[#6f3a2a] text-sm border border-[#e4c9b0]/60 rounded-xl">
                  La liquidación no tiene recibos. ¿Hay empleados activos?
                </div>
              ) : (
                <div className="border border-[#e4c9b0]/60 rounded-xl overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                        <TableHead className="text-[#391511] font-semibold">
                          Empleado
                        </TableHead>
                        <TableHead className="text-right text-[#391511] font-semibold">
                          Remunerativo
                        </TableHead>
                        <TableHead className="text-right text-[#391511] font-semibold">
                          Descuentos
                        </TableHead>
                        <TableHead className="text-right text-[#391511] font-semibold">
                          Neto
                        </TableHead>
                        <TableHead className="text-right text-[#391511] font-semibold">
                          Recibo
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recibos.map((r) => (
                        <TableRow key={r.id} className="border-b-[#e4c9b0]/40">
                          <TableCell>
                            <div className="font-medium text-[#391511] text-sm">
                              {[r.empleados?.nombre, r.empleados?.apellido]
                                .filter(Boolean)
                                .join(' ') || `Empleado #${r.empleado_id}`}
                            </div>
                            <div className="text-[#c8a58a] text-xs tabular-nums flex flex-wrap gap-x-2">
                              <span>
                                Básico <MontoARS monto={r.sueldo_basico} />
                              </span>
                              {(r.he50_horas > 0 || r.he100_horas > 0) && (
                                <span>
                                  HE {r.he50_horas}/{r.he100_horas} h
                                </span>
                              )}
                              {r.presentismo_perdido && (
                                <span className="text-[#c43e2c]">
                                  sin presentismo
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-[#391511]">
                            <MontoARS monto={r.total_remunerativo} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-[#c43e2c]">
                            <MontoARS monto={r.total_descuentos} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-bold text-[#391511]">
                            <MontoARS monto={r.neto} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => descargarRecibo(r.id)}
                              disabled={descargando === r.id || estado === 'borrador'}
                              title={
                                estado === 'borrador'
                                  ? 'Confirmá la liquidación para descargar el recibo'
                                  : 'Descargar recibo'
                              }
                              className="text-[#6f3a2a] hover:text-[#391511] hover:bg-[#f9b44c]/15 h-8 px-2 disabled:opacity-40"
                            >
                              {descargando === r.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <FileDown className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {estado === 'pagada' && (
                <div className="flex items-center gap-2 text-[#2f8f4e] text-sm font-medium">
                  <CheckCircle2 className="h-4 w-4" />
                  Sueldos pagados
                  {lote.fecha_pago
                    ? ` el ${formatearFechaCorta(lote.fecha_pago)}`
                    : ''}
                  .
                </div>
              )}
            </>
          )}
        </div>

        {/* Acciones según estado */}
        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 shrink-0">
          {estado === 'borrador' && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onCambioAbierto(false)}
                disabled={confirmar.isPending}
                className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
              >
                Cerrar
              </Button>
              <Button
                onClick={handleConfirmar}
                disabled={confirmar.isPending || recibos.length === 0}
                className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
              >
                {confirmar.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Confirmando…
                  </>
                ) : (
                  'Confirmar liquidación'
                )}
              </Button>
            </div>
          )}

          {estado === 'confirmada' && (
            <div className="space-y-2">
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                    Pagar desde
                  </span>
                  <Select
                    items={itemsCuenta}
                    value={cuentaId}
                    onValueChange={(v) => setCuentaId(v ?? '')}
                    disabled={pagar.isPending}
                  >
                    <SelectTrigger className="w-full border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
                      <SelectValue placeholder="Elegí una cuenta" />
                    </SelectTrigger>
                    <SelectContent>
                      {(cuentas ?? []).map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handlePagar}
                  disabled={pagar.isPending || cuentaId === ''}
                  className="flex-[1.4] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50 gap-1.5"
                >
                  {pagar.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Pagando…
                    </>
                  ) : (
                    <>
                      <Wallet className="h-4 w-4" />
                      Pagar sueldos
                    </>
                  )}
                </Button>
              </div>
              {(cuentas ?? []).length === 0 && (
                <p className="text-xs text-[#c43e2c]">
                  No hay cuentas de tesorería activas. Creá una en Finanzas ›
                  Cuentas para poder pagar.
                </p>
              )}
            </div>
          )}

          {estado === 'pagada' && (
            <Button
              variant="outline"
              onClick={() => onCambioAbierto(false)}
              className="w-full border-[#e4c9b0] text-[#6f3a2a]"
            >
              Cerrar
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
