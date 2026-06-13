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
import { useEmpleados, useCreateNovedad } from '@/lib/hooks/useRrhh'
import { useUsuario } from '@/lib/hooks/useUsuario'

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
  const crear = useCreateNovedad()

  const [empleadoId, setEmpleadoId] = useState('')
  const [tipo, setTipo] = useState('bono')
  const [concepto, setConcepto] = useState('')
  const [monto, setMonto] = useState('')

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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto])

  const montoNum = Number(monto)
  const puedeGuardar =
    empleadoId !== '' && montoNum > 0 && !crear.isPending

  function guardar() {
    if (!puedeGuardar) return
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
      onOpenChange={(v) => !crear.isPending && onCambioAbierto(v)}
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
              disabled={crear.isPending}
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
              disabled={crear.isPending}
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

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Concepto (opcional)
            </Label>
            <Input
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              placeholder="Ej: bono por objetivos"
              disabled={crear.isPending}
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
                disabled={crear.isPending}
                className="pl-7 tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>
          </div>
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={crear.isPending}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={guardar}
            disabled={!puedeGuardar}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            {crear.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando…
              </>
            ) : (
              'Registrar novedad'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
