'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MontoARS } from '@/components/shared/MontoARS'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { useCuentas } from '@/lib/hooks/useCuentas'
import { useCobrarCtaCte } from '@/lib/hooks/useCtaCte'
import { formatearMonto } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import type { TipoDeudorCtaCte } from '@/types/database'

/** "Hoy" en horario local (no UTC — toISOString corre un día de noche). */
function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const r2 = (n: number) => Math.round(n * 100) / 100

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  deudorTipo: TipoDeudorCtaCte | null
  deudorId: number | null
  deudorNombre: string
  saldo: number
  /**
   * 'pos': cobro en EFECTIVO contra el turno abierto (entra al arqueo, no
   * toca cuentas). 'finanzas': cobro por tesorería (elige cuenta destino).
   */
  contexto: 'pos' | 'finanzas'
  /** Requerido en contexto 'pos'. */
  turnoId?: number | null
}

/**
 * Cobro (total o parcial) de la deuda de cuenta corriente de un deudor.
 * Molde de ModalPagarCuenta, con la regla de oro del efectivo (mig 141):
 * en el POS la plata queda en el cajón y suma al esperado del cierre.
 */
export function ModalCobrarCtaCte({
  abierto,
  onCambioAbierto,
  deudorTipo,
  deudorId,
  deudorNombre,
  saldo,
  contexto,
  turnoId,
}: Props) {
  const { data: usuario } = useUsuario()
  const { data: cuentas } = useCuentas(true)
  const cobrar = useCobrarCtaCte()

  const [monto, setMonto] = useState('')
  const [cuentaId, setCuentaId] = useState<string>('')
  const [fecha, setFecha] = useState(hoyIso())
  const [nota, setNota] = useState('')

  useEffect(() => {
    if (abierto) {
      // Precarga: toda la deuda.
      setMonto(saldo > 0.009 ? String(r2(saldo)) : '')
      setCuentaId('')
      setFecha(hoyIso())
      setNota('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto])

  const esPos = contexto === 'pos'
  // La bóveda no es destino válido: el efectivo físico entra por arqueo.
  const cuentasElegibles = (cuentas ?? []).filter((c) => !c.es_caja_fuerte)
  const itemsCuenta: Record<string, string> = Object.fromEntries(
    cuentasElegibles.map((c) => [String(c.id), c.nombre])
  )
  const cuentaElegida = cuentasElegibles.find(
    (c) => String(c.id) === cuentaId
  )

  const montoNum = Number(monto)
  const excedeDeuda = montoNum > saldo + 0.009
  const puedeCobrar =
    !cobrar.isPending &&
    !!deudorTipo &&
    !!deudorId &&
    !!usuario?.id &&
    monto !== '' &&
    Number.isFinite(montoNum) &&
    montoNum > 0 &&
    !excedeDeuda &&
    (esPos ? !!turnoId : !!cuentaElegida)

  const esParcial = puedeCobrar && montoNum < saldo - 0.009

  function confirmarCobro() {
    if (!puedeCobrar || !deudorTipo || !deudorId || !usuario) return
    cobrar.mutate(
      {
        deudor_tipo: deudorTipo,
        deudor_id: deudorId,
        monto: r2(montoNum),
        usuario_id: usuario.id,
        cuenta_id: esPos ? null : Number(cuentaId),
        turno_id: esPos ? (turnoId ?? null) : null,
        fecha: esPos ? null : fecha,
        nota: nota.trim() || null,
      },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !cobrar.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">
            Cobrar fiado · {deudorNombre}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {esPos
              ? 'El efectivo entra a la caja del turno y suma al cierre.'
              : 'La plata entra a la cuenta de tesorería que elijas.'}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="rounded-xl border border-[#e4c9b0]/60 bg-[#fdfaf6] px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-[#6f3a2a]">Debe hoy</span>
            <span className="font-bold text-[#391511] tabular-nums text-lg">
              <MontoARS monto={saldo} />
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-[#391511]">Monto a cobrar</Label>
              <button
                type="button"
                onClick={() => setMonto(String(r2(saldo)))}
                className="text-xs text-[#6f3a2a] underline decoration-dotted hover:text-[#391511]"
              >
                toda la deuda
              </button>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6f3a2a] font-bold">
                $
              </span>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                autoFocus
                className="pl-8 h-12 text-xl font-semibold tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>
            {excedeDeuda && (
              <p className="text-xs text-[#c43e2c] font-semibold">
                No se puede cobrar más de lo que debe.
              </p>
            )}
          </div>

          {!esPos && (
            <>
              <div className="space-y-1.5">
                <Label className="text-[#391511]">Entra a la cuenta</Label>
                <Select
                  items={itemsCuenta}
                  value={cuentaId}
                  onValueChange={(v) => setCuentaId(v ?? '')}
                >
                  <SelectTrigger className="w-full border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
                    <SelectValue placeholder="Elegí la cuenta…" />
                  </SelectTrigger>
                  <SelectContent>
                    {cuentasElegibles.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {cuentaElegida && montoNum > 0 && (
                  <p className="text-[11px] text-[#6f3a2a]">
                    Saldo resultante:{' '}
                    <span className="font-semibold tabular-nums">
                      {formatearMonto(
                        Number(cuentaElegida.saldo_actual) + r2(montoNum)
                      )}
                    </span>
                  </p>
                )}
                <p className="text-[10px] text-[#c8a58a]">
                  ¿Te pagan en efectivo en el mostrador? Cobralo desde el POS:
                  entra al cajón y pasa por el arqueo.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[#391511]">Fecha</Label>
                <Input
                  type="date"
                  value={fecha}
                  max={hoyIso()}
                  onChange={(e) => setFecha(e.target.value)}
                  className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
                />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label className="text-[#391511]">Nota (opcional)</Label>
            <Input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ej: pagó con transferencia del hermano"
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          {puedeCobrar && (
            <div
              className={cn(
                'rounded-xl px-4 py-3 text-sm',
                'bg-[#f9b44c]/10 border border-[#f9b44c]/40 text-[#6f3a2a]'
              )}
            >
              Cobrás <MontoARS monto={r2(montoNum)} />{' '}
              {esPos
                ? 'en efectivo en la caja'
                : `en ${cuentaElegida?.nombre ?? ''}`}
              {esParcial ? (
                <>
                  {' '}
                  · le quedan{' '}
                  <span className="font-semibold">
                    <MontoARS monto={r2(saldo - montoNum)} />
                  </span>{' '}
                  pendientes
                </>
              ) : (
                ' · queda al día'
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[#e4c9b0]/60 bg-[#fdfaf6] flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={cobrar.isPending}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={confirmarCobro}
            disabled={!puedeCobrar}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
          >
            {cobrar.isPending && (
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            )}
            Registrar cobro
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
