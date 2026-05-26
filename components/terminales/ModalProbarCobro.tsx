'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  CheckCircle2,
  Loader2,
  Wifi,
  XCircle,
} from 'lucide-react'
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
  cancelarCobroTerminal,
  consultarCobroTerminal,
  crearCobroTerminalSeguro,
  ESTADOS_FINALES_ORDEN,
  olvidarOrdenPendiente,
} from '@/lib/queries/terminales'
import { formatearMonto } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import type { TerminalRow } from '@/types/database'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  terminal: TerminalRow | null
}

const PROCESSED = 'processed'

const ETIQUETA_ESTADO: Record<string, string> = {
  processed: 'Pago aprobado',
  failed: 'Pago rechazado',
  canceled: 'Cobro cancelado',
  expired: 'Cobro expirado',
  refunded: 'Devolución',
}

export function ModalProbarCobro({
  abierto,
  onCambioAbierto,
  terminal,
}: Props) {
  const [monto, setMonto] = useState('1')
  const [ordenId, setOrdenId] = useState<string | null>(null)
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)

  const enviar = useMutation({
    mutationFn: () =>
      crearCobroTerminalSeguro({
        deviceId: terminal!.device_id as string,
        monto: Number(monto),
        referencia: `test_${Date.now()}`,
      }),
    onSuccess: (orden) => {
      setOrdenId(orden.id)
      setErrorEnvio(null)
    },
    onError: (e: Error) => {
      setErrorEnvio(e.message)
      setOrdenId(null)
    },
  })

  const poll = useQuery({
    queryKey: ['orden-cobro', ordenId],
    queryFn: () => consultarCobroTerminal(ordenId as string),
    enabled: !!ordenId,
    refetchInterval: (query) => {
      const d = query.state.data
      if (!d) return 2000
      if (d.status && ESTADOS_FINALES_ORDEN.has(d.status)) return false
      return 2000
    },
    refetchOnWindowFocus: false,
    retry: false,
  })

  const orden = poll.data
  const estadoFinal =
    !!orden?.status && ESTADOS_FINALES_ORDEN.has(orden.status)
  const aprobado = orden?.status === PROCESSED

  // Cuando la orden llega a un estado final, dejar de seguirla localmente.
  useEffect(() => {
    if (estadoFinal && terminal?.device_id) {
      olvidarOrdenPendiente(terminal.device_id)
    }
  }, [estadoFinal, terminal?.device_id])

  const cancelar = useMutation({
    mutationFn: () =>
      cancelarCobroTerminal(
        ordenId as string,
        terminal?.device_id ?? undefined
      ),
    onSuccess: () => {
      if (terminal?.device_id) olvidarOrdenPendiente(terminal.device_id)
      setOrdenId(null)
    },
  })

  const montoNum = Number(monto)
  const puedeEnviar =
    !!terminal?.device_id &&
    montoNum > 0 &&
    !enviar.isPending &&
    !ordenId

  function reiniciar() {
    setOrdenId(null)
    setErrorEnvio(null)
    enviar.reset()
    cancelar.reset()
  }

  async function manejarCierre(v: boolean) {
    if (!v) {
      if (ordenId && !estadoFinal) {
        if (
          !confirm(
            'Hay un cobro pendiente en la terminal. ¿Cancelarlo y salir?'
          )
        ) {
          return
        }
        try {
          await cancelar.mutateAsync()
        } catch {
          // Si la cancelación falla (orden ya finalizada/expirada), igual seguimos.
        }
      }
      reiniciar()
    }
    onCambioAbierto(v)
  }

  // ── Render ──
  return (
    <Dialog open={abierto} onOpenChange={manejarCierre}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">
            Probar cobro en la terminal
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {terminal?.nombre} · {terminal?.device_id || 'sin ID'}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-6 space-y-4 min-h-[220px]">
          {/* Estado 1: input del monto */}
          {!ordenId && !enviar.isPending && (
            <>
              <div className="space-y-1.5">
                <Label className="text-[#391511] font-medium text-sm">
                  Monto de prueba
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c8a58a] text-sm">
                    $
                  </span>
                  <Input
                    type="number"
                    min="1"
                    step="0.01"
                    value={monto}
                    onChange={(e) => setMonto(e.target.value)}
                    className="pl-7 tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                  />
                </div>
                <p className="text-[11px] text-[#c8a58a]">
                  Usá un monto chico para probar. Se envía al posnet real
                  y se cobra de verdad si pagás con tarjeta.
                </p>
              </div>

              {errorEnvio && (
                <p className="text-xs text-[#c43e2c] bg-[#c43e2c]/10 border border-[#c43e2c]/30 rounded-lg px-3 py-2">
                  {errorEnvio}
                </p>
              )}
            </>
          )}

          {/* Estado 2: enviando o esperando pago */}
          {(enviar.isPending || (ordenId && !estadoFinal)) && (
            <div className="flex flex-col items-center justify-center py-6 space-y-3 text-center">
              <Loader2 className="h-10 w-10 animate-spin text-[#f9b44c]" />
              <div>
                <p className="text-[#391511] font-bold">
                  {enviar.isPending
                    ? 'Enviando cobro a la terminal…'
                    : 'Esperando que el cliente pague'}
                </p>
                <p className="text-xs text-[#6f3a2a] mt-1">
                  {enviar.isPending
                    ? 'Un momento…'
                    : 'Mirá el posnet: tiene que mostrar el monto y pedir la tarjeta.'}
                </p>
              </div>
              <div className="text-2xl font-extrabold text-[#391511] tabular-nums">
                {formatearMonto(montoNum)}
              </div>
              {orden?.status && orden.status !== 'created' && (
                <p className="text-[11px] text-[#6f3a2a] uppercase tracking-wider">
                  Estado: {orden.status}
                </p>
              )}
            </div>
          )}

          {/* Estado 3: resultado final */}
          {ordenId && estadoFinal && orden && (
            <div className="flex flex-col items-center justify-center py-4 space-y-3 text-center">
              {aprobado ? (
                <CheckCircle2 className="h-12 w-12 text-[#2f8f4e]" />
              ) : (
                <XCircle className="h-12 w-12 text-[#c43e2c]" />
              )}
              <div>
                <p
                  className={cn(
                    'font-extrabold text-lg',
                    aprobado ? 'text-[#2f8f4e]' : 'text-[#c43e2c]'
                  )}
                >
                  {ETIQUETA_ESTADO[orden.status ?? ''] ?? orden.status}
                </p>
                <p className="text-2xl font-extrabold text-[#391511] tabular-nums mt-1">
                  {formatearMonto(montoNum)}
                </p>
                {orden.status_detail && (
                  <p className="text-xs text-[#6f3a2a] mt-1">
                    {orden.status_detail}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          {/* Botones según estado */}
          {!ordenId && !enviar.isPending && (
            <>
              <Button
                variant="outline"
                onClick={() => manejarCierre(false)}
                className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
              >
                Cancelar
              </Button>
              <Button
                onClick={() => enviar.mutate()}
                disabled={!puedeEnviar}
                className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50 gap-1.5"
              >
                <Wifi className="h-4 w-4" />
                Enviar a la terminal
              </Button>
            </>
          )}

          {(enviar.isPending || (ordenId && !estadoFinal)) && (
            <Button
              variant="outline"
              onClick={() => cancelar.mutate()}
              disabled={!ordenId || cancelar.isPending}
              className="flex-1 border-[#c43e2c]/40 text-[#c43e2c] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c]"
            >
              {cancelar.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  Cancelando…
                </>
              ) : (
                'Cancelar cobro'
              )}
            </Button>
          )}

          {ordenId && estadoFinal && (
            <>
              <Button
                variant="outline"
                onClick={reiniciar}
                className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
              >
                Probar otra vez
              </Button>
              <Button
                onClick={() => manejarCierre(false)}
                className="flex-1 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold"
              >
                Cerrar
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
