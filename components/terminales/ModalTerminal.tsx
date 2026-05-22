'use client'

import { useEffect, useState } from 'react'
import { Loader2, Wifi } from 'lucide-react'
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
import {
  useCreateTerminal,
  useDispositivosPoint,
  useUpdateTerminal,
} from '@/lib/hooks/useTerminales'
import { useCuentas } from '@/lib/hooks/useCuentas'
import { cn } from '@/lib/utils'
import type { TerminalRow } from '@/types/database'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Terminal a editar; null = alta. */
  terminal?: TerminalRow | null
}

const SIN_CUENTA = '__sin__'

export function ModalTerminal({ abierto, onCambioAbierto, terminal }: Props) {
  const crear = useCreateTerminal()
  const actualizar = useUpdateTerminal()
  const { data: cuentas } = useCuentas(true)
  const { data: dispositivos, isLoading: cargandoDisp, error: errorDisp } =
    useDispositivosPoint(abierto)
  const editando = !!terminal

  const [nombre, setNombre] = useState('')
  const [deviceId, setDeviceId] = useState('')
  const [cuentaId, setCuentaId] = useState(SIN_CUENTA)

  useEffect(() => {
    if (abierto) {
      setNombre(terminal?.nombre ?? '')
      setDeviceId(terminal?.device_id ?? '')
      setCuentaId(
        terminal?.cuenta_id != null ? String(terminal.cuenta_id) : SIN_CUENTA
      )
    }
  }, [abierto, terminal])

  const itemsCuenta: Record<string, string> = {
    [SIN_CUENTA]: 'Sin asignar',
    ...Object.fromEntries(
      (cuentas ?? []).map((c) => [String(c.id), c.nombre])
    ),
  }

  const procesando = crear.isPending || actualizar.isPending
  const puedeGuardar = nombre.trim().length > 0 && !procesando

  function guardar() {
    if (!puedeGuardar) return
    const datos = {
      nombre: nombre.trim(),
      device_id: deviceId.trim() || null,
      cuenta_id: cuentaId === SIN_CUENTA ? null : Number(cuentaId),
    }
    if (editando && terminal) {
      actualizar.mutate(
        { id: terminal.id, datos },
        { onSuccess: () => onCambioAbierto(false) }
      )
    } else {
      crear.mutate(datos, { onSuccess: () => onCambioAbierto(false) })
    }
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !procesando && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">
            {editando ? 'Editar terminal' : 'Conectar terminal'}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Vinculá una terminal de Mercado Pago Point al sistema.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Nombre
            </Label>
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Terminal Caja 1"
              disabled={procesando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              ID del dispositivo (Mercado Pago)
            </Label>
            <Input
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              placeholder="Ej: PAX_A910__SMARTPOS123…"
              disabled={procesando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] font-mono text-xs"
            />

            {/* Dispositivos detectados desde Mercado Pago */}
            {cargandoDisp ? (
              <p className="text-[11px] text-[#6f3a2a] flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Buscando dispositivos en Mercado Pago…
              </p>
            ) : errorDisp ? (
              <p className="text-[11px] text-[#c43e2c]">
                No se pudieron leer los dispositivos:{' '}
                {errorDisp instanceof Error
                  ? errorDisp.message
                  : 'revisá el Access Token de Mercado Pago.'}{' '}
                Podés cargar el ID a mano.
              </p>
            ) : (dispositivos ?? []).length > 0 ? (
              <div className="space-y-1">
                <p className="text-[11px] text-[#6f3a2a]">
                  Dispositivos detectados — tocá para usar:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(dispositivos ?? []).map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setDeviceId(d.id)}
                      className={cn(
                        'text-[10px] font-mono px-2 py-1 rounded-lg border transition-colors',
                        deviceId === d.id
                          ? 'border-[#f9b44c] bg-[#f9b44c]/15 text-[#391511]'
                          : 'border-[#e4c9b0] bg-white text-[#6f3a2a] hover:bg-[#fdfaf6]'
                      )}
                    >
                      {d.id}
                      <span className="ml-1 text-[#c8a58a]">
                        ({d.operating_mode})
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-[#c8a58a]">
                No se detectaron dispositivos en la cuenta.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Cuenta de tesorería
            </Label>
            <Select
              items={itemsCuenta}
              value={cuentaId}
              onValueChange={(v) => setCuentaId(v ?? SIN_CUENTA)}
              disabled={procesando}
            >
              <SelectTrigger className="w-full border-[#e4c9b0] focus:ring-[#f9b44c]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_CUENTA}>Sin asignar</SelectItem>
                {(cuentas ?? []).map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-[#c8a58a]">
              Dónde se acreditan los cobros con tarjeta de esta terminal.
            </p>
          </div>
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={procesando}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={guardar}
            disabled={!puedeGuardar}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50 gap-1.5"
          >
            {procesando ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Guardando…
              </>
            ) : (
              <>
                <Wifi className="h-4 w-4" />
                {editando ? 'Guardar' : 'Conectar terminal'}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
