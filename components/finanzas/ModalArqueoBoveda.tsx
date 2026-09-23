'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { ContadorBilletes } from '@/components/pos/ContadorBilletes'
import { useRegistrarArqueoBoveda } from '@/lib/hooks/useCajaFuerte'
import { cn } from '@/lib/utils'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  usuarioId: string
  /** Saldo de la bóveda según el sistema (cuentas.saldo_actual). */
  saldoSistema: number
  /** Solo el admin puede dejar el saldo igual a lo contado. */
  esAdmin: boolean
}

/**
 * Arqueo del día de la caja fuerte: se cuentan TODOS los billetes de la
 * bóveda y se comparan contra el saldo del sistema. Queda en el historial día
 * a día; con diferencia la nota es obligatoria y el admin puede ajustar.
 */
export function ModalArqueoBoveda({
  abierto,
  onCambioAbierto,
  usuarioId,
  saldoSistema,
  esAdmin,
}: Props) {
  const registrar = useRegistrarArqueoBoveda()
  const [cantidades, setCantidades] = useState<Record<number, number>>({})
  const [nota, setNota] = useState('')
  const [aplicarAjuste, setAplicarAjuste] = useState(false)

  useEffect(() => {
    if (abierto) {
      setCantidades({})
      setNota('')
      setAplicarAjuste(false)
    }
  }, [abierto])

  const contado = useMemo(
    () =>
      Object.entries(cantidades).reduce(
        (acc, [denom, cant]) => acc + Number(denom) * (cant || 0),
        0
      ),
    [cantidades]
  )
  const diferencia = Math.round((contado - saldoSistema) * 100) / 100
  const hayDiferencia = Math.abs(diferencia) >= 0.01
  // Una bóveda vacía también se arquea: con $0 contado alcanza con la nota.
  const contoAlgo = contado > 0 || nota.trim() !== ''
  const faltaNota = hayDiferencia && nota.trim() === ''
  const procesando = registrar.isPending

  async function confirmar() {
    if (!contoAlgo || faltaNota || procesando) return
    const detalle: Record<number, number> = {}
    for (const [d, c] of Object.entries(cantidades)) if (c > 0) detalle[Number(d)] = c
    try {
      await registrar.mutateAsync({
        usuario_id: usuarioId,
        contado,
        detalle,
        nota: nota.trim() || null,
        aplicar_ajuste: esAdmin && aplicarAjuste && hayDiferencia,
      })
      onCambioAbierto(false)
    } catch {
      // toast en el hook
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !procesando && onCambioAbierto(v)}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
          <DialogTitle className="text-[#391511] text-lg">Arqueo del día</DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Contá toda la plata de la caja fuerte, billete por billete. El
            sistema la compara con el saldo registrado y lo guarda en el
            historial.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <ContadorBilletes cantidades={cantidades} onChange={setCantidades} />

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-[#e4c9b0]/60 bg-white p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Sistema
              </div>
              <div className="font-bold text-[#391511] tabular-nums text-sm">
                <MontoARS monto={saldoSistema} />
              </div>
            </div>
            <div className="rounded-xl border border-[#e4c9b0]/60 bg-white p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Contado
              </div>
              <div className="font-bold text-[#391511] tabular-nums text-sm">
                <MontoARS monto={contado} />
              </div>
            </div>
            <div
              className={cn(
                'rounded-xl border p-2.5',
                !contoAlgo
                  ? 'border-[#e4c9b0]/60 bg-white'
                  : hayDiferencia
                    ? 'border-[#c43e2c]/40 bg-[#c43e2c]/10'
                    : 'border-[#2f8f4e]/40 bg-[#2f8f4e]/10'
              )}
            >
              <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Diferencia
              </div>
              <div
                className={cn(
                  'font-bold tabular-nums text-sm',
                  hayDiferencia ? 'text-[#c43e2c]' : 'text-[#2f8f4e]'
                )}
              >
                {contoAlgo ? (
                  <>
                    {diferencia > 0 ? '+' : ''}
                    <MontoARS monto={diferencia} />
                  </>
                ) : (
                  '—'
                )}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nota-arqueo-boveda" className="text-[#391511] font-medium text-sm">
              Nota {hayDiferencia && <span className="text-[#c43e2c]">*</span>}
            </Label>
            <textarea
              id="nota-arqueo-boveda"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={2}
              placeholder={
                hayDiferencia
                  ? 'Qué pasó: un pago sin registrar, un billete mal contado…'
                  : 'Opcional'
              }
              className="w-full rounded-lg border border-[#e4c9b0] bg-white px-3 py-2 text-sm text-[#391511] outline-none focus:border-[#f9b44c]"
            />
          </div>

          {hayDiferencia && contoAlgo && (
            esAdmin ? (
              <label className="flex items-start gap-2 rounded-xl border border-[#e4a42a]/50 bg-[#f9b44c]/10 px-3 py-2.5 text-xs text-[#6f3a2a] cursor-pointer">
                <input
                  type="checkbox"
                  checked={aplicarAjuste}
                  onChange={(e) => setAplicarAjuste(e.target.checked)}
                  className="mt-0.5 accent-[#f9b44c]"
                />
                <span>
                  <span className="font-semibold text-[#391511]">
                    Ajustar el saldo a lo contado.
                  </span>{' '}
                  Registra un {diferencia > 0 ? 'ingreso' : 'egreso'} manual de{' '}
                  <MontoARS monto={Math.abs(diferencia)} /> en la caja fuerte.
                  Sin tildar, el arqueo queda guardado con la diferencia y el
                  saldo no cambia.
                </span>
              </label>
            ) : (
              <p className="text-[11px] text-[#6f3a2a]">
                El arqueo se guarda con la diferencia. Ajustar el saldo lo
                decide un administrador.
              </p>
            )
          )}
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
            type="button"
            onClick={confirmar}
            disabled={!contoAlgo || faltaNota || procesando}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
          >
            {procesando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando…
              </>
            ) : (
              'Guardar arqueo'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
