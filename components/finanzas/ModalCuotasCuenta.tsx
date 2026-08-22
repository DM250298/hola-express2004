'use client'

import { useEffect, useState } from 'react'
import { CalendarClock, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MontoARS } from '@/components/shared/MontoARS'
import {
  EditorCuotas,
  cuotasValidas,
  type CuotaForm,
} from '@/components/finanzas/EditorCuotas'
import { useDefinirCuotas } from '@/lib/hooks/useFinanzas'
import { useUsuario } from '@/lib/hooks/useUsuario'
import type { CuentaAPagarConProveedor } from '@/lib/queries/finanzas'

const r2 = (n: number) => Math.round(n * 100) / 100

interface Props {
  cuenta: CuentaAPagarConProveedor | null
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
}

/**
 * Divide el saldo pendiente de una deuda existente en cuotas — o edita/quita
 * el plan vigente — vía fn_definir_cuotas_cuenta (mig 148). Con plan, el
 * editor precarga los REMANENTES impagos de cada cuota (Σ = saldo actual,
 * funciona aunque haya pagos parciales). El server valida la suma y deja el
 * vencimiento del padre en la primera cuota impaga.
 */
export function ModalCuotasCuenta({ cuenta, abierto, onCambioAbierto }: Props) {
  const { data: usuario } = useUsuario()
  const definir = useDefinirCuotas()
  const [cuotas, setCuotas] = useState<CuotaForm[]>([])

  const teniaPlan = (cuenta?.cuotas.length ?? 0) > 0
  const saldo = r2(cuenta?.saldo_pendiente ?? 0)
  const pagada = cuenta?.estado === 'pagada'

  // Init por apertura: precarga los remanentes impagos del plan vigente.
  useEffect(() => {
    if (!abierto || !cuenta) return
    const remanentes = cuenta.cuotas.filter((c) => c.pagado < c.monto - 0.009)
    setCuotas(
      remanentes.map((c) => ({
        key: `qd${c.id}`,
        monto: String(r2(c.monto - c.pagado)),
        fecha: c.fecha_vencimiento.slice(0, 10),
      }))
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, cuenta?.id])

  const valido = !pagada && saldo > 0.009 && cuotasValidas(cuotas, saldo)

  function handleGuardar() {
    if (!cuenta || !usuario || definir.isPending || !valido) return
    definir.mutate(
      {
        cuenta_id: cuenta.id,
        usuario_id: usuario.id,
        cuotas: cuotas.map((c) => ({
          monto: r2(Number(c.monto) || 0),
          fecha_vencimiento: c.fecha,
        })),
      },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  function handleQuitar() {
    if (!cuenta || !usuario || definir.isPending) return
    const ok = window.confirm(
      '¿Quitar el plan de cuotas?\n\nLa deuda vuelve a un vencimiento único (el de la próxima cuota que estaba impaga), editable desde el detalle.'
    )
    if (!ok) return
    definir.mutate(
      { cuenta_id: cuenta.id, usuario_id: usuario.id, cuotas: [] },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  if (!cuenta) return null

  return (
    <Dialog open={abierto} onOpenChange={onCambioAbierto}>
      <DialogContent className="sm:max-w-xl p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="px-5 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-[#f9b44c]" />
            Plan de cuotas · {cuenta.proveedor_nombre ?? 'Proveedor'}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Repartí el saldo pendiente (
            <span className="font-bold tabular-nums text-[#391511]">
              <MontoARS monto={saldo} />
            </span>
            ) en cuotas con distintas fechas. Cada cuota aparece como
            vencimiento propio en Cuentas a pagar y en el flujo proyectado.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {pagada ? (
            <p className="text-sm text-[#6f3a2a]">
              La deuda ya está pagada: no corresponde un plan de cuotas.
            </p>
          ) : (
            <EditorCuotas
              objetivo={saldo}
              cuotas={cuotas}
              onChange={setCuotas}
              deshabilitado={definir.isPending}
            />
          )}
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-5 py-3 shrink-0 flex gap-2">
          {teniaPlan && !pagada && (
            <Button
              variant="outline"
              onClick={handleQuitar}
              disabled={definir.isPending}
              className="border-[#c43e2c]/40 text-[#c43e2c] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c]"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Quitar plan
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={definir.isPending}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleGuardar}
            disabled={definir.isPending || !valido}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            {definir.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando…
              </>
            ) : (
              `Guardar plan${cuotas.length > 0 ? ` · ${cuotas.length} cuotas` : ''}`
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
