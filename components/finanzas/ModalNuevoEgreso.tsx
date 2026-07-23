'use client'

import { useEffect } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Receipt } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MontoARS } from '@/components/shared/MontoARS'
import {
  useActualizarEgreso,
  useCrearEgreso,
} from '@/lib/hooks/useFinanzas'
import { useCuentas } from '@/lib/hooks/useCuentas'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { CATEGORIAS_EGRESO } from '@/lib/queries/finanzas'
import type { EgresoRow } from '@/types/database'

const esquema = z.object({
  descripcion: z
    .string()
    .trim()
    .min(2, 'Mínimo 2 caracteres')
    .max(200, 'Máximo 200 caracteres'),
  monto: z
    .union([z.string(), z.number()])
    .transform((v) => (v === '' ? NaN : Number(v)))
    .pipe(z.number().min(0.01, 'Debe ser mayor a $0')),
  categoria: z.enum([
    'alquiler',
    'servicios',
    'sueldos',
    'pago_proveedores',
    'mantenimiento',
    'impuestos',
    'otros',
  ]),
  fecha: z.string().min(1, 'Fecha requerida'),
  // Cuenta de la que sale el gasto. Obligatoria al crear (se valida abajo).
  cuenta_origen_id: z.string().optional(),
})

type DatosForm = z.input<typeof esquema>

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Si se pasa un egreso, el modal funciona en modo edición (solo descripción). */
  egreso?: EgresoRow | null
}

function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const CATEGORIAS_VALIDAS = new Set<string>(
  CATEGORIAS_EGRESO.map((c) => c.valor)
)

export function ModalNuevoEgreso({ abierto, onCambioAbierto, egreso }: Props) {
  const { data: usuario } = useUsuario()
  const { data: cuentas } = useCuentas(true)
  const crear = useCrearEgreso()
  const actualizar = useActualizarEgreso()

  const esEdicion = !!egreso
  const procesando = crear.isPending || actualizar.isPending

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<DatosForm>({
    resolver: zodResolver(esquema),
    defaultValues: {
      descripcion: '',
      monto: '',
      categoria: 'otros',
      fecha: hoyIso(),
      cuenta_origen_id: '',
    },
  })

  useEffect(() => {
    if (abierto) {
      reset(
        egreso
          ? {
              descripcion: egreso.descripcion,
              monto: String(egreso.monto),
              categoria: (CATEGORIAS_VALIDAS.has(egreso.categoria)
                ? egreso.categoria
                : 'otros') as DatosForm['categoria'],
              fecha: egreso.fecha.slice(0, 10),
              cuenta_origen_id: egreso.cuenta_id ? String(egreso.cuenta_id) : '',
            }
          : {
              descripcion: '',
              monto: '',
              categoria: 'otros',
              fecha: hoyIso(),
              cuenta_origen_id: '',
            }
      )
    }
  }, [abierto, egreso, reset])

  // Preview del saldo resultante de la cuenta elegida.
  const cuentaId = useWatch({ control, name: 'cuenta_origen_id' })
  const montoRaw = useWatch({ control, name: 'monto' })
  const montoNum = Number(montoRaw) || 0
  const cuentaSel = (cuentas ?? []).find((c) => String(c.id) === cuentaId)
  const saldoResultante =
    cuentaSel && montoNum > 0 ? Number(cuentaSel.saldo_actual) - montoNum : null
  // La bóveda no puede quedar negativa (bloquea); un banco sí (solo avisa).
  const bloqueoBoveda =
    !!cuentaSel?.es_caja_fuerte && saldoResultante !== null && saldoResultante < 0
  const avisoNegativo =
    !cuentaSel?.es_caja_fuerte && saldoResultante !== null && saldoResultante < 0

  const faltaCuenta = !esEdicion && !cuentaId

  function onSubmit(datos: DatosForm) {
    const validado = esquema.parse(datos)
    if (esEdicion && egreso) {
      // Solo la descripción es editable; monto/categoría/cuenta mueven saldos.
      actualizar.mutate(
        { id: egreso.id, datos: { descripcion: validado.descripcion } },
        { onSuccess: () => onCambioAbierto(false) }
      )
      return
    }
    if (!usuario) return
    if (!validado.cuenta_origen_id || bloqueoBoveda) return
    crear.mutate(
      {
        descripcion: validado.descripcion,
        monto: validado.monto,
        categoria: validado.categoria,
        fecha: validado.fecha,
        usuario_id: usuario.id,
        cuenta_origen_id: Number(validado.cuenta_origen_id),
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
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <Receipt className="h-5 w-5 text-[#f9b44c]" />
            {esEdicion ? 'Editar gasto' : 'Nuevo egreso'}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {esEdicion
              ? 'Solo se puede editar la descripción. Para cambiar el monto o la cuenta, anulá y volvé a cargar.'
              : 'Registrá un gasto operativo y elegí de qué cuenta sale.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label
              htmlFor="descripcion"
              className="text-[#391511] font-medium text-sm"
            >
              Descripción <span className="text-[#c43e2c]">*</span>
            </Label>
            <Input
              id="descripcion"
              {...register('descripcion')}
              placeholder="Ej: Factura de luz noviembre"
              disabled={procesando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
            {errors.descripcion && (
              <p className="text-[#c43e2c] text-xs">
                {errors.descripcion.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label
                htmlFor="monto"
                className="text-[#391511] font-medium text-sm"
              >
                Monto <span className="text-[#c43e2c]">*</span>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c8a58a] text-sm">
                  $
                </span>
                <Input
                  id="monto"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  {...register('monto')}
                  placeholder="0,00"
                  disabled={procesando || esEdicion}
                  className="pl-7 h-11 text-lg font-semibold tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c] disabled:opacity-60"
                />
              </div>
              {errors.monto && (
                <p className="text-[#c43e2c] text-xs">{errors.monto.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="fecha"
                className="text-[#391511] font-medium text-sm"
              >
                Fecha <span className="text-[#c43e2c]">*</span>
              </Label>
              <Input
                id="fecha"
                type="date"
                {...register('fecha')}
                disabled={procesando || esEdicion}
                className="h-11 tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c] disabled:opacity-60"
              />
              {errors.fecha && (
                <p className="text-[#c43e2c] text-xs">{errors.fecha.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Categoría <span className="text-[#c43e2c]">*</span>
            </Label>
            <Controller
              control={control}
              name="categoria"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={procesando || esEdicion}
                >
                  <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c] disabled:opacity-60">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIAS_EGRESO.map((c) => (
                      <SelectItem key={c.valor} value={c.valor}>
                        {c.etiqueta}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {/* Cuenta de pago — solo al crear (mueve el saldo). */}
          {!esEdicion && (
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Pagar desde <span className="text-[#c43e2c]">*</span>
              </Label>
              <Controller
                control={control}
                name="cuenta_origen_id"
                render={({ field }) => (
                  <Select
                    value={field.value || ''}
                    onValueChange={field.onChange}
                    disabled={procesando}
                  >
                    <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c]">
                      <SelectValue placeholder="Elegí la cuenta…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(cuentas ?? []).map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.nombre} ·{' '}
                          <span className="font-mono tabular-nums">
                            ${Number(c.saldo_actual).toFixed(2)}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {saldoResultante !== null && (
                <div
                  className={
                    bloqueoBoveda || avisoNegativo
                      ? 'rounded-lg px-3 py-2 text-xs flex items-center justify-between bg-[#c43e2c]/10 text-[#c43e2c]'
                      : 'rounded-lg px-3 py-2 text-xs flex items-center justify-between bg-[#fdfaf6] text-[#6f3a2a]'
                  }
                >
                  <span>Saldo de {cuentaSel?.nombre} después</span>
                  <span className="font-bold tabular-nums">
                    <MontoARS monto={saldoResultante} />
                  </span>
                </div>
              )}
              {bloqueoBoveda && (
                <p className="text-[#c43e2c] text-xs">
                  La caja fuerte no puede quedar en negativo.
                </p>
              )}
              {avisoNegativo && (
                <p className="text-[#b8791a] text-xs">
                  Esta cuenta va a quedar en negativo. Se registra igual.
                </p>
              )}
            </div>
          )}
        </form>

        <DialogFooter className="px-6 py-4 border-t border-[#e4c9b0]/60 bg-[#fdfaf6] flex-row gap-2 sm:gap-2">
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
            onClick={handleSubmit(onSubmit)}
            disabled={procesando || bloqueoBoveda || faltaCuenta}
            className="flex-1 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold disabled:opacity-40"
          >
            {procesando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando…
              </>
            ) : esEdicion ? (
              'Guardar cambios'
            ) : (
              'Registrar egreso'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
