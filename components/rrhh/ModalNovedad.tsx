'use client'

import { useEffect, useMemo, useState } from 'react'
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
import {
  useEmpleados,
  useCreateNovedad,
  useRegistrarAdelanto,
} from '@/lib/hooks/useRrhh'
import { useCuentas } from '@/lib/hooks/useCuentas'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { MontoARS } from '@/components/shared/MontoARS'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Período YYYY-MM al que se imputa la novedad. */
  periodo: string
}

/**
 * Tipos de novedad MANUAL y si suman (haber) o restan (descuento) en el recibo.
 * Horas extra y presentismo NO están: se calculan automáticamente desde la
 * asistencia en la liquidación (Sprint 4); cargarlos a mano no tendría efecto.
 */
export const TIPOS_NOVEDAD: Record<string, string> = {
  bono: 'Bono / premio (suma)',
  otro: 'Otro haber (suma)',
  adelanto: 'Adelanto de sueldo (resta)',
  descuento: 'Descuento (resta)',
}

export function ModalNovedad({ abierto, onCambioAbierto, periodo }: Props) {
  const { data: empleados } = useEmpleados()
  const { data: usuario } = useUsuario()
  const { data: cuentas } = useCuentas(true)
  const crear = useCreateNovedad()
  const adelantar = useRegistrarAdelanto()

  const [empleadoId, setEmpleadoId] = useState('')
  const [tipo, setTipo] = useState('bono')
  const [concepto, setConcepto] = useState('')
  const [monto, setMonto] = useState('')
  const [cuentaId, setCuentaId] = useState('')

  const esAdelanto = tipo === 'adelanto'
  const cuentasElegibles = useMemo(
    () => (cuentas ?? []).filter((c) => !c.es_caja_fuerte),
    [cuentas]
  )
  const itemsCuenta: Record<string, string> = useMemo(
    () =>
      Object.fromEntries(cuentasElegibles.map((c) => [String(c.id), c.nombre])),
    [cuentasElegibles]
  )
  const cuentaElegida = cuentasElegibles.find((c) => String(c.id) === cuentaId)
  const procesando = crear.isPending || adelantar.isPending

  const empleadosActivos = useMemo(
    () => (empleados ?? []).filter((e) => e.activo),
    [empleados]
  )

  const itemsEmpleado: Record<string, string> = useMemo(
    () =>
      Object.fromEntries(empleadosActivos.map((e) => [String(e.id), e.nombre])),
    [empleadosActivos]
  )

  useEffect(() => {
    if (abierto) {
      setEmpleadoId(
        empleadosActivos.length > 0 ? String(empleadosActivos[0].id) : ''
      )
      setTipo('bono')
      setConcepto('')
      setMonto('')
      setCuentaId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto])

  const montoNum = Number(monto)
  const puedeGuardar =
    empleadoId !== '' &&
    montoNum > 0 &&
    !procesando &&
    (!esAdelanto || (!!cuentaElegida && !!usuario?.id))

  function guardar() {
    if (!puedeGuardar) return
    // El adelanto saca plata de verdad: va por la RPC (mig 142) que debita
    // la cuenta + movimiento + asiento. El resto es una novedad contable.
    if (esAdelanto) {
      adelantar.mutate(
        {
          empleado_id: Number(empleadoId),
          periodo,
          monto: montoNum,
          cuenta_id: Number(cuentaId),
          usuario_id: usuario?.id ?? '',
          concepto: concepto.trim() || null,
        },
        { onSuccess: () => onCambioAbierto(false) }
      )
      return
    }
    crear.mutate(
      {
        empleado_id: Number(empleadoId),
        periodo,
        tipo,
        concepto: concepto.trim() || null,
        monto: montoNum,
        usuario_id: usuario?.id ?? null,
      },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !procesando && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">
            Nueva novedad · {periodo}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Bonos, adelantos o descuentos del período. Las horas extra y el
            presentismo se calculan solos desde la asistencia.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Empleado
            </Label>
            <Select
              items={itemsEmpleado}
              value={empleadoId}
              onValueChange={(v) => setEmpleadoId(v ?? '')}
              disabled={procesando}
            >
              <SelectTrigger className="w-full border-[#e4c9b0] focus:ring-[#f9b44c]">
                <SelectValue placeholder="Elegí un empleado" />
              </SelectTrigger>
              <SelectContent>
                {empleadosActivos.map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {e.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Tipo de novedad
            </Label>
            <Select
              items={TIPOS_NOVEDAD}
              value={tipo}
              onValueChange={(v) => setTipo(v ?? 'bono')}
              disabled={procesando}
            >
              <SelectTrigger className="w-full border-[#e4c9b0] focus:ring-[#f9b44c]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TIPOS_NOVEDAD).map(([valor, etiqueta]) => (
                  <SelectItem key={valor} value={valor}>
                    {etiqueta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* El adelanto saca plata REAL: elegir de qué cuenta sale. */}
          {esAdelanto && (
            <div className="space-y-1.5 rounded-xl border-2 border-[#f9b44c]/40 bg-[#f9b44c]/8 p-3">
              <Label className="text-[#391511] font-medium text-sm">
                ¿De dónde sale la plata?
              </Label>
              <Select
                items={itemsCuenta}
                value={cuentaId}
                onValueChange={(v) => setCuentaId(v ?? '')}
                disabled={procesando}
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
                    <MontoARS
                      monto={Number(cuentaElegida.saldo_actual) - montoNum}
                    />
                  </span>
                </p>
              )}
              <p className="text-[10px] text-[#c8a58a]">
                Registra el egreso de tesorería y el asiento; en la liquidación
                de {periodo} se descuenta solo del recibo.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Concepto (opcional)
            </Label>
            <Input
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              placeholder="Ej: bono por objetivos"
              disabled={procesando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Monto</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c8a58a] text-sm">
                $
              </span>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                placeholder="0,00"
                disabled={procesando}
                className="pl-7 tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>
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
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            {procesando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando…
              </>
            ) : esAdelanto ? (
              'Registrar adelanto'
            ) : (
              'Registrar novedad'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
