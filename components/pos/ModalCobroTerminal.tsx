'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  CheckCircle2,
  CreditCard,
  Loader2,
  QrCode,
  Wifi,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { useTerminales } from '@/lib/hooks/useTerminales'
import { useMediosPagoTerminal } from '@/lib/hooks/useMediosPago'
import { matchMedioPagoPorMP } from '@/lib/queries/mediosPago'
import {
  cancelarCobroTerminal,
  consultarCobroTerminal,
  crearCobroTerminalSeguro,
  ESTADOS_FINALES_ORDEN,
  olvidarOrdenPendiente,
} from '@/lib/queries/terminales'
import { formatearMonto } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Monto a cobrar por la maquinita. */
  total: number
  /** Total de la venta completa. Si difiere de `total`, indica cobro parcial. */
  totalVenta?: number
  /** Llamado cuando el pago en la terminal fue aprobado. */
  onAprobado: (medioPago: string) => void
  /** true si la venta se está registrando luego de la aprobación. */
  procesandoVenta?: boolean
}

const PROCESSED = 'processed'

const ETIQUETA_ESTADO: Record<string, string> = {
  processed: 'Pago aprobado',
  failed: 'Pago rechazado',
  canceled: 'Cobro cancelado',
  expired: 'Cobro expirado',
}

export function ModalCobroTerminal({
  abierto,
  onCambioAbierto,
  total,
  totalVenta,
  onAprobado,
  procesandoVenta,
}: Props) {
  const esParcial = totalVenta != null && totalVenta > total + 0.001
  const { data: terminales } = useTerminales()
  const { data: mediosTerminal } = useMediosPagoTerminal()

  // Solo terminales activas con device_id vinculado.
  const terminalesUsables = useMemo(
    () =>
      (terminales ?? []).filter((t) => t.activo && !!t.device_id),
    [terminales]
  )

  // Canal del cobro elegido por el cajero: Point (tarjeta en la maquinita)
  // o QR (el cliente escanea). Determina qué comisión aplica, porque la API
  // de MP no distingue débito Point de débito QR.
  const [canal, setCanal] = useState<'point' | 'qr'>('point')

  // Medios habilitados para terminal, filtrados por el canal elegido.
  // Se incluyen los del canal + los agnósticos (mp_channel null). Se
  // descarta efectivo aunque alguien lo haya marcado por error.
  const mediosTarjeta = useMemo(
    () =>
      (mediosTerminal ?? []).filter(
        (m) =>
          m.codigo !== 'efectivo' &&
          (m.mp_channel === canal || m.mp_channel == null)
      ),
    [mediosTerminal, canal]
  )

  const [terminalId, setTerminalId] = useState<string>('')
  const [medioPago, setMedioPago] = useState<string>('')
  const [ordenId, setOrdenId] = useState<string | null>(null)
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)
  const [yaAvisoExito, setYaAvisoExito] = useState(false)

  // Defaults al abrir.
  useEffect(() => {
    if (abierto) {
      setTerminalId((prev) =>
        prev || (terminalesUsables[0]?.id.toString() ?? '')
      )
      setOrdenId(null)
      setErrorEnvio(null)
      setYaAvisoExito(false)
    }
  }, [abierto, terminalesUsables])

  // Al cambiar de canal (o abrir), elegir el primer medio del canal si el
  // actual ya no pertenece a la lista filtrada.
  useEffect(() => {
    if (!abierto) return
    setMedioPago((prev) => {
      if (prev && mediosTarjeta.some((m) => m.codigo === prev)) return prev
      return mediosTarjeta[0]?.codigo ?? ''
    })
  }, [abierto, mediosTarjeta])

  const terminalElegida = terminalesUsables.find(
    (t) => String(t.id) === terminalId
  )

  const enviar = useMutation({
    mutationFn: () =>
      crearCobroTerminalSeguro({
        deviceId: terminalElegida!.device_id as string,
        monto: total,
        referencia: `venta_pos_${Date.now()}`,
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
    queryKey: ['orden-cobro-pos', ordenId],
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

  // Lee el payment_method que devolvió MP en la orden aprobada.
  const mpPayment = orden?.transactions?.payments?.[0]?.payment_method
  // Intenta resolver el medio exacto a partir del payment_method de MP.
  const medioAutoDetectado = useMemo(
    () =>
      mediosTerminal && mpPayment?.type
        ? matchMedioPagoPorMP(mediosTerminal, mpPayment.type, mpPayment.id, canal)
        : null,
    [mediosTerminal, mpPayment?.type, mpPayment?.id, canal]
  )

  // Dispara onAprobado cuando llega el estado processed (una sola vez).
  // Si MP devolvió un payment_method que matchea con un medio configurado,
  // usa ese (con su comisión exacta) en lugar del que eligió el cajero.
  useEffect(() => {
    if (aprobado && !yaAvisoExito && medioPago) {
      setYaAvisoExito(true)
      const codigoFinal = medioAutoDetectado?.codigo ?? medioPago
      onAprobado(codigoFinal)
    }
  }, [aprobado, yaAvisoExito, medioPago, medioAutoDetectado, onAprobado])

  // Cuando la orden llega a un estado final, dejar de seguirla localmente.
  useEffect(() => {
    if (estadoFinal && terminalElegida?.device_id) {
      olvidarOrdenPendiente(terminalElegida.device_id)
    }
  }, [estadoFinal, terminalElegida?.device_id])

  const cancelar = useMutation({
    mutationFn: () =>
      cancelarCobroTerminal(
        ordenId as string,
        terminalElegida?.device_id ?? undefined
      ),
    onSuccess: () => {
      if (terminalElegida?.device_id) {
        olvidarOrdenPendiente(terminalElegida.device_id)
      }
      setOrdenId(null)
    },
  })

  const puedeEnviar =
    !!terminalElegida?.device_id &&
    !!medioPago &&
    total > 0 &&
    !enviar.isPending &&
    !ordenId

  function reiniciar() {
    setOrdenId(null)
    setErrorEnvio(null)
    setYaAvisoExito(false)
    enviar.reset()
    cancelar.reset()
  }

  async function manejarCierre(v: boolean) {
    if (!v) {
      if (procesandoVenta) return // no cerrar mientras se registra
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
          // Si la cancelación falla, igual seguimos cerrando.
        }
      }
      reiniciar()
    }
    onCambioAbierto(v)
  }

  const itemsTerminal: Record<string, string> = Object.fromEntries(
    terminalesUsables.map((t) => [String(t.id), t.nombre])
  )

  return (
    <Dialog open={abierto} onOpenChange={manejarCierre}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg flex items-center justify-between">
            <span>Cobrar con posnet</span>
            <span className="text-2xl font-extrabold tabular-nums">
              <MontoARS monto={total} />
            </span>
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {esParcial ? (
              <>
                Cobro parcial · resto a cobrar por otro medio:{' '}
                <strong className="text-[#391511]">
                  <MontoARS monto={(totalVenta ?? 0) - total} />
                </strong>
              </>
            ) : (
              <>
                El monto se envía a la Point. La venta se registra sola al
                aprobarse.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4 min-h-[260px]">
          {/* Sin terminales configuradas */}
          {terminalesUsables.length === 0 && (
            <div className="text-center py-6 text-[#c43e2c] text-sm">
              No hay ninguna terminal vinculada al sistema.
              <br />
              Configurala en <strong>Terminales de cobro</strong>.
            </div>
          )}

          {/* Estado 1: selección de terminal + medio */}
          {terminalesUsables.length > 0 &&
            !ordenId &&
            !enviar.isPending && (
              <>
                {/* Canal: Point (tarjeta en la maquinita) vs QR (escanea el cliente) */}
                <div className="space-y-1.5">
                  <Label className="text-[#391511] font-medium text-sm">
                    ¿Cómo paga?
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setCanal('point')}
                      className={cn(
                        'flex items-center justify-center gap-2 h-12 rounded-xl border-2 font-bold transition-all',
                        canal === 'point'
                          ? 'border-[#f9b44c] bg-[#f9b44c]/15 text-[#391511]'
                          : 'border-[#e4c9b0] bg-white text-[#6f3a2a] hover:border-[#c8a58a]'
                      )}
                    >
                      <CreditCard className="h-4 w-4" />
                      Tarjeta (Point)
                    </button>
                    <button
                      type="button"
                      onClick={() => setCanal('qr')}
                      className={cn(
                        'flex items-center justify-center gap-2 h-12 rounded-xl border-2 font-bold transition-all',
                        canal === 'qr'
                          ? 'border-[#f9b44c] bg-[#f9b44c]/15 text-[#391511]'
                          : 'border-[#e4c9b0] bg-white text-[#6f3a2a] hover:border-[#c8a58a]'
                      )}
                    >
                      <QrCode className="h-4 w-4" />
                      QR
                    </button>
                  </div>
                </div>

                {terminalesUsables.length > 1 && (
                  <div className="space-y-1.5">
                    <Label className="text-[#391511] font-medium text-sm">
                      Terminal
                    </Label>
                    <Select
                      items={itemsTerminal}
                      value={terminalId}
                      onValueChange={(v) => setTerminalId(v ?? '')}
                    >
                      <SelectTrigger className="w-full border-[#e4c9b0] focus:ring-[#f9b44c]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {terminalesUsables.map((t) => (
                          <SelectItem key={t.id} value={String(t.id)}>
                            {t.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {terminalesUsables.length === 1 && (
                  <div className="text-sm text-[#6f3a2a] flex items-center gap-2 bg-[#fdfaf6] border border-[#e4c9b0]/60 rounded-lg px-3 py-2">
                    <CreditCard className="h-4 w-4 text-[#6f3a2a]" />
                    <span>
                      Terminal:{' '}
                      <strong className="text-[#391511]">
                        {terminalesUsables[0].nombre}
                      </strong>
                    </span>
                  </div>
                )}

                {/* La forma de pago la detecta MP sola al aprobarse. El cajero
                    no la elige: solo definió el canal (Tarjeta/QR) arriba. */}
                <div className="flex items-start gap-2 text-[11px] text-[#6f3a2a] bg-[#fdfaf6] border border-[#e4c9b0]/60 rounded-lg px-3 py-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#2f8f4e] shrink-0 mt-0.5" />
                  <span>
                    El medio exacto (débito, crédito, etc.) se detecta solo
                    según cómo pague el cliente y se registra con su comisión
                    real.
                  </span>
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
            <div className="flex flex-col items-center justify-center py-8 space-y-3 text-center">
              <Loader2 className="h-10 w-10 animate-spin text-[#f9b44c]" />
              <div>
                <p className="text-[#391511] font-bold text-base">
                  {enviar.isPending
                    ? 'Enviando cobro a la terminal…'
                    : 'Esperando que el cliente pague'}
                </p>
                <p className="text-xs text-[#6f3a2a] mt-1">
                  {enviar.isPending
                    ? 'Un momento…'
                    : 'El posnet muestra el monto y pide la tarjeta.'}
                </p>
              </div>
              <div className="text-2xl font-extrabold text-[#391511] tabular-nums">
                <MontoARS monto={total} />
              </div>
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
                  <MontoARS monto={total} />
                </p>
                {/* Mostrar qué medio se detectó automáticamente desde MP */}
                {aprobado && medioAutoDetectado && (
                  <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-[#2f8f4e]/10 border border-[#2f8f4e]/30">
                    <span className="text-[10px] text-[#2f8f4e] font-semibold uppercase tracking-wide">
                      Detectado
                    </span>
                    <span className="text-xs text-[#391511] font-bold">
                      {medioAutoDetectado.nombre}
                    </span>
                    {medioAutoDetectado.comision_porcentaje > 0 && (
                      <span className="text-[10px] text-[#6f3a2a]">
                        · {medioAutoDetectado.comision_porcentaje}%
                      </span>
                    )}
                  </div>
                )}
                {aprobado && !medioAutoDetectado && mpPayment?.type && (
                  <p className="text-[10px] text-[#c8a58a] mt-2 font-mono">
                    MP: {mpPayment.type}
                    {mpPayment.id ? ` / ${mpPayment.id}` : ''} · sin mapeo
                  </p>
                )}
                {procesandoVenta && (
                  <p className="text-xs text-[#6f3a2a] mt-2 flex items-center justify-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Registrando la venta…
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          {/* Estado inicial: cancelar / enviar */}
          {terminalesUsables.length > 0 &&
            !ordenId &&
            !enviar.isPending && (
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

          {/* Esperando: cancelar */}
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

          {/* Final: cerrar o reintentar */}
          {ordenId && estadoFinal && (
            <>
              {!aprobado && (
                <Button
                  variant="outline"
                  onClick={reiniciar}
                  className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
                >
                  Reintentar
                </Button>
              )}
              <Button
                onClick={() => manejarCierre(false)}
                disabled={procesandoVenta}
                className={cn(
                  'bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold',
                  aprobado ? 'flex-1' : 'flex-1'
                )}
              >
                {procesandoVenta ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                    Registrando…
                  </>
                ) : (
                  'Cerrar'
                )}
              </Button>
            </>
          )}

          {/* Sin terminales: solo cerrar */}
          {terminalesUsables.length === 0 && (
            <Button
              variant="outline"
              onClick={() => manejarCierre(false)}
              className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
            >
              Cerrar
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
