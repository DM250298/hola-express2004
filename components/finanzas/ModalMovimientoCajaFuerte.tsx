'use client'

import { useEffect, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Loader2 } from 'lucide-react'
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
import { MontoARS } from '@/components/shared/MontoARS'
import { useRegistrarMovimientoCajaFuerte } from '@/lib/hooks/useCajaFuerte'
import type { TipoMovimientoCajaFuerte } from '@/types/database'
import { cn } from '@/lib/utils'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  usuarioId: string
  /** Saldo actual de la bóveda, para previsualizar el resultante y avisar negativo. */
  saldoActual: number
}

const TIPOS: Array<{
  valor: TipoMovimientoCajaFuerte
  etiqueta: string
  icono: React.ElementType
  color: string
  descripcion: string
}> = [
  {
    valor: 'ingreso',
    etiqueta: 'Ingreso',
    icono: ArrowDownToLine,
    color: '#6f3a2a',
    descripcion: 'Entra plata',
  },
  {
    valor: 'egreso',
    etiqueta: 'Egreso',
    icono: ArrowUpFromLine,
    color: '#c43e2c',
    descripcion: 'Sale plata',
  },
]

export function ModalMovimientoCajaFuerte({
  abierto,
  onCambioAbierto,
  usuarioId,
  saldoActual,
}: Props) {
  const registrar = useRegistrarMovimientoCajaFuerte()

  const [tipo, setTipo] = useState<TipoMovimientoCajaFuerte>('ingreso')
  const [monto, setMonto] = useState('')
  const [nota, setNota] = useState('')

  useEffect(() => {
    if (abierto) {
      setTipo('ingreso')
      setMonto('')
      setNota('')
    }
  }, [abierto])

  const procesando = registrar.isPending
  const montoNum = Number(monto) || 0

  const saldoResultante =
    montoNum > 0
      ? tipo === 'ingreso'
        ? saldoActual + montoNum
        : saldoActual - montoNum
      : null

  const errorSaldoNegativo =
    tipo === 'egreso' && saldoResultante !== null && saldoResultante < 0

  const puedeConfirmar =
    !procesando && montoNum > 0 && nota.trim().length >= 2 && !errorSaldoNegativo

  async function confirmar() {
    if (!puedeConfirmar) return
    try {
      await registrar.mutateAsync({
        usuario_id: usuarioId,
        tipo,
        monto: montoNum,
        nota: nota.trim(),
      })
      onCambioAbierto(false)
    } catch {
      // toast manejado en el hook
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !procesando && onCambioAbierto(v)}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
          <DialogTitle className="text-[#391511] text-lg">
            Movimiento manual de caja fuerte
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Cargá una entrada o salida de efectivo que no venga de los cierres de
            caja (aporte, retiro, pago en efectivo, ajuste).
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-1 flex-col min-h-0"
          onSubmit={(e) => {
            e.preventDefault()
            confirmar()
          }}
        >
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {/* Tipo */}
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold mb-2 block">
                Tipo de movimiento
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {TIPOS.map((t) => {
                  const activo = tipo === t.valor
                  const Icono = t.icono
                  return (
                    <button
                      key={t.valor}
                      type="button"
                      onClick={() => setTipo(t.valor)}
                      disabled={procesando}
                      className={cn(
                        'flex flex-col items-center justify-center gap-1 py-3 rounded-xl border-2 transition-all',
                        activo
                          ? 'border-[#f9b44c] bg-[#f9b44c]/15 text-[#391511]'
                          : 'border-[#e4c9b0] bg-white text-[#6f3a2a] hover:border-[#c8a58a]'
                      )}
                    >
                      <Icono
                        className="h-4 w-4"
                        style={!activo ? { color: t.color } : undefined}
                      />
                      <span className="text-xs font-bold">{t.etiqueta}</span>
                      <span className="text-[10px] leading-none opacity-70">
                        {t.descripcion}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Monto */}
            <div className="space-y-1.5">
              <Label htmlFor="monto-mcf" className="text-[#391511] font-medium text-sm">
                Monto <span className="text-[#c43e2c]">*</span>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6f3a2a] text-lg font-bold">
                  $
                </span>
                <Input
                  id="monto-mcf"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  autoFocus
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  placeholder="0,00"
                  disabled={procesando}
                  className="pl-7 h-12 text-xl font-semibold tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>

              {saldoResultante !== null && (
                <div
                  className={cn(
                    'rounded-lg px-3 py-2 text-xs flex items-center justify-between mt-1',
                    errorSaldoNegativo
                      ? 'bg-[#c43e2c]/10 text-[#c43e2c]'
                      : 'bg-[#fdfaf6] text-[#6f3a2a]'
                  )}
                >
                  <span>Saldo de la bóveda después</span>
                  <span className="font-bold tabular-nums">
                    <MontoARS monto={saldoResultante} />
                  </span>
                </div>
              )}
              {errorSaldoNegativo && (
                <p className="text-[#c43e2c] text-xs">
                  El egreso deja la bóveda en negativo. No se puede registrar.
                </p>
              )}
            </div>

            {/* Nota */}
            <div className="space-y-1.5">
              <Label htmlFor="nota-mcf" className="text-[#391511] font-medium text-sm">
                Motivo / nota <span className="text-[#c43e2c]">*</span>
              </Label>
              <textarea
                id="nota-mcf"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder={
                  tipo === 'ingreso'
                    ? 'Ej: Aporte del dueño para cambio'
                    : 'Ej: Pago a proveedor en efectivo'
                }
                rows={2}
                disabled={procesando}
                className="w-full rounded-md border border-[#e4c9b0] bg-transparent px-3 py-2 text-sm text-[#391511] placeholder:text-[#c8a58a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c] resize-none"
              />
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t border-[#e4c9b0]/60 bg-[#fdfaf6] flex-row gap-2 sm:gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onCambioAbierto(false)}
              disabled={procesando}
              className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!puedeConfirmar}
              className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold disabled:opacity-40"
            >
              {procesando ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Registrando…
                </>
              ) : tipo === 'ingreso' ? (
                'Registrar ingreso'
              ) : (
                'Registrar egreso'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
