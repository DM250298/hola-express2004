'use client'

import { useEffect, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
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
import { AyudaContextual } from '@/components/shared/AyudaContextual'
import { useUsuario } from '@/lib/hooks/useUsuario'
import {
  useLimiteCredito,
  useLimiteSugeridoEmpleado,
  useSetLimiteCredito,
} from '@/lib/hooks/useCtaCte'
import { tienePermiso } from '@/lib/permisos'
import type { TipoDeudorCtaCte } from '@/types/database'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  deudorTipo: TipoDeudorCtaCte | null
  deudorId: number | null
  deudorNombre: string
  saldoActual: number
}

/**
 * Setea el tope de fiado de un deudor. Sin tope (o 0) no se le puede fiar
 * desde el POS. Para empleados, el botón "Sugerir sueldo básico" solo aparece
 * con permiso rrhh_sueldos (la sugerencia ES el sueldo).
 */
export function ModalLimiteCredito({
  abierto,
  onCambioAbierto,
  deudorTipo,
  deudorId,
  deudorNombre,
  saldoActual,
}: Props) {
  const { data: usuario } = useUsuario()
  const { data: limite, isLoading: cargandoLimite } = useLimiteCredito(
    abierto ? deudorTipo : null,
    abierto ? deudorId : null
  )
  const guardarLimite = useSetLimiteCredito()
  const sugerir = useLimiteSugeridoEmpleado()

  const [monto, setMonto] = useState('')
  const [nota, setNota] = useState('')
  // Init una vez por apertura, SIN pisar lo tipeado durante el skeleton:
  // el guard de datos corre solo cuando el límite terminó de cargar.
  const [inicializado, setInicializado] = useState(false)

  useEffect(() => {
    if (!abierto) {
      setInicializado(false)
      return
    }
    if (cargandoLimite || inicializado) return
    setMonto(limite ? String(limite.monto) : '')
    setNota(limite?.nota ?? '')
    setInicializado(true)
  }, [abierto, cargandoLimite, inicializado, limite])

  const puedeSugerir =
    deudorTipo === 'empleado' && tienePermiso(usuario?.permisos, 'rrhh_sueldos')

  const montoNum = Number(monto)
  const puedeGuardar =
    !guardarLimite.isPending &&
    !cargandoLimite &&
    monto !== '' &&
    Number.isFinite(montoNum) &&
    montoNum >= 0 &&
    !!deudorTipo &&
    !!deudorId &&
    !!usuario?.id

  function guardar() {
    if (!puedeGuardar || !deudorTipo || !deudorId || !usuario) return
    guardarLimite.mutate(
      {
        deudor_tipo: deudorTipo,
        deudor_id: deudorId,
        monto: Math.round(montoNum * 100) / 100,
        nota: nota.trim() || null,
        usuario_id: usuario.id,
      },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  async function sugerirSueldo() {
    if (!deudorId) return
    const sueldo = await sugerir.mutateAsync(deudorId)
    if (sueldo > 0) setMonto(String(sueldo))
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !guardarLimite.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">
            Tope de fiado · {deudorNombre}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Hasta cuánto puede deber. Con tope 0 no se le fía.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-4 space-y-4">
          <div className="rounded-xl border border-[#e4c9b0]/60 bg-[#fdfaf6] px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-[#6f3a2a]">Debe hoy</span>
            <span className="font-bold text-[#391511] tabular-nums">
              <MontoARS monto={saldoActual} />
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-1">
              <Label className="text-[#391511]">Tope de crédito</Label>
              <AyudaContextual titulo="¿Cómo funciona el tope?">
                El POS bloquea la venta fiada cuando la deuda superaría este
                monto. Subilo o bajalo cuando quieras; la deuda ya tomada no se
                toca.
              </AyudaContextual>
            </div>
            <div className="flex gap-2">
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                placeholder={cargandoLimite ? 'Cargando…' : '0'}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
              />
              {puedeSugerir && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={sugerirSueldo}
                  disabled={sugerir.isPending}
                  className="border-[#e4c9b0] text-[#6f3a2a] gap-1.5 shrink-0"
                  title="Usar el sueldo básico como tope"
                >
                  {sugerir.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Sueldo básico
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511]">Nota (opcional)</Label>
            <Input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ej: autorizado por el dueño"
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[#e4c9b0]/60 bg-[#fdfaf6] flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={guardarLimite.isPending}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={guardar}
            disabled={!puedeGuardar}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
          >
            {guardarLimite.isPending && (
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            )}
            Guardar tope
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
