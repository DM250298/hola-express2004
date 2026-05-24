'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, Wallet } from 'lucide-react'
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
  useLiquidacionDetalle,
  usePagarLiquidacion,
} from '@/lib/hooks/useRrhh'
import { useCuentas } from '@/lib/hooks/useCuentas'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { cn } from '@/lib/utils'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  liquidacionId: number | null
}

const BADGE_ESTADO: Record<string, string> = {
  borrador: 'bg-[#f9b44c]/20 text-[#6f3a2a]',
  confirmada: 'bg-[#6f3a2a]/15 text-[#6f3a2a]',
  pagada: 'bg-[#2f8f4e]/15 text-[#2f8f4e]',
}

export function ModalDetalleLiquidacion({
  abierto,
  onCambioAbierto,
  liquidacionId,
}: Props) {
  const { data, isLoading } = useLiquidacionDetalle(
    liquidacionId ?? undefined
  )
  const { data: cuentas } = useCuentas(true)
  const { data: usuario } = useUsuario()
  const confirmar = useConfirmarLiquidacion()
  const pagar = usePagarLiquidacion()

  const [cuentaId, setCuentaId] = useState('')

  useEffect(() => {
    if (abierto && cuentas && cuentas.length > 0) {
      setCuentaId(String(cuentas[0].id))
    }
  }, [abierto, cuentas])

  const liquidacion = data?.liquidacion
  const recibos = data?.recibos ?? []
  const estado = liquidacion?.estado ?? 'borrador'

  const itemsCuenta: Record<string, string> = Object.fromEntries(
    (cuentas ?? []).map((c) => [String(c.id), c.nombre])
  )

  function handleConfirmar() {
    if (!liquidacion || !usuario) return
    confirmar.mutate({
      liquidacionId: liquidacion.id,
      usuarioId: usuario.id,
    })
  }

  function handlePagar() {
    if (!liquidacion || !usuario || cuentaId === '') return
    pagar.mutate({
      liquidacionId: liquidacion.id,
      cuentaId: Number(cuentaId),
      usuarioId: usuario.id,
    })
  }

  return (
    <Dialog open={abierto} onOpenChange={onCambioAbierto}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            Liquidación {liquidacion?.periodo ?? ''}
            {liquidacion && (
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
            Recibos de sueldo del período.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {isLoading || !liquidacion ? (
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
                    Bruto
                  </div>
                  <div className="text-lg font-extrabold text-[#391511] tabular-nums">
                    <MontoARS monto={liquidacion.total_bruto} />
                  </div>
                </div>
                <div className="rounded-xl border border-[#e4c9b0]/60 bg-white p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                    Aportes ({liquidacion.aportes_porcentaje}%)
                  </div>
                  <div className="text-lg font-extrabold text-[#c43e2c] tabular-nums">
                    <MontoARS monto={liquidacion.total_aportes} />
                  </div>
                </div>
                <div className="rounded-xl border-2 border-[#f9b44c]/40 bg-[#f9b44c]/10 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                    Neto a pagar
                  </div>
                  <div className="text-lg font-extrabold text-[#391511] tabular-nums">
                    <MontoARS monto={liquidacion.total_neto} />
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
                          Bruto
                        </TableHead>
                        <TableHead className="text-right text-[#391511] font-semibold">
                          Aportes
                        </TableHead>
                        <TableHead className="text-right text-[#391511] font-semibold">
                          Adel./Desc.
                        </TableHead>
                        <TableHead className="text-right text-[#391511] font-semibold">
                          Neto
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recibos.map((r) => (
                        <TableRow key={r.id} className="border-b-[#e4c9b0]/40">
                          <TableCell>
                            <div className="font-medium text-[#391511] text-sm">
                              {r.empleados?.nombre ??
                                `Empleado #${r.empleado_id}`}
                            </div>
                            <div className="text-[#c8a58a] text-xs tabular-nums">
                              Básico <MontoARS monto={r.sueldo_basico} />
                              {r.haberes_extra > 0 && (
                                <>
                                  {' · Extra '}
                                  <MontoARS monto={r.haberes_extra} />
                                </>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-[#391511]">
                            <MontoARS monto={r.bruto} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-[#c43e2c]">
                            <MontoARS monto={r.aportes} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-[#c43e2c]">
                            <div>
                              <MontoARS
                                monto={
                                  r.adelantos +
                                  r.otros_descuentos +
                                  (r.descuento_cta_cte ?? 0)
                                }
                              />
                            </div>
                            {(r.descuento_cta_cte ?? 0) > 0 && (
                              <div className="text-[10px] text-[#6f3a2a] font-normal mt-0.5">
                                Cta. cte. <MontoARS monto={r.descuento_cta_cte} />
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-bold text-[#391511]">
                            <MontoARS monto={r.neto} />
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
                  {liquidacion.fecha_pago
                    ? ` el ${liquidacion.fecha_pago}`
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
